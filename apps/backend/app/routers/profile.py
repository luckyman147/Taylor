"""Career profile endpoints (My Profile page).

Profile CRUD, skills and certifications, plus the career-memory LLM features:
chat Q&A, rejection-learning insights and the skill-ROI engine.
"""

import io
import logging
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response
from docx import Document
from docx.shared import Pt, Inches

from app.database import db
from app.pdf import PDFRenderError, render_resume_pdf
from app.routers.github import _get_token, github_repos
from app.schemas.profile import (
    AchievementCreate,
    AchievementResponse,
    AchievementUpdate,
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
    EducationCreate,
    EducationResponse,
    EducationUpdate,
    GitHubImportRequest,
    MarketPositionResponse,
    ProjectIdea,
    ProjectIdeasResponse,
    ProfileBundleResponse,
    ProfileResponse,
    ProfileSuggestionsResponse,
    ProfileUpdate,
    ProjectCreate,
    ProjectAttachment,
    ProjectResponse,
    ProjectUpdate,
    SeedFromResumeRequest,
    SkillCreate,
    SkillResource,
    SkillResourcesRequest,
    SkillResourcesResponse,
    SkillResponse,
    SkillSuggestion,
    SkillSuggestionsResponse,
    SkillUpdate,
)
from app.services.career_graph import (
    fulfill_profile_from_resume,
    import_education_from_master as import_education_from_master_service,
)
from app.services.career_profile import (
    _llm_configured,
    _MAX_ROI_ROWS,
    answer_career_question,
    build_career_memory,
    build_profile_suggestions,
    compute_skill_roi,
    generate_project_ideas,
    generate_roi_advice,
    generate_skill_resources,
    generate_skill_suggestions,
    get_career_insights as get_cached_career_insights,
    partition_roi_rows,
)
from app.services.link_verifier import verify_resource_links
from app.services.market_position import compute_market_position

logger = logging.getLogger(__name__)

# Cached learning-resource rows are considered fresh for 7 days; older ones
# are regenerated (LLM + URL verification) on the next request.
_RESOURCE_FRESHNESS_SECONDS = 7 * 24 * 60 * 60

router = APIRouter(prefix="/profile", tags=["Career Profile"])


@router.get("", response_model=ProfileBundleResponse)
async def get_profile() -> ProfileBundleResponse:
    """Get the career profile plus skills, certifications and career-graph nodes."""
    profile = await db.get_career_profile()
    if profile is None:
        profile = await db.create_career_profile()
    skills = await db.list_career_skills()
    certifications = await db.list_career_certifications()
    education = await db.list_career_education()
    projects = await db.list_career_projects()
    achievements = await db.list_career_achievements()
    return ProfileBundleResponse(
        profile=ProfileResponse(**profile),
        skills=[SkillResponse(**skill) for skill in skills],
        certifications=[
            CertificationResponse(**certification) for certification in certifications
        ],
        education=[EducationResponse(**entry) for entry in education],
        projects=[ProjectResponse(**project) for project in projects],
        achievements=[
            AchievementResponse(**achievement) for achievement in achievements
        ],
    )


@router.put("", response_model=ProfileResponse)
async def update_profile(request: ProfileUpdate) -> ProfileResponse:
    """Upsert the career profile (created on first write).

    When ``work_experience`` changes, skill edges pointing at removed
    experience entries are pruned so no orphan edge survives.
    """
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    if "email_signature" in updates:
        from app.services.html_signature import sanitize_signature_html

        raw = updates.get("email_signature")
        # "" clears; non-empty is sanitized HTML. Stored as "" or HTML string.
        updates["email_signature"] = (
            sanitize_signature_html(raw) if isinstance(raw, str) else ""
        )
    if "work_experience" in updates:
        valid = {
            index
            for index, entry in enumerate(updates["work_experience"])
            if isinstance(entry, dict)
        }
        await db.prune_career_experience_edges(valid)
    try:
        updated = await db.update_career_profile(updates)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ProfileResponse(**updated)


