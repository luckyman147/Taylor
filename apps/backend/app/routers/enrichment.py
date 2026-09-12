"""AI-powered resume enrichment endpoints."""

import asyncio
import copy
import json
import logging
import re
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.config_cache import get_content_language
from app.database import db
from app.llm import complete_json
from app.prompts.enrichment import (
    ANALYZE_RESUME_PROMPT,
    ENHANCE_DESCRIPTION_PROMPT,
    GENERATE_OUTREACH_EMAIL_PROMPT,
    GENERATE_PROJECT_BULLETS_PROMPT,
    REGENERATE_ITEM_PROMPT,
    REGENERATE_SKILLS_PROMPT,
    REGENERATE_SUMMARY_PROMPT,
)
from app.prompts.templates import get_language_name
from app.services.cover_letter import _resolve_feature_prompt
from app.schemas.enrichment import (
    AnalysisResponse,
    AnswerInput,
    ApplyEnhancementsRequest,
    EnhancedDescription,
    EnhanceRequest,
    EnhancementPreview,
    EnrichmentItem,
    EnrichmentQuestion,
    GenerateOutreachEmailRequest,
    GenerateOutreachEmailResponse,
    GenerateProjectBulletsRequest,
    GenerateProjectBulletsResponse,
    RegenerateItemError,
    RegenerateItemInput,
    RegenerateRequest,
    RegenerateResponse,
    RegeneratedItem,
    ResearchCompanyRequest,
    ResearchCompanyResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enrichment", tags=["Enrichment"])


def _extract_item_from_resume(processed_data: dict, item_id: str) -> dict:
    """Derive item details from resume data using the item_id pattern.

    Avoids a redundant LLM analysis call when the frontend already knows
    which item each answer belongs to.
    """
    try:
        prefix, idx_str = item_id.split("_", 1)
        index = int(idx_str)
    except (ValueError, AttributeError):
        return {}

    if index < 0:
        return {}

    if prefix == "exp":
        entries = processed_data.get("workExperience", [])
        if not isinstance(entries, list) or index >= len(entries):
            return {}
        entry = entries[index]
        desc = entry.get("description", [])
        return {
            "item_id": item_id,
            "item_type": "experience",
            "title": entry.get("title", ""),
            "subtitle": entry.get("company", ""),
            "current_description": desc if isinstance(desc, list) else [desc] if isinstance(desc, str) and desc else [],
        }
    elif prefix == "proj":
        entries = processed_data.get("personalProjects", [])
        if not isinstance(entries, list) or index >= len(entries):
            return {}
        entry = entries[index]
        desc = entry.get("description", [])
        return {
            "item_id": item_id,
            "item_type": "project",
            "title": entry.get("name", ""),
            "subtitle": entry.get("role", ""),
            "current_description": desc if isinstance(desc, list) else [desc] if isinstance(desc, str) and desc else [],
        }
    return {}


@router.post("/analyze/{resume_id}", response_model=AnalysisResponse)
async def analyze_resume(resume_id: str) -> AnalysisResponse:
    """Analyze a resume to identify items that need enrichment.

    Uses AI to examine Experience and Projects sections for weak,
    vague, or incomplete descriptions and generates clarifying questions.
    """
    # Fetch resume
    resume = await db.get_resume(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    # Get processed data
    processed_data = resume.get("processed_data")
    if not processed_data:
        raise HTTPException(
            status_code=400,
            detail="Resume has no processed data. Please re-upload the resume.",
        )

    # Build prompt with content language
    resume_json = json.dumps(processed_data)
    language = get_content_language()
    output_language = get_language_name(language)
    prompt = ANALYZE_RESUME_PROMPT.format(
        resume_json=resume_json,
        output_language=output_language
    )

    try:
        # Call LLM with increased max_tokens for non-English languages
        result = await asyncio.wait_for(
            complete_json(prompt, max_tokens=8192, schema_type="enrichment"),
            timeout=180.0,  # 3-minute hard limit
        )

        # Parse response into schema objects
        items_to_enrich = [
            EnrichmentItem(
                item_id=item.get("item_id", f"item_{i}"),
                item_type=item.get("item_type", "experience"),
                title=item.get("title", ""),
                subtitle=item.get("subtitle"),
                current_description=item.get("current_description", []),
                weakness_reason=item.get("weakness_reason", ""),
            )
            for i, item in enumerate(result.get("items_to_enrich", []))
        ]

        questions = [
            EnrichmentQuestion(
                question_id=q.get("question_id", f"q_{i}"),
                item_id=q.get("item_id", ""),
                question=q.get("question", ""),
                placeholder=q.get("placeholder", ""),
            )
            for i, q in enumerate(result.get("questions", []))
        ]

        return AnalysisResponse(
            items_to_enrich=items_to_enrich,
            questions=questions,
            analysis_summary=result.get("analysis_summary"),
        )

    except asyncio.TimeoutError:
        logger.error("Resume analysis timed out for resume %s", resume_id)
        raise HTTPException(
            status_code=504,
            detail="Resume analysis timed out. Please try again with a shorter resume or a faster model.",
        )
    except ValueError as e:
        logger.error("Resume analysis failed (content): %s", e)
        raise HTTPException(
            status_code=422,
            detail="The AI returned an unreadable response. Please try again or switch models.",
        )
    except Exception as e:
        logger.error("Resume analysis failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Failed to analyze resume. Please try again.",
        )


@router.post("/enhance", response_model=EnhancementPreview)
async def generate_enhancements(request: EnhanceRequest) -> EnhancementPreview:
    """Generate enhanced descriptions from user answers.

    Takes the answers to clarifying questions and uses AI to generate
    improved description bullets for each item.
    """
    # Fetch resume
    resume = await db.get_resume(request.resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    processed_data = resume.get("processed_data")
    if not processed_data:
        raise HTTPException(
            status_code=400,
            detail="Resume has no processed data.",
        )

    # Group answers by item_id.
    # When all answers carry item_id (from the analysis step), we can skip
    # the expensive re-analysis LLM call and derive item details from the
    # resume's processed_data directly.
    answers_by_item: dict[str, list[AnswerInput]] = {}
    item_details: dict[str, dict] = {}
    # question_id → question dict, populated only in the legacy path
    questions_by_id: dict[str, dict] = {}

    if all(a.item_id for a in request.answers) and all(
        _extract_item_from_resume(processed_data, a.item_id or "")
        for a in request.answers
    ):
        # Fast path — no re-analysis needed
        for answer in request.answers:
            item_id = answer.item_id or ""
            answers_by_item.setdefault(item_id, []).append(answer)
            if item_id not in item_details:
                item_details[item_id] = _extract_item_from_resume(
                    processed_data, item_id
                )
    else:
        # Legacy path — re-analyze to get question-to-item mapping
        resume_json = json.dumps(processed_data)
        language = get_content_language()
        output_language = get_language_name(language)
        analysis_prompt = ANALYZE_RESUME_PROMPT.format(
            resume_json=resume_json,
            output_language=output_language,
        )

        try:
            analysis_result = await asyncio.wait_for(
                complete_json(analysis_prompt, max_tokens=8192, schema_type="enrichment"),
                timeout=180.0,
            )
        except asyncio.TimeoutError:
            logger.error("Resume re-analysis timed out for resume %s", request.resume_id)
            raise HTTPException(
                status_code=504,
                detail="Resume analysis timed out. Please try again with a shorter resume or a faster model.",
            )
        except ValueError as e:
            logger.error("Resume re-analysis failed (content): %s", e)
            raise HTTPException(
                status_code=422,
                detail="The AI returned an unreadable response. Please try again or switch models.",
            )
        except Exception as e:
            logger.error("Failed to re-analyze resume: %s", e)
            raise HTTPException(
                status_code=500,
                detail="Failed to process enhancements. Please try again.",
            )

        question_to_item: dict[str, str] = {}
        for q in analysis_result.get("questions", []):
            qid = q.get("question_id", "")
            question_to_item[qid] = q.get("item_id", "")
            questions_by_id[qid] = q

        for item in analysis_result.get("items_to_enrich", []):
            item_id = item.get("item_id", "")
            item_details[item_id] = item

        for answer in request.answers:
            item_id = question_to_item.get(answer.question_id, "")
            if item_id:
                answers_by_item.setdefault(item_id, []).append(answer)

    # Generate enhanced descriptions for each item
    enhancements: list[EnhancedDescription] = []

    for item_id, answers in answers_by_item.items():
        item = item_details.get(item_id, {})
        if not item:
            continue

        # Format answers with their questions for context.
        # In the fast path questions_by_id is empty, so fall back to
        # question_text carried on the AnswerInput itself.
        answers_text = ""
        for answer in answers:
            matching_q = questions_by_id.get(answer.question_id)
            question = (
                matching_q.get("question", "") if matching_q else answer.question_text
            )
            if question:
                answers_text += f"Q: {question}\n"
                answers_text += f"A: {answer.answer}\n\n"
            else:
                answers_text += f"Additional info: {answer.answer}\n\n"

        # Build enhancement prompt with content language
        current_desc = item.get("current_description", [])
        current_desc_text = "\n".join(f"- {d}" for d in current_desc) if current_desc else "(No description)"
        
        language = get_content_language()
        output_language = get_language_name(language)

        prompt = ENHANCE_DESCRIPTION_PROMPT.format(
            item_type=item.get("item_type", "experience"),
            title=item.get("title", ""),
            subtitle=item.get("subtitle", ""),
            current_description=current_desc_text,
            answers=answers_text.strip(),
            output_language=output_language,
        )

        try:
            result = await complete_json(prompt, schema_type="diff")
            # Get additional bullets from LLM (new key name)
            additional_bullets = result.get("additional_bullets", [])
            # Fallback to old key for backwards compatibility
            if not additional_bullets:
                additional_bullets = result.get("enhanced_description", [])
            # Guard against non-list returns from LLM
            if not isinstance(additional_bullets, list):
                additional_bullets = []
            additional_bullets = [str(b) for b in additional_bullets if b]

            enhancements.append(
                EnhancedDescription(
                    item_id=item_id,
                    item_type=item.get("item_type", "experience"),
                    title=item.get("title", ""),
                    original_description=current_desc,
                    enhanced_description=additional_bullets,  # These are NEW bullets to add
                )
            )
        except Exception as e:
            logger.warning(f"Failed to enhance item {item_id}: {e}")
            # Continue with other items

    return EnhancementPreview(enhancements=enhancements)


@router.post("/apply/{resume_id}")
async def apply_enhancements(
    resume_id: str, request: ApplyEnhancementsRequest
) -> dict:
    """Apply enhancements to the master resume.

    Updates the resume's Experience and Projects sections with
    the enhanced descriptions.
    """
    # Fetch resume
    resume = await db.get_resume(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    processed_data = resume.get("processed_data")
    if not processed_data:
        raise HTTPException(
            status_code=400,
            detail="Resume has no processed data.",
        )

    # Make a copy to modify
    updated_data = copy.deepcopy(processed_data)

    # Apply each enhancement by ADDING new bullets to existing description
    for enhancement in request.enhancements:
        item_id = enhancement.item_id
        item_type = enhancement.item_type
        additional_bullets = enhancement.enhanced_description  # These are NEW bullets to add

        if item_type == "experience":
            # Parse item_id like "exp_0" to get index
            try:
                index = int(item_id.split("_")[1])
                if "workExperience" in updated_data and index < len(updated_data["workExperience"]):
                    # Get existing description and ADD new bullets
                    existing_desc = updated_data["workExperience"][index].get("description", [])
                    if isinstance(existing_desc, list):
                        updated_data["workExperience"][index]["description"] = existing_desc + additional_bullets
                    else:
                        # Handle edge case where description might be a string
                        updated_data["workExperience"][index]["description"] = [existing_desc] + additional_bullets if existing_desc else additional_bullets
            except (ValueError, IndexError) as e:
                logger.warning(f"Could not apply experience enhancement for {item_id}: {e}")

        elif item_type == "project":
            # Parse item_id like "proj_0" to get index
            try:
                index = int(item_id.split("_")[1])
                if "personalProjects" in updated_data and index < len(updated_data["personalProjects"]):
                    # Get existing description and ADD new bullets
                    existing_desc = updated_data["personalProjects"][index].get("description", [])
                    if isinstance(existing_desc, list):
                        updated_data["personalProjects"][index]["description"] = existing_desc + additional_bullets
                    else:
                        # Handle edge case where description might be a string
                        updated_data["personalProjects"][index]["description"] = [existing_desc] + additional_bullets if existing_desc else additional_bullets
            except (ValueError, IndexError) as e:
                logger.warning(f"Could not apply project enhancement for {item_id}: {e}")

    # Update the resume in database
    updated_content = json.dumps(updated_data, indent=2)
    try:
        await db.update_resume(
            resume_id,
            {
                "content": updated_content,
                "processed_data": updated_data,
            },
        )
    except Exception as e:
        logger.error(f"Failed to save enhancements to database: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to save enhancements. Please try again.",
        )

    return {
        "message": "Enhancements applied successfully",
        "updated_items": len(request.enhancements),
    }


# ============================================
# AI Regenerate Feature Endpoints
# ============================================


async def _regenerate_experience_or_project(
    item: RegenerateItemInput,
    instruction: str,
    output_language: str,
) -> RegeneratedItem:
    """Regenerate a single experience or project item."""
    current_desc_text = (
        "\n".join(f"- {d}" for d in item.current_content)
        if item.current_content
        else "(No description)"
    )

    prompt = REGENERATE_ITEM_PROMPT.format(
        output_language=output_language,
        item_type=item.item_type,
        title=item.title,
        subtitle=item.subtitle or "",
        current_description=current_desc_text,
        user_instruction=instruction,
    )

    result = await complete_json(prompt, max_tokens=4096, schema_type="diff")

    new_bullets = result.get("new_bullets", [])
    if not isinstance(new_bullets, list):
        new_bullets = []
    new_bullets = [str(b) for b in new_bullets if b]

    return RegeneratedItem(
        item_id=item.item_id,
        item_type=item.item_type,
        title=item.title,
        subtitle=item.subtitle,
        original_content=item.current_content,
        new_content=new_bullets,
        diff_summary=str(result.get("change_summary") or ""),
    )


async def _regenerate_skills(
    item: RegenerateItemInput,
    instruction: str,
    output_language: str,
) -> RegeneratedItem:
    """Regenerate the skills section, grouped by category, sourced from master profile."""
    # Fetch master resume to get the source-of-truth skills
    master = await db.get_master_resume()
    master_skills: list[str] = []
    if master:
        processed = master.get("processed_data") or {}
        additional = processed.get("additional") or {}
        master_skills = additional.get("technicalSkills") or []
        # Also check skillGroups as fallback
        if not master_skills:
            skill_groups_raw = additional.get("skillGroups") or []
            if isinstance(skill_groups_raw, list):
                for g in skill_groups_raw:
                    if isinstance(g, dict) and isinstance(g.get("skills"), list):
                        master_skills.extend(str(s) for s in g["skills"] if s)

    logger.debug(
        "regenerate_skills: master_skills=%d items=%s",
        len(master_skills),
        master_skills[:10],
    )
    logger.debug(
        "regenerate_skills: current_content=%d items=%s",
        len(item.current_content),
        item.current_content[:10],
    )

    master_skills_text = ", ".join(master_skills) if master_skills else "(No master skills available)"
    current_skills_text = ", ".join(item.current_content) if item.current_content else "(No skills)"

    prompt = REGENERATE_SKILLS_PROMPT.format(
        output_language=output_language,
        master_skills=master_skills_text,
        current_skills=current_skills_text,
        user_instruction=instruction,
    )

    result = await complete_json(prompt, max_tokens=2048, schema_type="diff")
    logger.debug(
        "regenerate_skills: LLM result keys=%s",
        list(result.keys()) if isinstance(result, dict) else type(result).__name__,
    )

    # Build normalized master lookup for validation (case-insensitive)
    # technicalSkills may be stored as comma-separated strings, so split them
    master_norm: dict[str, str] = {}
    for raw in master_skills:
        for s in str(raw).split(","):
            s = s.strip()
            if s:
                master_norm[s.casefold()] = s

    # Fallback: if master has no skills, use the current resume's skills
    # as the validation set.  The LLM already received them as context.
    if not master_norm and item.current_content:
        for raw in item.current_content:
            for s in str(raw).split(","):
                s = s.strip()
                if s:
                    master_norm[s.casefold()] = s
        logger.warning(
            "regenerate_skills: master_norm empty, falling back to %d current_content skills",
            len(master_norm),
        )

    logger.debug(
        "regenerate_skills: master_norm=%d keys=%s",
        len(master_norm),
        list(master_norm.keys())[:15],
    )

    # Build a secondary fuzzy lookup (strips suffixes like .js, .py, /…)
    def _normalize_skill(name: str) -> str:
        import re as _re

        n = name.casefold()
        n = _re.sub(r"\.js$", "", n)
        n = _re.sub(r"\.ts$", "", n)
        n = _re.sub(r"\.py$", "", n)
        n = _re.sub(r"\s*/\s*.*$", "", n)
        return n.strip()

    master_fuzzy: dict[str, str] = {}
    for orig, normalized in (
        (s, _normalize_skill(s)) for s in master_norm.values()
    ):
        if normalized and normalized not in master_fuzzy:
            master_fuzzy[normalized] = orig

    logger.debug(
        "regenerate_skills: master_fuzzy=%d keys=%s",
        len(master_fuzzy),
        list(master_fuzzy.keys())[:15],
    )

    # Parse grouped output — try common key variants
    raw_groups = result.get("skillGroups") or result.get("skill_groups") or result.get("groups") or []
    if not isinstance(raw_groups, list):
        raw_groups = []
    logger.debug(
        "regenerate_skills: raw_groups=%d groups=%s",
        len(raw_groups),
        [(g.get("name"), len(g.get("skills", []))) for g in raw_groups if isinstance(g, dict)],
    )

    seen: set[str] = set()
    skill_groups: list[dict[str, str]] = []
    all_flat: list[str] = []
    skipped_skills: list[str] = []

    for group in raw_groups:
        if not isinstance(group, dict):
            continue
        group_name = str(group.get("name", "")).strip()
        raw_skills = group.get("skills", [])
        if not isinstance(raw_skills, list) or not group_name:
            continue

        group_skills: list[str] = []
        for s in raw_skills:
            s_str = str(s).strip() if s else ""
            if not s_str:
                continue
            key = s_str.casefold()
            # Exact match first
            resolved = master_norm.get(key)
            # Fuzzy match fallback (e.g. "React.js" ↔ "React")
            if resolved is None:
                fuzzy_key = _normalize_skill(s_str)
                resolved = master_fuzzy.get(fuzzy_key)
            if resolved is None:
                skipped_skills.append(s_str)
                continue
            dedup_key = (group_name.casefold(), resolved.casefold())
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            group_skills.append(resolved)
            all_flat.append(resolved)

        if group_skills:
            skill_groups.append({"name": group_name, "skills": group_skills})

    # If LLM returned no valid groups, fall back to a flat "Skills" group
    if not skill_groups and all_flat:
        skill_groups = [{"name": "Skills", "skills": all_flat}]

    if skipped_skills:
        logger.warning(
            "regenerate_skills: %d skill(s) filtered out (not in master profile): %s",
            len(skipped_skills),
            skipped_skills,
        )
    logger.info(
        "regenerate_skills: result=%d flat, %d groups",
        len(all_flat),
        len(skill_groups),
    )

    return RegeneratedItem(
        item_id=item.item_id,
        item_type=item.item_type,
        title=item.title,
        subtitle=item.subtitle,
        original_content=item.current_content,
        new_content=all_flat,
        new_skill_groups=skill_groups,
        diff_summary=str(result.get("change_summary") or ""),
    )


async def _regenerate_summary(
    item: RegenerateItemInput,
    instruction: str,
    output_language: str,
    resume_data: dict | None = None,
) -> RegeneratedItem:
    """Regenerate the professional summary."""
    import json

    resume_json = json.dumps(resume_data or {}, indent=2, ensure_ascii=False) if resume_data else "(No resume data)"

    prompt = REGENERATE_SUMMARY_PROMPT.format(
        output_language=output_language,
        resume=resume_json,
        user_instruction=instruction,
    )

    result = await complete_json(prompt, max_tokens=2048, schema_type="diff")

    new_summary = result.get("new_summary", "")
    if not isinstance(new_summary, str):
        new_summary = str(new_summary) if new_summary else ""
    new_content = [line for line in new_summary.split("\n") if line.strip()] if new_summary else []

    return RegeneratedItem(
        item_id=item.item_id,
        item_type=item.item_type,
        title=item.title,
        subtitle=item.subtitle,
        original_content=item.current_content,
        new_content=new_content,
        diff_summary=str(result.get("change_summary") or ""),
    )


@router.post("/regenerate", response_model=RegenerateResponse)
async def regenerate_items(request: RegenerateRequest) -> RegenerateResponse:
    """Regenerate selected resume items based on user feedback.

    Takes selected items (experience, projects, skills) and a user instruction,
    then uses AI to rewrite the content addressing the user's concerns.
    """
    # Validate resume exists
    resume = await db.get_resume(request.resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    if not request.items:
        raise HTTPException(status_code=400, detail="No items selected for regeneration")

    # Get language name for LLM
    output_language = get_language_name(request.output_language)

    # Process all items in parallel for better performance
    tasks = []
    for item in request.items:
        if item.item_type == "skills":
            tasks.append(_regenerate_skills(item, request.instruction, output_language))
        elif item.item_type == "summary":
            tasks.append(_regenerate_summary(item, request.instruction, output_language, resume.get("processed_data")))
        else:
            tasks.append(_regenerate_experience_or_project(item, request.instruction, output_language))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    regenerated_items: list[RegeneratedItem] = []
    errors: list[RegenerateItemError] = []

    for item, result in zip(request.items, results):
        if isinstance(result, Exception):
            logger.error(
                "Failed to regenerate item. "
                f"resume_id={request.resume_id} item_id={item.item_id} item_type={item.item_type}",
                exc_info=result,
            )
            errors.append(
                RegenerateItemError(
                    item_id=item.item_id,
                    item_type=item.item_type,
                    title=item.title,
                    subtitle=item.subtitle,
                    message="Failed to regenerate this item. Please try again.",
                )
            )
            continue

        regenerated_items.append(result)

    if not regenerated_items:
        raise HTTPException(
            status_code=500,
            detail="Failed to regenerate content. Please try again.",
        )

    return RegenerateResponse(regenerated_items=regenerated_items, errors=errors)


@router.post("/apply-regenerated/{resume_id}")
async def apply_regenerated_items(
    resume_id: str, regenerated_items: list[RegeneratedItem]
) -> dict:
    """Apply regenerated items to the master resume.

    Updates the resume's Experience, Projects, and Skills sections with
    the regenerated descriptions.
    """
    # Fetch resume
    resume = await db.get_resume(resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    processed_data = resume.get("processed_data")
    if not processed_data:
        raise HTTPException(
            status_code=400,
            detail="Resume has no processed data.",
        )

    # Make a copy to modify
    updated_data = copy.deepcopy(processed_data)

    def _normalize_match_value(value: str | None) -> str:
        return (value or "").strip().casefold()

    def _normalize_lines(value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            normalized: list[str] = []
            for entry in value:
                text = str(entry).strip()
                if text:
                    normalized.append(text)
            return normalized
        text = str(value).strip()
        return [text] if text else []

    def _normalize_skill_lines(value: object) -> list[str]:
        """Normalize skills list: split comma-separated entries, strip, dedup."""
        if value is None:
            return []
        items: list[str] = []
        if isinstance(value, list):
            for entry in value:
                text = str(entry).strip()
                if text:
                    items.append(text)
        else:
            text = str(value).strip()
            if text:
                items.append(text)
        seen: set[str] = set()
        result: list[str] = []
        for item in items:
            for part in re.split(r"[;,]", item):
                part = part.strip()
                if not part:
                    continue
                key = part.casefold()
                if key in seen:
                    continue
                seen.add(key)
                result.append(part)
        return result

    def _lines_equal(left: object, right: object) -> bool:
        left_norm = [line.casefold() for line in _normalize_lines(left)]
        right_norm = [line.casefold() for line in _normalize_lines(right)]
        return left_norm == right_norm

    def _skills_equal(left: object, right: object) -> bool:
        left_norm = [s.casefold() for s in _normalize_skill_lines(left)]
        right_norm = [s.casefold() for s in _normalize_skill_lines(right)]
        return left_norm == right_norm

    def _find_unique_index_by_metadata(
        entries: list[dict],
        *,
        title_key: str,
        subtitle_key: str,
        expected_title: str,
        expected_subtitle: str | None,
        expected_original_content: list[str],
        content_key: str,
    ) -> int | None:
        expected_title_norm = _normalize_match_value(expected_title)
        expected_subtitle_norm = _normalize_match_value(expected_subtitle)

        if not expected_title_norm:
            return None

        matches: list[int] = []
        for i, entry in enumerate(entries):
            if not isinstance(entry, dict):
                continue
            entry_title = _normalize_match_value(str(entry.get(title_key, "")))
            entry_subtitle = _normalize_match_value(str(entry.get(subtitle_key, "")))

            if entry_title != expected_title_norm:
                continue
            if expected_subtitle_norm and entry_subtitle != expected_subtitle_norm:
                continue
            matches.append(i)

        if len(matches) == 1:
            return matches[0]

        # If metadata is ambiguous, try to disambiguate using the original content.
        matches_by_content = [
            i for i in matches if _lines_equal(entries[i].get(content_key), expected_original_content)
        ]
        if len(matches_by_content) == 1:
            return matches_by_content[0]

        return None

    def _parse_index(item_id: str, pattern: str) -> int | None:
        match = re.fullmatch(pattern, item_id)
        if not match:
            return None
        return int(match.group(1))

    apply_failures: list[str] = []

    # Apply each regenerated item (all-or-nothing to avoid corrupting user data)
    for item in regenerated_items:
        item_id = item.item_id
        item_type = item.item_type
        new_content = item.new_content

        if item_type == "experience":
            experiences = updated_data.get("workExperience", [])
            if not isinstance(experiences, list):
                apply_failures.append(item_id)
                continue

            index = _parse_index(item_id, r"exp_(\d+)")
            if index is None:
                apply_failures.append(item_id)
                continue

            expected_title = item.title
            expected_company = item.subtitle
            expected_original_content = item.original_content

            resolved_index: int | None = None
            if 0 <= index < len(experiences):
                entry = experiences[index] if isinstance(experiences[index], dict) else {}
                entry_title = _normalize_match_value(str(entry.get("title", "")))
                entry_company = _normalize_match_value(str(entry.get("company", "")))
                if entry_title == _normalize_match_value(expected_title) and (
                    not _normalize_match_value(expected_company)
                    or entry_company == _normalize_match_value(expected_company)
                ) and _lines_equal(entry.get("description"), expected_original_content):
                    resolved_index = index

            if resolved_index is None:
                resolved_index = _find_unique_index_by_metadata(
                    experiences,
                    title_key="title",
                    subtitle_key="company",
                    expected_title=expected_title,
                    expected_subtitle=expected_company,
                    expected_original_content=expected_original_content,
                    content_key="description",
                )

            if resolved_index is None:
                logger.warning(
                    "apply-regenerated: experience item mismatch; resume may have changed. "
                    f"resume_id={resume_id} item_id={item_id} expected_title={expected_title!r} "
                    f"expected_company={expected_company!r}"
                )
                apply_failures.append(item_id)
                continue

            entry = experiences[resolved_index]
            if isinstance(entry, dict):
                if not _lines_equal(entry.get("description"), expected_original_content):
                    apply_failures.append(item_id)
                    continue
                entry["description"] = new_content
            else:
                apply_failures.append(item_id)

        elif item_type == "project":
            projects = updated_data.get("personalProjects", [])
            if not isinstance(projects, list):
                apply_failures.append(item_id)
                continue

            index = _parse_index(item_id, r"proj_(\d+)")
            if index is None:
                apply_failures.append(item_id)
                continue

            expected_name = item.title
            expected_role = item.subtitle
            expected_original_content = item.original_content

            resolved_index = None
            if 0 <= index < len(projects):
                entry = projects[index] if isinstance(projects[index], dict) else {}
                entry_name = _normalize_match_value(str(entry.get("name", "")))
                entry_role = _normalize_match_value(str(entry.get("role", "")))
                if entry_name == _normalize_match_value(expected_name) and (
                    not _normalize_match_value(expected_role)
                    or entry_role == _normalize_match_value(expected_role)
                ) and _lines_equal(entry.get("description"), expected_original_content):
                    resolved_index = index

            if resolved_index is None:
                resolved_index = _find_unique_index_by_metadata(
                    projects,
                    title_key="name",
                    subtitle_key="role",
                    expected_title=expected_name,
                    expected_subtitle=expected_role,
                    expected_original_content=expected_original_content,
                    content_key="description",
                )

            if resolved_index is None:
                logger.warning(
                    "apply-regenerated: project item mismatch; resume may have changed. "
                    f"resume_id={resume_id} item_id={item_id} expected_name={expected_name!r} "
                    f"expected_role={expected_role!r}"
                )
                apply_failures.append(item_id)
                continue

            entry = projects[resolved_index]
            if isinstance(entry, dict):
                if not _lines_equal(entry.get("description"), expected_original_content):
                    apply_failures.append(item_id)
                    continue
                entry["description"] = new_content
            else:
                apply_failures.append(item_id)

        elif item_type == "skills":
            # Update technical skills (stored in additional.technicalSkills)
            expected_original_content = item.original_content

            additional = updated_data.get("additional")
            if isinstance(additional, dict) and "technicalSkills" in additional:
                if not _skills_equal(additional.get("technicalSkills"), expected_original_content):
                    apply_failures.append(item_id)
                    continue
                additional["technicalSkills"] = new_content
                # Write grouped skills if the LLM produced them
                if item.new_skill_groups is not None:
                    additional["skillGroups"] = item.new_skill_groups
            elif "technicalSkills" in updated_data:
                # Fallback for legacy data structure
                if not _skills_equal(updated_data.get("technicalSkills"), expected_original_content):
                    apply_failures.append(item_id)
                    continue
                updated_data["technicalSkills"] = new_content
            else:
                apply_failures.append(item_id)

        elif item_type == "summary":
            # Update summary (stored as a string in resumeData.summary)
            expected_original_content = item.original_content
            current_summary = updated_data.get("summary", "")
            current_summary_lines = (
                [line for line in current_summary.split("\n") if line.strip()]
                if isinstance(current_summary, str)
                else []
            )

            if not _lines_equal(current_summary_lines, expected_original_content):
                apply_failures.append(item_id)
                continue

            # Join new content lines into a single summary string
            updated_data["summary"] = "\n".join(new_content)

    if apply_failures:
        logger.warning(
            "apply-regenerated: refusing to apply due to mismatched/missing items. "
            f"resume_id={resume_id} item_ids={apply_failures}"
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "Resume content changed or could not be uniquely matched. "
                "Please regenerate and try again."
            ),
        )

    # Update the resume in database
    updated_content = json.dumps(updated_data, indent=2)
    try:
        await db.update_resume(
            resume_id,
            {
                "content": updated_content,
                "processed_data": updated_data,
            },
        )
    except Exception as e:
        logger.error(f"Failed to save regenerated content to database: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to save changes. Please try again.",
        )

    return {
        "message": "Changes applied successfully",
        "updated_items": len(regenerated_items),
    }


# ============================================
# Project Bullet Generation Endpoint
# ============================================


def _clean_project_bullets(raw: object) -> list[str]:
    """Normalize LLM bullet output: strip list markers, drop empties/dupes, cap at 5."""
    if not isinstance(raw, list):
        return []
    bullets: list[str] = []
    seen: set[str] = set()
    for entry in raw:
        text = re.sub(r"^[-*•]\s*", "", str(entry).strip())
        if text and text not in seen:
            seen.add(text)
            bullets.append(text)
    return bullets[:5]


@router.post("/generate-project-bullets", response_model=GenerateProjectBulletsResponse)
async def generate_project_bullets(
    request: GenerateProjectBulletsRequest,
) -> GenerateProjectBulletsResponse:
    """Generate resume bullet points for a project from its README/description.

    If the project has a README, the README is the primary source of facts.
    Otherwise the project description and languages are used, combined with an
    optional user mini-prompt that is expanded into polished bullets.
    """
    output_language = get_language_name(request.output_language)

    readme = (request.readme or "").strip()
    if readme:
        readme = readme[:2500]

    description_text = (
        "\n".join(f"- {d}" for d in request.description)
        if request.description
        else "(No description)"
    )
    languages_text = ", ".join(request.languages) if request.languages else "(none listed)"

    source_material = readme or description_text
    if not source_material:
        source_material = "(No project source material provided)"

    if request.prompt and request.prompt.strip():
        user_instruction = (
            "USER'S FOCUS/INSTRUCTION (expand this idea into polished bullets; "
            "keep every detail the user mentioned):\n"
            f"{request.prompt.strip()}\n"
        )
    else:
        user_instruction = "(No additional user instruction)"

    prompt = GENERATE_PROJECT_BULLETS_PROMPT.format(
        output_language=output_language,
        name=request.name,
        role=request.role or "",
        years=request.years or "",
        github=request.github or "",
        website=request.website or "",
        description=description_text,
        languages=languages_text,
        source_material=source_material,
        user_instruction=user_instruction,
    )

    result = await complete_json(prompt, max_tokens=4096, schema_type="diff")

    return GenerateProjectBulletsResponse(bullets=_clean_project_bullets(result.get("bullets")))


# ============================================
# Company Research Endpoint
# ============================================

RESEARCH_SYNTHESIS_PROMPT = """You are a business research analyst. Synthesize the following raw data about a company into a concise, structured summary useful for writing a personalized outreach email.

COMPANY: {company_name}

WEBSITE CONTENT:
{website_content}

LINKEDIN PAGE CONTENT:
{linkedin_content}

HIRING SIGNALS (from LinkedIn job postings):
{hiring_signals}

TASK: Produce a JSON object with these fields:
- "summary": 2-3 sentence company overview (what they do, mission, key products)
- "recent_news": Notable recent developments, funding, launches (or "No recent news found" if none)
- "tech_stack": Known technologies, tools, platforms (or "Not identified" if unknown)
- "culture": Company culture signals — values, work style, team size hints (or "Not identified" if unknown)

RULES:
- Base everything ONLY on the provided data. Do NOT invent facts.
- Be concise — each field should be 1-3 sentences max.
- If a section has no useful data, write a brief note saying so.
- Output JSON only, no other text."""

RESEARCH_SOURCES_PROMPT = """You are a business research analyst. Based on the company name and any available metadata, suggest up to 3 URLs that would contain useful information about this company for writing a personalized outreach email.

COMPANY: {company_name}
INDUSTRY: {industry}
WEBSITE: {website}
LINKEDIN: {linkedin_url}

TASK: Return a JSON object with a single field "urls" containing a list of URLs to crawl. Prioritize:
1. The company website (if provided and valid)
2. LinkedIn company page (if provided)
3. Any other relevant public page (About page, blog, press page)

OUTPUT FORMAT (JSON only):
{{"urls": ["https://...", "https://..."]}}"""


@router.post("/research-company", response_model=ResearchCompanyResponse)
async def research_company(
    request: ResearchCompanyRequest,
) -> ResearchCompanyResponse:
    """Research a company by crawling its website, LinkedIn page, and checking hiring signals.

    Uses crawl4ai for web fetching and LinkedIn MCP for job postings.
    Returns structured research data to personalize outreach emails.
    """
    from app.services.mcp.crawl4ai import Crawl4AIAdapter

    website_content = ""
    linkedin_content = ""
    hiring_signals = ""
    sources: list[str] = []

    # --- Step 1: Determine which URLs to crawl ---
    urls_to_crawl: list[str] = []
    if request.website:
        urls_to_crawl.append(request.website)
    if request.linkedin_url:
        urls_to_crawl.append(request.linkedin_url)

    # If we have few URLs, also ask the LLM to suggest additional sources
    if len(urls_to_crawl) < 3:
        try:
            sources_prompt = RESEARCH_SOURCES_PROMPT.format(
                company_name=request.company_name,
                industry=request.industry or "not specified",
                website=request.website or "not provided",
                linkedin_url=request.linkedin_url or "not provided",
            )
            suggested = await complete_json(sources_prompt, max_tokens=512, schema_type="diff")
            suggested_urls = suggested.get("urls", [])
            if isinstance(suggested_urls, list):
                for u in suggested_urls:
                    if isinstance(u, str) and u.startswith("http") and u not in urls_to_crawl:
                        urls_to_crawl.append(u)
                        if len(urls_to_crawl) >= 5:
                            break
        except Exception:
            pass  # Best-effort — proceed with what we have

    # --- Step 2: Crawl URLs with crawl4ai ---
    crawler = Crawl4AIAdapter()
    if urls_to_crawl:
        try:
            crawled = await crawler.fetch_pages(urls_to_crawl)
            for url, content in crawled.items():
                if not content:
                    continue
                sources.append(url)
                if url == request.website:
                    website_content = content
                elif url == request.linkedin_url:
                    linkedin_content = content
                # Additional sources go into website_content if it's empty
                elif not website_content:
                    website_content += f"\n\nSource: {url}\n{content}"
        except Exception as exc:
            logger.warning("crawl4ai batch crawl failed: %s", exc)

    # Fallback: try Jina Reader for any URLs that crawl4ai missed
    if (not website_content and request.website) or (
        not linkedin_content and request.linkedin_url
    ):
        try:
            from app.services.mcp.web import WebAdapter

            jina = WebAdapter()
            if not website_content and request.website:
                website_content = await jina.fetch_page(request.website)
                if website_content:
                    sources.append(request.website)
            if not linkedin_content and request.linkedin_url:
                linkedin_content = await jina.fetch_page(request.linkedin_url)
                if linkedin_content:
                    sources.append(request.linkedin_url)
        except Exception:
            pass

    # --- Step 3: Check LinkedIn MCP for hiring signals ---
    try:
        from app.services.job_scraper import get_mcp_manager

        manager = get_mcp_manager()
        linkedin_adapter = None
        for adapter in manager._adapters:
            if adapter.name == "linkedin" and adapter.enabled:
                linkedin_adapter = adapter
                break

        if linkedin_adapter and await linkedin_adapter.is_available():
            from app.schemas.job_scraper import JobSearchFilters

            filters = JobSearchFilters(
                keywords=request.company_name,
                locations=[],
                job_types=[],
                experience_levels=[],
                work_types=[],
                date_posted="month",
                easy_apply_only=False,
                max_pages=1,
            )
            jobs = await linkedin_adapter.search_jobs(
                f"{request.company_name}", filters
            )
            if jobs:
                lines = [f"Found {len(jobs)} active job posting(s):"]
                for job in jobs[:5]:
                    lines.append(f"- {job.title} ({job.location or 'Location not specified'})")
                hiring_signals = "\n".join(lines)
    except Exception as exc:
        logger.debug("LinkedIn MCP search failed (non-critical): %s", exc)

    # --- Step 4: AI synthesis ---
    research_summary = ""
    if website_content or linkedin_content or hiring_signals:
        try:
            synthesis_prompt = RESEARCH_SYNTHESIS_PROMPT.format(
                company_name=request.company_name,
                website_content=website_content or "(No website content available)",
                linkedin_content=linkedin_content or "(No LinkedIn content available)",
                hiring_signals=hiring_signals or "(No hiring signals available)",
            )
            result = await complete_json(synthesis_prompt, max_tokens=1024, schema_type="diff")
            parts = []
            if result.get("summary"):
                parts.append(f"Overview: {result['summary']}")
            if result.get("recent_news") and "no recent" not in result["recent_news"].lower():
                parts.append(f"Recent news: {result['recent_news']}")
            if result.get("tech_stack") and "not identified" not in result["tech_stack"].lower():
                parts.append(f"Tech stack: {result['tech_stack']}")
            if result.get("culture") and "not identified" not in result["culture"].lower():
                parts.append(f"Culture: {result['culture']}")
            research_summary = "\n".join(parts)
        except Exception as exc:
            logger.warning("Research synthesis failed: %s", exc)
            # Fallback: use raw content as summary
            if website_content:
                research_summary = f"Website content:\n{website_content[:2000]}"
            if hiring_signals:
                research_summary += f"\n\n{hiring_signals}"

    return ResearchCompanyResponse(
        company_name=request.company_name,
        website_content=website_content[:3000],
        linkedin_content=linkedin_content[:3000],
        hiring_signals=hiring_signals,
        research_summary=research_summary,
        sources=sources,
    )


# ============================================
# Outreach Email Generation Endpoint
# ============================================

_PURPOSE_LABELS: dict[str, str] = {
    "internship": "Applying for an internship opportunity",
    "job": "Applying for an open role at the company",
    "cold": "General introduction and interest in the company",
}


def _build_sender_info(processed: dict | None) -> str:
    """Extract a compact sender profile from a resume for the prompt."""
    if not processed:
        return "(No sender information available)"
    personal = processed.get("personalInfo") or {}
    lines: list[str] = []
    if personal.get("name"):
        lines.append(f"Name: {personal['name']}")
    if personal.get("email"):
        lines.append(f"Email: {personal['email']}")
    if personal.get("phone"):
        lines.append(f"Phone: {personal['phone']}")
    if personal.get("location"):
        lines.append(f"Location: {personal['location']}")
    if personal.get("website"):
        lines.append(f"Website: {personal['website']}")
    if personal.get("github"):
        lines.append(f"GitHub: {personal['github']}")
    if personal.get("linkedin"):
        lines.append(f"LinkedIn: {personal['linkedin']}")
    summary = str(processed.get("summary") or "").strip()
    if summary:
        lines.append(f"Summary: {summary[:600]}")
    additional = processed.get("additional") or {}
    if isinstance(additional, dict):
        skills = [
            s
            for s in (additional.get("technicalSkills") or [])
            if isinstance(s, str) and s.strip()
        ][:10]
        if skills:
            lines.append("Top skills: " + ", ".join(skills))
        languages = [
            s
            for s in (additional.get("languages") or [])
            if isinstance(s, str) and s.strip()
        ][:5]
        if languages:
            lines.append("Languages: " + ", ".join(languages))

    # Include projects from the profile
    projects = processed.get("personalProjects") or []
    if isinstance(projects, list) and projects:
        project_lines: list[str] = []
        for proj in projects[:6]:  # Limit to 6 most recent
            if not isinstance(proj, dict):
                continue
            name = str(proj.get("name") or "").strip()
            if not name:
                continue
            desc_bullets = proj.get("description") or []
            if isinstance(desc_bullets, list):
                desc_text = "; ".join(
                    str(d) for d in desc_bullets[:3] if isinstance(d, str) and d.strip()
                )
            else:
                desc_text = str(desc_bullets)[:200]
            tech_hint = ""
            if proj.get("github"):
                tech_hint += f" | GitHub: {proj['github']}"
            if proj.get("website"):
                tech_hint += f" | Live: {proj['website']}"
            project_lines.append(f"  - {name}: {desc_text[:200]}{tech_hint}")
        if project_lines:
            lines.append("Projects:\n" + "\n".join(project_lines))

    return "\n".join(lines) or "(No sender information available)"


def _build_contact_footer(processed: dict | None) -> str:
    """Build a contact info footer block for the email with markdown links."""
    if not processed:
        return ""
    personal = processed.get("personalInfo") or {}
    parts: list[str] = []
    if personal.get("name"):
        parts.append(f"**{personal['name']}**")
    if personal.get("email"):
        parts.append(f"[{personal['email']}](mailto:{personal['email']})")
    if personal.get("phone"):
        parts.append(f"[{personal['phone']}](tel:{personal['phone']})")
    if personal.get("website"):
        url = personal["website"]
        if not url.startswith("http"):
            url = f"https://{url}"
        parts.append(f"[Website]({url})")
    if personal.get("linkedin"):
        url = personal["linkedin"]
        if not url.startswith("http"):
            url = f"https://{url}"
        parts.append(f"[LinkedIn]({url})")
    if personal.get("github"):
        url = personal["github"]
        if not url.startswith("http"):
            url = f"https://{url}"
        parts.append(f"[GitHub]({url})")
    return " | ".join(parts)


@router.post("/generate-outreach-email", response_model=GenerateOutreachEmailResponse)
async def generate_outreach_email(
    request: GenerateOutreachEmailRequest,
) -> GenerateOutreachEmailResponse:
    """Generate a personalized outreach email to a company.

    The email is personalized with the sender's resume (name, summary, skills)
    and the company's stored information. ``resume_id`` selects which resume to
    base the profile on; when omitted (or not found) the master resume is used.
    ``purpose`` selects the outreach angle; ``custom_purpose`` overrides it
    when ``purpose=custom``.
    """
    output_language = get_language_name(request.output_language)

    if request.purpose == "custom":
        purpose_text = request.custom_purpose.strip() if request.custom_purpose else "General outreach"
    else:
        purpose_text = _PURPOSE_LABELS.get(request.purpose, _PURPOSE_LABELS["cold"])

    resume: dict | None = None
    if request.resume_id:
        resume = await db.get_resume(request.resume_id)
    if not resume:
        resume = await db.get_master_resume()
    sender_info = _build_sender_info(resume.get("processed_data") if resume else None)
    contact_footer = _build_contact_footer(resume.get("processed_data") if resume else None)

    template, is_custom = _resolve_feature_prompt(
        "outreach_email_prompt", GENERATE_OUTREACH_EMAIL_PROMPT
    )
    try:
        prompt = template.format(
            output_language=output_language,
            company_name=request.company_name or "(Company)",
            company_email=request.company_email or "(unknown)",
            industry=request.industry or "not specified",
            company_size=request.company_size or "not specified",
            company_type=request.company_type or "not specified",
            website=request.website or "not specified",
            linkedin_url=request.linkedin_url or "not specified",
            recipient_name=request.recipient_name or "not provided",
            purpose=purpose_text,
            sender_info=sender_info,
        )
    except (KeyError, IndexError, ValueError) as e:
        if not is_custom:
            raise
        logger.warning(
            "Custom outreach email prompt failed to format (%s); falling back to default",
            e,
        )
        prompt = GENERATE_OUTREACH_EMAIL_PROMPT.format(
            output_language=output_language,
            company_name=request.company_name or "(Company)",
            company_email=request.company_email or "(unknown)",
            industry=request.industry or "not specified",
            company_size=request.company_size or "not specified",
            company_type=request.company_type or "not specified",
            website=request.website or "not specified",
            linkedin_url=request.linkedin_url or "not specified",
            recipient_name=request.recipient_name or "not provided",
            purpose=purpose_text,
            sender_info=sender_info,
        )

    if request.company_research and request.company_research.strip():
        prompt = (
            f"{prompt}\n\n"
            f"Additional research about this company "
            f"(use this to personalize the email — reference specific details):\n"
            f"{request.company_research.strip()}"
        )

    if contact_footer:
        prompt = (
            f"{prompt}\n\n"
            f"CONTACT FOOTER (append this exactly at the end of the email body, "
            f"separated by a blank line):\n{contact_footer}"
        )

    if request.instruction and request.instruction.strip():
        prompt = (
            f"{prompt}\n\n"
            f"User's additional instructions for this generation "
            f"(follow them precisely):\n{request.instruction.strip()}"
        )

    result = await complete_json(prompt, max_tokens=4096, schema_type="diff")

    subject = str(result.get("subject") or "").strip()
    body = str(result.get("body") or "").strip()
    return GenerateOutreachEmailResponse(subject=subject[:200], body=body[:10000])
