"""Career profile endpoints (My Profile page).

Profile CRUD, skills and certifications, plus the career-memory LLM features:
chat Q&A, rejection-learning insights and the skill-ROI engine.
"""

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException

from app.database import db
from app.schemas.models import _split_list_entries
from app.schemas.profile import (
    CareerActionResponse,
    CareerAskRequest,
    CareerAskResponse,
    CareerInsightsResponse,
    CareerMemoryResponse,
    CareerRoiRequest,
    CareerRoiResponse,
    CertificationCreate,
    CertificationResponse,
    CertificationUpdate,
    ProfileBundleResponse,
    ProfileResponse,
    ProfileSuggestionsResponse,
    ProfileUpdate,
    SeedFromResumeRequest,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
)
from app.services.career_profile import (
    _llm_configured,
    answer_career_question,
    build_career_memory,
    build_profile_suggestions,
    compute_skill_roi,
    generate_roi_advice,
    get_career_insights as get_cached_career_insights,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/profile", tags=["Career Profile"])

# Personal-info keys seedable from the master resume's personalInfo.
_SEEDABLE_FIELDS = (
    "name",
    "title",
    "email",
    "phone",
    "location",
    "website",
    "linkedin",
    "github",
)


@router.get("", response_model=ProfileBundleResponse)
async def get_profile() -> ProfileBundleResponse:
    """Get the career profile plus skills and certifications (auto-creates)."""
    profile = await db.get_career_profile()
    if profile is None:
        profile = await db.create_career_profile()
    skills = await db.list_career_skills()
    certifications = await db.list_career_certifications()
    return ProfileBundleResponse(
        profile=ProfileResponse(**profile),
        skills=[SkillResponse(**skill) for skill in skills],
        certifications=[
            CertificationResponse(**certification) for certification in certifications
        ],
    )


@router.put("", response_model=ProfileResponse)
async def update_profile(request: ProfileUpdate) -> ProfileResponse:
    """Upsert the career profile (created on first write)."""
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    try:
        updated = await db.update_career_profile(updates)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ProfileResponse(**updated)


def _work_experience_from_resume(processed: dict[str, Any]) -> list[dict[str, Any]]:
    """Map the resume's ``workExperience`` section to profile work entries."""
    items: list[dict[str, Any]] = []
    for entry in processed.get("workExperience") or []:
        if not isinstance(entry, dict):
            continue
        role = str(entry.get("title") or "").strip()
        company = str(entry.get("company") or "").strip()
        if not role and not company:
            continue
        items.append(
            {
                "role": role,
                "company": company or None,
                "location": str(entry.get("location") or "").strip() or None,
                "years": str(entry.get("years") or "").strip() or None,
                "description": [
                    bullet.strip()
                    for bullet in (entry.get("description") or [])
                    if str(bullet).strip()
                ],
            }
        )
    return items


def _string_list_from_resume(
    processed: dict[str, Any], key: str
) -> list[str]:
    """Pull a free-text list (languages/awards) from the resume's additional block.

    Entries are split on commas/semicolons so merged strings like
    "English, French" become separate items (defense for resumes parsed
    before comma-splitting was normalized at parse time).
    """
    additional = processed.get("additional") or {}
    raw = additional.get(key) or []
    items = [str(item).strip() for item in raw if str(item).strip()]
    entries: list[str] = []
    for item in items:
        entries.extend(_split_list_entries(item))
    return entries


async def _merge_resume_skills(processed: dict[str, Any]) -> None:
    """Add the resume's technical skills to the profile (merge, never replace)."""
    additional = processed.get("additional") or {}
    names = [str(name).strip() for name in additional.get("technicalSkills") or []]
    names = [
        split
        for name in names
        for split in _split_list_entries(name)
        if split
    ]
    names = list(dict.fromkeys(names))
    if not names:
        return
    existing = {skill["name"].lower() for skill in await db.list_career_skills()}
    for name in names:
        if name.lower() not in existing:
            await db.create_career_skill(name=name)
            existing.add(name.lower())


@router.post("/seed-from-master", response_model=ProfileResponse)
async def seed_profile_from_master(
    request: SeedFromResumeRequest | None = None,
) -> ProfileResponse:
    """Seed the profile from a resume (default: the master resume).

    Copies personal info, professional summary, technical skills (merged into
    the existing skill list), work experience, languages and honors/awards
    (replacing the profile's lists), and records the source resume as the
    profile's reference (shown in the profile header).
    """
    payload = request or SeedFromResumeRequest()
    if payload.resume_id is not None:
        resume = await db.get_resume(payload.resume_id)
        if resume is None:
            raise HTTPException(status_code=404, detail="Resume not found.")
    else:
        resume = await db.get_master_resume()
        if resume is None:
            raise HTTPException(
                status_code=404, detail="No master resume found. Upload one first."
            )
    processed = resume.get("processed_data") or {}
    personal_info = processed.get("personalInfo") or {}
    updates: dict[str, Any] = {
        key: value
        for key, value in personal_info.items()
        if key in _SEEDABLE_FIELDS and isinstance(value, str) and value.strip()
    }
    summary = str(processed.get("summary") or "").strip()
    if summary:
        updates["summary"] = summary
    experience = _work_experience_from_resume(processed)
    if experience:
        updates["work_experience"] = experience
    # Languages/awards replace the profile lists when the resume has them.
    languages = _string_list_from_resume(processed, "languages")
    if languages:
        updates["languages"] = languages
    awards = _string_list_from_resume(processed, "awards")
    if awards:
        updates["awards"] = awards
    updates["source_resume_id"] = resume["resume_id"]
    updates["source_resume_title"] = resume.get("title") or resume.get("filename") or "Resume"
    updated = await db.update_career_profile(updates)
    await _merge_resume_skills(processed)
    return ProfileResponse(**updated)


@router.post("/skills", response_model=SkillResponse, status_code=201)
async def create_skill(request: SkillCreate) -> SkillResponse:
    """Add a skill (case-insensitive name dedupe → 409 on duplicates)."""
    existing = await db.get_career_skill_by_name(request.name)
    if existing is not None:
        raise HTTPException(status_code=409, detail="A skill with this name already exists.")
    created = await db.create_career_skill(
        name=request.name,
        category=request.category,
        proficiency=request.proficiency,
        years_experience=request.years_experience,
        last_used=request.last_used,
    )
    return SkillResponse(**created)


@router.patch("/skills/{skill_id}", response_model=SkillResponse)
async def update_skill(skill_id: str, request: SkillUpdate) -> SkillResponse:
    """Update a skill's editable fields."""
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    try:
        updated = await db.update_career_skill(skill_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if updated is None:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return SkillResponse(**updated)


@router.delete("/skills/{skill_id}", response_model=CareerActionResponse)
async def delete_skill(skill_id: str) -> CareerActionResponse:
    """Delete a skill."""
    deleted = await db.delete_career_skill(skill_id)
    return CareerActionResponse(
        message="Skill deleted." if deleted else "Skill not found.",
        affected=1 if deleted else 0,
    )


@router.post("/certifications", response_model=CertificationResponse, status_code=201)
async def create_certification(
    request: CertificationCreate,
) -> CertificationResponse:
    """Add a certification."""
    created = await db.create_career_certification(
        name=request.name,
        issuer=request.issuer,
        date_obtained=request.date_obtained,
        url=request.url,
    )
    return CertificationResponse(**created)


@router.patch("/certifications/{certification_id}", response_model=CertificationResponse)
async def update_certification(
    certification_id: str, request: CertificationUpdate
) -> CertificationResponse:
    """Update a certification's editable fields."""
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    updated = await db.update_career_certification(certification_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Certification not found.")
    return CertificationResponse(**updated)


@router.delete("/certifications/{certification_id}", response_model=CareerActionResponse)
async def delete_certification(certification_id: str) -> CareerActionResponse:
    """Delete a certification."""
    deleted = await db.delete_career_certification(certification_id)
    return CareerActionResponse(
        message="Certification deleted." if deleted else "Certification not found.",
        affected=1 if deleted else 0,
    )


@router.get("/memory", response_model=CareerMemoryResponse)
async def get_career_memory() -> CareerMemoryResponse:
    """Get the aggregated career-memory bundle (debug / reuse endpoint)."""
    return CareerMemoryResponse(**await build_career_memory())


@router.post("/ask", response_model=CareerAskResponse)
async def ask_career_question(request: CareerAskRequest) -> CareerAskResponse:
    """Ask the career advisor a question over the career memory."""
    if not _llm_configured():
        raise HTTPException(
            status_code=503,
            detail="LLM is not configured. Add an API key in Settings → AI.",
        )
    try:
        history = [item.model_dump() for item in request.history]
        answer = await answer_career_question(request.question, history)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Career question failed: %s", e)
        raise HTTPException(
            status_code=500, detail="Career analysis failed. Please try again."
        ) from e
    return CareerAskResponse(answer=answer)


@router.get("/insights", response_model=CareerInsightsResponse)
async def get_career_insights() -> CareerInsightsResponse:
    """Rejection-learning stats + optional LLM narrative (cached per snapshot).

    The narrative (LLM) is cached until the underlying career data changes;
    ``None`` when the LLM is off or the call fails.
    """
    return CareerInsightsResponse(**await get_cached_career_insights())


@router.post("/skill-roi", response_model=CareerRoiResponse)
async def compute_roi(request: CareerRoiRequest) -> CareerRoiResponse:
    """Compute the skill-ROI table; optionally add the 'learn next' advice."""
    jobs = await db.list_scraped_jobs_for_analysis()
    profile_skills = await db.list_career_skills()
    results, note = compute_skill_roi(jobs, profile_skills, request.skills)

    advice = None
    if request.include_advice:
        try:
            advice = await generate_roi_advice(results)
        except Exception as e:
            logger.error("ROI advice failed: %s", e)
    return CareerRoiResponse(results=results, advice=advice, note=note)


@router.get("/suggestions", response_model=ProfileSuggestionsResponse)
async def get_profile_suggestions(
    field: Literal["career_goals", "target_roles", "target_locations"],
) -> ProfileSuggestionsResponse:
    """Tag suggestions for the profile form, from scraped jobs and work history."""
    jobs = await db.list_scraped_jobs_for_analysis()
    profile = await db.get_career_profile()
    return ProfileSuggestionsResponse(
        suggestions=build_profile_suggestions(field, jobs, profile)
    )