@router.post("/seed-from-master", response_model=ProfileResponse)
async def seed_profile_from_master(
    request: SeedFromResumeRequest | None = None,
) -> ProfileResponse:
    """Seed the profile from a resume (default: the master resume).

    Delegates to :func:`fulfill_profile_from_resume` — the exact same code
    path that auto-fulfills after a master-resume upload, so the manual and
    automatic flows can never drift apart.
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
    updated = await fulfill_profile_from_resume(resume)
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


@router.get("/education", response_model=list[EducationResponse])
async def list_education() -> list[EducationResponse]:
    """List the career-graph education entries (insertion order)."""
    return [EducationResponse(**entry) for entry in await db.list_career_education()]


@router.post("/education/import-from-master", response_model=list[EducationResponse])
async def import_education_from_master() -> list[EducationResponse]:
    """Sync education from the master resume (replace-when-present).

    Called by the Education tab on load so it always reflects the latest CV;
    no-op when there is no master resume or it has no education section.
    """
    await import_education_from_master_service()
    return [EducationResponse(**entry) for entry in await db.list_career_education()]


@router.post("/education", response_model=EducationResponse, status_code=201)
async def create_education(request: EducationCreate) -> EducationResponse:
    """Add an education entry."""
    created = await db.create_career_education(
        institution=request.institution,
        degree=request.degree,
        years=request.years,
        description=request.description,
    )
    return EducationResponse(**created)


@router.patch("/education/{education_id}", response_model=EducationResponse)
async def update_education(
    education_id: str, request: EducationUpdate
) -> EducationResponse:
    """Update an education entry's editable fields."""
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    updated = await db.update_career_education(education_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Education entry not found.")
    return EducationResponse(**updated)


@router.delete("/education/{education_id}", response_model=CareerActionResponse)
async def delete_education(education_id: str) -> CareerActionResponse:
    """Delete an education entry."""
    deleted = await db.delete_career_education(education_id)
    return CareerActionResponse(
        message="Education entry deleted." if deleted else "Education entry not found.",
        affected=1 if deleted else 0,
    )


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects() -> list[ProjectResponse]:
    """List the career-graph project nodes (insertion order)."""
    return [ProjectResponse(**project) for project in await db.list_career_projects()]


@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def create_project(request: ProjectCreate) -> ProjectResponse:
    """Add a project node."""
    created = await db.create_career_project(
        name=request.name,
        role=request.role,
        years=request.years,
        github=request.github,
        website=request.website,
        description=request.description,
        languages=request.languages,
        readme=request.readme,
        status=request.status,
        attachments=[a.model_dump() for a in request.attachments],
    )
    return ProjectResponse(**created)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str, request: ProjectUpdate
) -> ProjectResponse:
    """Update a project node's editable fields."""
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    updated = await db.update_career_project(project_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ProjectResponse(**updated)


@router.delete("/projects/{project_id}", response_model=CareerActionResponse)
async def delete_project(project_id: str) -> CareerActionResponse:
    """Delete a project node (its skill edges are removed with it)."""
    deleted = await db.delete_career_project(project_id)
    return CareerActionResponse(
        message="Project deleted." if deleted else "Project not found.",
        affected=1 if deleted else 0,
    )


@router.post("/projects/{project_id}/attachments", response_model=ProjectResponse)
async def upload_project_attachment(
    project_id: str, file: UploadFile
) -> ProjectResponse:
    """Upload a file attachment to a project (images + documents)."""
    allowed_types = {
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    }
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="File type not allowed. Upload images (JPG, PNG, WebP, GIF, SVG), PDF, DOCX, or TXT.")
    max_size = 10 * 1024 * 1024  # 10 MB
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10 MB.")
    project = await db.get_career_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    from pathlib import Path
    from app.config import settings
    from uuid import uuid4
    upload_dir = Path(settings.data_dir) / "uploads" / "projects" / project_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "file").suffix or ".bin"
    filename = f"{uuid4().hex}{ext}"
    file_path = upload_dir / filename
    file_path.write_bytes(content)
    file_type = "image" if file.content_type.startswith("image/") else "document"
    attachment = {"name": file.filename or filename, "url": f"/api/v1/profile/projects/{project_id}/attachments/{filename}", "type": file_type}
    attachments = list(project.get("attachments") or [])
    attachments.append(attachment)
    updated = await db.update_career_project(project_id, {"attachments": attachments})
    return ProjectResponse(**updated)


@router.delete("/projects/{project_id}/attachments/{filename}")
async def delete_project_attachment(
    project_id: str, filename: str
) -> CareerActionResponse:
    """Remove a file attachment from a project."""
    project = await db.get_career_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    from pathlib import Path
    from app.config import settings
    file_path = Path(settings.data_dir) / "uploads" / "projects" / project_id / filename
    if file_path.exists():
        file_path.unlink()
    attachments = [a for a in (project.get("attachments") or []) if not a.get("url", "").endswith(filename)]
    await db.update_career_project(project_id, {"attachments": attachments})
    return CareerActionResponse(message="Attachment deleted.", affected=1)


@router.get("/projects/{project_id}/attachments/{filename}")
async def serve_project_attachment(project_id: str, filename: str):
    """Serve a project attachment file."""
    from pathlib import Path
    from app.config import settings
    from fastapi.responses import FileResponse
    file_path = Path(settings.data_dir) / "uploads" / "projects" / project_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(file_path)


@router.post("/projects/import-from-github")
async def import_projects_from_github(
    request: GitHubImportRequest | None = None,
) -> dict:
    """Import the user's GitHub repos as project nodes.

    Repos are fetched through ``github_repos`` (which serves a 10-minute
    in-process cache, so repeated imports do not hit the GitHub API), then
    upserted into the career graph keyed by repo URL: an existing project
    with the same ``github`` link is updated in place, everything else is
    created. Captured per repo: name, description, languages and README.
    ``repo_urls`` limits the import to a selection.
    """
    token = await _get_token()
    if not token:
        raise HTTPException(status_code=401, detail="Not connected to GitHub")

    response = await github_repos()
    selected = set(request.repo_urls) if request else set()
    repos = [repo for repo in response.repos if not selected or repo.url in selected]

    existing = {
        project["github"]: project
        for project in await db.list_career_projects()
        if project.get("github")
    }

    imported = 0
    updated = 0
    for repo in repos:
        url = repo.url
        updates: dict[str, Any] = {
            "name": repo.name,
            "github": url,
            "website": None,
            "description": [repo.description] if repo.description else [],
            "languages": repo.languages,
            "readme": repo.readme or None,
        }
        if url in existing:
            await db.update_career_project(existing[url]["project_id"], updates)
            updated += 1
        else:
            await db.create_career_project(**updates)
            imported += 1

    return {
        "imported": imported,
        "updated": updated,
        "total": imported + updated,
    }


@router.get("/achievements", response_model=list[AchievementResponse])
async def list_achievements() -> list[AchievementResponse]:
    """List the career-graph achievements (insertion order)."""
    return [
        AchievementResponse(**achievement)
        for achievement in await db.list_career_achievements()
    ]


@router.post("/achievements", response_model=AchievementResponse, status_code=201)
async def create_achievement(request: AchievementCreate) -> AchievementResponse:
    """Add an achievement."""
    created = await db.create_career_achievement(
        title=request.title,
        description=request.description,
        date=request.date,
    )
    return AchievementResponse(**created)


@router.patch("/achievements/{achievement_id}", response_model=AchievementResponse)
async def update_achievement(
    achievement_id: str, request: AchievementUpdate
) -> AchievementResponse:
    """Update an achievement's editable fields."""
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    updated = await db.update_career_achievement(achievement_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Achievement not found.")
    return AchievementResponse(**updated)


@router.delete("/achievements/{achievement_id}", response_model=CareerActionResponse)
async def delete_achievement(achievement_id: str) -> CareerActionResponse:
    """Delete an achievement."""
    deleted = await db.delete_career_achievement(achievement_id)
    return CareerActionResponse(
        message="Achievement deleted." if deleted else "Achievement not found.",
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
    """Compute the skill-ROI table; optionally add the 'learn next' advice.

    The response also carries the job-focused sections (gaps to learn,
    skills to strengthen, everything else) derived from the same rows.
    """
    jobs = await db.list_scraped_jobs_for_analysis()
    profile_skills = await db.list_career_skills()
    results, note = compute_skill_roi(jobs, profile_skills, request.skills)
    gaps, strengthen, rest = partition_roi_rows(results)

    advice = None
    if request.include_advice:
        try:
            advice = await generate_roi_advice(results)
        except Exception as e:
            logger.error("ROI advice failed: %s", e)
    return CareerRoiResponse(
        results=results[:_MAX_ROI_ROWS],
        gaps=gaps,
        strengthen=strengthen,
        rest=rest,
        advice=advice,
        note=note,
    )


@router.post("/market-position", response_model=MarketPositionResponse)
async def get_market_position() -> MarketPositionResponse:
    """Deterministic market-position model (role, percentiles + verdict).

    Pure function over tracked skills, certifications, work experience and
    projects — no LLM and no external data: percentiles are mapped from a
    modeled candidate distribution, the current role and best-fit role picks
    are derived from the same evidence, and the verdict is a template
    sentence.
    """
    skills = await db.list_career_skills()
    certifications = await db.list_career_certifications()
    profile = await db.get_career_profile()
    work_experience = (profile or {}).get("work_experience") or []
    projects = await db.list_career_projects()
    return MarketPositionResponse(
        **compute_market_position(skills, certifications, work_experience, projects)
    )


def _resource_cache_fresh(retrieved_at: str) -> bool:
    """Whether a cached resource row is within the freshness window."""
    try:
        parsed = datetime.fromisoformat(retrieved_at)
        age = (datetime.now(timezone.utc) - parsed).total_seconds()
        return 0 <= age < _RESOURCE_FRESHNESS_SECONDS
    except (TypeError, ValueError):
        return False


@router.post("/skill-resources", response_model=SkillResourcesResponse)
async def get_skill_resources_endpoint(
    request: SkillResourcesRequest,
) -> SkillResourcesResponse:
    """Verified learning resources per skill (cached; LLM-proposed + URL-checked).

    Serves cached resources (fresh up to 7 days) and generates the rest in a
    single LLM call; every proposed URL is verified to actually resolve before
    it is cached or returned. Returns cached data plus a note when the LLM is
    not configured.
    """
    skills = [name.strip() for name in request.skills if name.strip()]
    resources: dict[str, list[dict[str, Any]]] = {}
    missing: list[str] = []
    for skill in skills:
        cached = await db.get_skill_resources(skill)
        if (
            cached is not None
            and not request.refresh
            and _resource_cache_fresh(cached["retrieved_at"])
        ):
            resources[skill] = cached["resources"]
        else:
            missing.append(skill)

    note: str | None = None
    if missing:
        if not _llm_configured():
            note = "Learning resources are only available when an LLM is configured."
        else:
            try:
                proposed = await generate_skill_resources(missing)
                for skill in missing:
                    verified = await verify_resource_links(proposed.get(skill, []))
                    resources[skill] = verified
                    await db.save_skill_resources(skill, verified)
            except Exception as e:
                logger.error("Skill resources generation failed: %s", e)
                note = "Learning resources could not be generated right now. Please try again."
    return SkillResourcesResponse(
        resources={
            skill: [SkillResource(**item) for item in entries]
            for skill, entries in resources.items()
        },
        note=note,
    )


@router.post("/skill-suggestions", response_model=SkillSuggestionsResponse)
async def get_skill_suggestions_endpoint() -> SkillSuggestionsResponse:
    """AI 'forgotten skills' suggestions over the local career data.

    LLM-optional: returns an empty list with a note when no LLM is
    configured, and a generic note when generation fails.
    """
    note: str | None = None
    skills: list[dict[str, Any]] = []
    if not _llm_configured():
        note = "Skill suggestions are only available when an LLM is configured."
    else:
        try:
            skills = await generate_skill_suggestions() or []
        except Exception as e:
            logger.error("Skill suggestions generation failed: %s", e)
            note = "Skill suggestions could not be generated right now. Please try again."
    if not skills and note is None:
        note = "No new skill suggestions found. Add more skills, work experience, or projects to your profile, then try again."
    return SkillSuggestionsResponse(
        skills=[SkillSuggestion(**item) for item in skills],
        note=note,
    )


@router.post("/project-ideas", response_model=ProjectIdeasResponse)
async def get_project_ideas_endpoint(
    body: dict[str, Any] | None = None,
) -> ProjectIdeasResponse:
    """AI project idea suggestions based on the user's career profile."""
    context = (body or {}).get("context", "")
    note: str | None = None
    ideas: list[dict[str, Any]] = []
    if not _llm_configured():
        note = "Project ideas are only available when an LLM is configured."
    else:
        try:
            ideas = await generate_project_ideas(user_context=context) or []
        except Exception as e:
            logger.error("Project ideas generation failed: %s", e)
            note = "Project ideas could not be generated right now. Please try again."
    if not ideas and note is None:
        note = "No project ideas could be generated. Add more skills or work experience to your profile, then try again."
    return ProjectIdeasResponse(
        ideas=[ProjectIdea(**item) for item in ideas],
        note=note,
    )


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


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------


@router.get("/pdf")
async def export_profile_pdf() -> Response:
    """Render the career profile as a PDF via headless Chromium."""
    from app.config import settings

    url = f"{settings.frontend_base_url}/print/profile"
    try:
        pdf_bytes = await render_resume_pdf(
            url, page_size="A4", selector=".profile-print header"
        )
    except PDFRenderError as e:
        raise HTTPException(status_code=503, detail=str(e))

    profile = await db.get_career_profile()
    name = (profile or {}).get("name", "profile")
    filename = f"{name.strip().replace(' ', '_')}_profile.pdf" if name else "profile.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@router.get("/docx")
async def export_profile_docx() -> Response:
    """Generate the career profile as a DOCX document."""
    profile = await db.get_career_profile()
    if profile is None:
        profile = await db.create_career_profile()
    skills = await db.list_career_skills()
    certifications = await db.list_career_certifications()
    education = await db.list_career_education()
    projects = await db.list_career_projects()
    achievements = await db.list_career_achievements()

    doc = Document()

    # -- Name & title --
    name = profile.get("name") or "My Profile"
    title = profile.get("title")
    doc.add_heading(name, level=0)
    if title:
        doc.add_paragraph(title)

    # -- Contact info --
    contact_parts = [
        profile.get("email"),
        profile.get("phone"),
        profile.get("location"),
        profile.get("website"),
        profile.get("linkedin"),
        profile.get("github"),
    ]
    contact_line = " | ".join(p for p in contact_parts if p)
    if contact_line:
        p = doc.add_paragraph(contact_line)
        p.style = doc.styles["Normal"]

    # -- Summary --
    summary = profile.get("summary")
    if summary:
        doc.add_heading("Summary", level=1)
        doc.add_paragraph(summary)

    # -- Work Experience --
    work_exp = profile.get("work_experience") or []
    if work_exp:
        doc.add_heading("Work Experience", level=1)
        for exp in work_exp:
            heading_parts = [exp.get("role"), exp.get("company")]
            heading = " - ".join(h for h in heading_parts if h) or "Experience"
            doc.add_heading(heading, level=2)
            meta_parts = [exp.get("location"), exp.get("years")]
            meta = " | ".join(m for m in meta_parts if m)
            if meta:
                p = doc.add_paragraph(meta)
                p.runs[0].italic = True if p.runs else None
            for bullet in exp.get("description") or []:
                doc.add_paragraph(bullet, style="List Bullet")

    # -- Education --
    if education:
        doc.add_heading("Education", level=1)
        for edu in education:
            heading_parts = [edu.get("degree"), edu.get("institution")]
            heading = " - ".join(h for h in heading_parts if h) or "Education"
            doc.add_heading(heading, level=2)
            if edu.get("years"):
                doc.add_paragraph(edu["years"])
            if edu.get("description"):
                doc.add_paragraph(edu["description"])

    # -- Projects --
    if projects:
        doc.add_heading("Projects", level=1)
        for proj in projects:
            heading = proj.get("name") or "Project"
            if proj.get("role"):
                heading += f" - {proj['role']}"
            doc.add_heading(heading, level=2)
            meta_parts = [proj.get("years"), proj.get("github"), proj.get("website")]
            meta = " | ".join(m for m in meta_parts if m)
            if meta:
                doc.add_paragraph(meta)
            for desc in proj.get("description") or []:
                doc.add_paragraph(desc, style="List Bullet")
            if proj.get("languages"):
                doc.add_paragraph("Languages: " + ", ".join(proj["languages"]))

    # -- Skills --
    if skills:
        doc.add_heading("Skills", level=1)
        table = doc.add_table(rows=1, cols=4)
        table.style = "Light Grid Accent 1"
        hdr = table.rows[0].cells
        hdr[0].text = "Skill"
        hdr[1].text = "Category"
        hdr[2].text = "Proficiency"
        hdr[3].text = "Years"
        for skill in skills:
            row = table.add_row().cells
            row[0].text = skill.get("name") or ""
            row[1].text = skill.get("category") or ""
            prof = skill.get("proficiency")
            row[2].text = f"{prof}/5" if prof else ""
            yrs = skill.get("years_experience")
            row[3].text = str(yrs) if yrs is not None else ""

    # -- Certifications --
    if certifications:
        doc.add_heading("Certifications", level=1)
        for cert in certifications:
            parts = [cert.get("name"), cert.get("issuer"), cert.get("date_obtained")]
            doc.add_paragraph(" - ".join(p for p in parts if p))

    # -- Achievements --
    if achievements:
        doc.add_heading("Achievements", level=1)
        for ach in achievements:
            heading = ach.get("title") or "Achievement"
            if ach.get("date"):
                heading += f" ({ach['date']})"
            doc.add_heading(heading, level=2)
            if ach.get("description"):
                doc.add_paragraph(ach["description"])

    # -- Languages & Awards --
    langs = profile.get("languages") or []
    awards = profile.get("awards") or []
    if langs:
        doc.add_heading("Languages", level=1)
        doc.add_paragraph(", ".join(langs))
    if awards:
        doc.add_heading("Awards", level=1)
        for award in awards:
            doc.add_paragraph(award, style="List Bullet")

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)

    name_str = (profile.get("name") or "profile").strip().replace(" ", "_")
    filename = f"{name_str}_profile.docx"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


@router.post("/import-preview", response_model=ProfileBundleResponse)
async def import_profile_preview(file: UploadFile) -> ProfileBundleResponse:
    """Parse a resume file and return profile data without saving.

    Accepts PDF or DOCX. The file is parsed via markitdown then structured
    via LLM, but nothing is written to the database — the caller decides
    whether to persist after reviewing the preview.
    """
    from app.services.parser import parse_document, parse_resume_to_json

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    content_type = file.content_type or ""
    allowed = {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }
    if content_type not in allowed and not file.filename.lower().endswith((".pdf", ".docx", ".doc")):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and DOCX files are supported.",
        )

    raw_bytes = await file.read()
    if len(raw_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB).")

    try:
        markdown = await parse_document(raw_bytes, file.filename)
    except Exception as e:
        logger.error("Failed to parse uploaded file: %s", e)
        raise HTTPException(status_code=422, detail="Could not parse the uploaded file.")

    if not markdown or not markdown.strip():
        raise HTTPException(status_code=422, detail="No text content found in the file.")

    try:
        parsed = await parse_resume_to_json(markdown)
    except Exception as e:
        logger.error("LLM resume parsing failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail="Failed to extract profile data from the resume. Please try again.",
        )

    # Build a ProfileBundleResponse from the parsed data without touching the DB.
    personal = parsed.get("personalInfo") or {}
    work_raw = parsed.get("workExperience") or []
    work_experience = []
    for w in work_raw:
        bullets = w.get("description") or w.get("bullets") or []
        if isinstance(bullets, str):
            bullets = [b.strip() for b in bullets.split("\n") if b.strip()]
        work_experience.append({
            "role": w.get("role") or w.get("title") or "",
            "company": w.get("company") or w.get("organization"),
            "location": w.get("location"),
            "years": w.get("years") or w.get("dates") or w.get("date"),
            "description": bullets,
        })

    skills_raw = parsed.get("skills") or parsed.get("technicalSkills") or []
    skills = []
    seen_names: set[str] = set()
    for s in skills_raw:
        if isinstance(s, str):
            name = s
            category = None
        elif isinstance(s, dict):
            name = s.get("name") or s.get("skill") or str(s)
            category = s.get("category")
        else:
            continue
        name_lower = name.strip().lower()
        if not name.strip() or name_lower in seen_names:
            continue
        seen_names.add(name_lower)
        skills.append({
            "skill_id": f"preview_{name_lower.replace(' ', '_')}",
            "name": name.strip(),
            "category": category,
            "proficiency": None,
            "years_experience": None,
            "last_used": None,
            "created_at": "",
            "updated_at": "",
        })

    education_raw = parsed.get("education") or []
    education = []
    for edu in education_raw:
        if isinstance(edu, str):
            education.append({
                "education_id": f"preview_edu_{len(education)}",
                "institution": edu,
                "degree": None,
                "years": None,
                "description": None,
                "created_at": "",
                "updated_at": "",
            })
        elif isinstance(edu, dict):
            education.append({
                "education_id": f"preview_edu_{len(education)}",
                "institution": edu.get("institution") or edu.get("school") or edu.get("university") or "",
                "degree": edu.get("degree") or edu.get("field") or edu.get("program"),
                "years": edu.get("years") or edu.get("dates") or edu.get("date"),
                "description": edu.get("description"),
                "created_at": "",
                "updated_at": "",
            })

    projects_raw = parsed.get("projects") or []
    projects = []
    for p in projects_raw:
        if isinstance(p, dict):
            desc = p.get("description") or []
            if isinstance(desc, str):
                desc = [d.strip() for d in desc.split("\n") if d.strip()]
            projects.append({
                "project_id": f"preview_proj_{len(projects)}",
                "name": p.get("name") or p.get("title") or "",
                "role": p.get("role"),
                "years": p.get("years") or p.get("dates"),
                "github": p.get("github") or p.get("repo"),
                "website": p.get("website") or p.get("url"),
                "description": desc,
                "languages": p.get("languages") or p.get("tech") or [],
                "readme": p.get("readme"),
                "created_at": "",
                "updated_at": "",
            })

    achievements_raw = parsed.get("achievements") or parsed.get("awards") or []
    achievements = []
    for a in achievements_raw:
        if isinstance(a, str):
            achievements.append({
                "achievement_id": f"preview_ach_{len(achievements)}",
                "title": a,
                "description": None,
                "date": None,
                "created_at": "",
                "updated_at": "",
            })
        elif isinstance(a, dict):
            achievements.append({
                "achievement_id": f"preview_ach_{len(achievements)}",
                "title": a.get("title") or a.get("name") or "",
                "description": a.get("description"),
                "date": a.get("date") or a.get("year"),
                "created_at": "",
                "updated_at": "",
            })

    awards_raw = parsed.get("awards") or []
    awards = [a if isinstance(a, str) else str(a) for a in awards_raw]

    languages_raw = parsed.get("languages") or []
    languages = [l if isinstance(l, str) else str(l) for l in languages_raw]

    return ProfileBundleResponse(
        profile=ProfileResponse(
            profile_id="preview",
            name=personal.get("name"),
            title=personal.get("title") or personal.get("position"),
            email=personal.get("email"),
            phone=personal.get("phone"),
            location=personal.get("location") or personal.get("address"),
            website=personal.get("website") or personal.get("url"),
            linkedin=personal.get("linkedin"),
            github=personal.get("github"),
            summary=parsed.get("summary") or parsed.get("objective"),
            career_goals=[],
            target_roles=[],
            target_locations=[],
            target_salary_min=None,
            target_salary_max=None,
            work_experience=work_experience,
            languages=languages,
            awards=awards,
            source_resume_id=None,
            source_resume_title=file.filename,
            created_at="",
            updated_at="",
        ),
        skills=[SkillResponse(**s) for s in skills],
        certifications=[],
        education=[EducationResponse(**e) for e in education],
        projects=[ProjectResponse(**p) for p in projects],
        achievements=[AchievementResponse(**a) for a in achievements],
    )