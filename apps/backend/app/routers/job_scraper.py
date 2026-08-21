"""Job scraper search endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.schemas.job_scraper import (
    JobSearchRequest,
    JobSearchResponse,
)
from app.services.job_scraper import search_jobs, search_freelance_jobs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/job-scraper", tags=["Job Scraper"])


class ProfileKeywordsResponse(BaseModel):
    """Profile keywords extracted from resume."""
    skills: list[str]
    titles: list[str]
    suggested_keywords: str


class SaveScrapedJobsRequest(BaseModel):
    """Request to save scraped jobs."""
    search_id: str
    resume_id: str
    jobs: list[dict]


class ScrapedJobResponse(BaseModel):
    """A scraped job draft."""
    job_id: str
    search_id: str
    title: str
    company: str
    location: str
    url: str
    source: str
    description: str | None
    posted_date: str | None
    relevance_score: float
    remote: bool
    easy_apply: bool
    job_type: str | None
    experience_level: str | None
    salary: str | None
    languages: list[str]
    applied: bool = False
    applied_resume_id: str | None = None
    archived: bool = False
    metadata: dict[str, Any] | None = None
    created_at: str


class MarkAppliedRequest(BaseModel):
    """Request to mark a scraped job as applied."""
    resume_id: str


class UpdateArchiveRequest(BaseModel):
    """Request to set the archived flag on a scraped job."""
    archived: bool = True


@router.get("/profile-keywords/{resume_id}", response_model=ProfileKeywordsResponse)
async def get_profile_keywords(resume_id: str) -> ProfileKeywordsResponse:
    """Generate search keywords for job matching.

    When the user has tracked career skills and/or work experience, the
    TAYLOR engine builds a profile snapshot (skills + experience + seniority)
    and returns the generated search queries — this decides *what* gets
    fetched. Resume-parsed technical skills are only a fallback.
    """
    from app.database import db
    from app.services.job_scraper import _generated_keywords
    from app.services.skill_ontology import build_search_queries

    try:
        resume = await db.get_resume(resume_id)
        if not resume:
            raise HTTPException(status_code=404, detail="Resume not found")

        processed = resume.get("processed_data") or {}
        resume_skills = processed.get("additional", {}).get("technicalSkills", [])
        titles = [
            exp.get("title", "")
            for exp in processed.get("workExperience", [])
            if exp.get("title")
        ]

        career_skills = await db.list_career_skills()
        if career_skills:
            # Rank tracked skills: proficiency first, then years of
            # experience, then name (stable, deterministic).
            ranked = sorted(
                career_skills,
                key=lambda s: (
                    -(s.get("proficiency") or 0),
                    -(s.get("years_experience") or 0),
                    s.get("name", "").lower(),
                ),
            )
            skills = [s["name"] for s in ranked]
        else:
            # Fallback: normalize resume-parsed skills through the priority
            # list so verbose names (e.g. "Python (Advanced)") collapse to
            # clean search keywords.
            priority = [
                "JavaScript", "TypeScript", "Python", "React", "Node.js",
                "Angular", ".NET", "ASP.NET", "Docker", "Kubernetes",
                "FastAPI", "NestJS", "Spring Boot", "Full-Stack", "Backend",
            ]
            skills = []
            for skill in resume_skills:
                for p in priority:
                    if p.lower() in skill.lower() and p not in skills:
                        skills.append(p)
                        break
            if not skills:
                skills = resume_skills[:5]

        # Profile-driven query when the snapshot exists (skills + experience
        # decide what to fetch); otherwise title-derived keywords.
        keywords, bundle = await _generated_keywords(resume_id)
        if bundle is None:
            suggested = list(skills[:8])
            for title in titles:
                tl = title.lower()
                if "full" in tl or "backend" in tl:
                    if "Full-Stack" not in suggested:
                        suggested.append("Full-Stack")
                if "software" in tl:
                    if "Software Engineer" not in suggested:
                        suggested.append("Software Engineer")
            suggested_keywords = " ".join(suggested[:8])
        else:
            queries = build_search_queries(bundle["snapshot"], bundle["skills"])
            suggested_keywords = keywords or (queries[0] if queries else " ".join(skills[:8]))

        return ProfileKeywordsResponse(
            skills=skills[:20],
            titles=titles[:10],
            suggested_keywords=suggested_keywords,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to build profile keywords for %s: %s", resume_id, exc)
        raise HTTPException(status_code=500, detail="Failed to build profile keywords")


@router.post("/search", response_model=JobSearchResponse)
async def search_jobs_endpoint(request: JobSearchRequest) -> JobSearchResponse:
    """Search for jobs across all enabled MCPs."""
    try:
        result = await search_jobs(request)
        return result
    except Exception as exc:
        logger.error("Job search failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Job search failed. Please try again.",
        )


class FreelanceSearchRequest(BaseModel):
    """Request for freelance search."""
    keywords: str


@router.post("/freelance/search", response_model=JobSearchResponse)
async def search_freelance_endpoint(request: FreelanceSearchRequest) -> JobSearchResponse:
    """Search freelance-specific MCPs (Tunisian + Remote Freelance)."""
    try:
        result = await search_freelance_jobs(request.keywords)
        return result
    except Exception as exc:
        logger.error("Freelance search failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Freelance search failed. Please try again.",
        )


@router.post("/save-drafts")
async def save_scraped_jobs_endpoint(request: SaveScrapedJobsRequest) -> dict:
    """Save scraped job listings as drafts."""
    from app.database import db

    try:
        saved = await db.save_scraped_jobs(
            request.search_id, request.resume_id, request.jobs
        )
        return {"saved": saved, "total": len(request.jobs)}
    except Exception as exc:
        logger.error("Failed to save scraped jobs: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save jobs")


@router.get("/drafts/{resume_id}", response_model=list[ScrapedJobResponse])
async def get_scraped_jobs_endpoint(resume_id: str) -> list[ScrapedJobResponse]:
    """Get all scraped job drafts for a resume."""
    from app.database import db

    try:
        jobs = await db.get_scraped_jobs(resume_id)
        return [ScrapedJobResponse(**job) for job in jobs]
    except Exception as exc:
        logger.error("Failed to get scraped jobs: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to get jobs")


@router.delete("/drafts/{job_id}")
async def delete_scraped_job_endpoint(job_id: str) -> dict:
    """Delete a single scraped job draft."""
    from app.database import db

    try:
        deleted = await db.delete_scraped_job(job_id)
        return {"deleted": deleted}
    except Exception as exc:
        logger.error("Failed to delete scraped job: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to delete job")


@router.delete("/drafts/all/{resume_id}")
async def clear_scraped_jobs_endpoint(resume_id: str) -> dict:
    """Delete all scraped job drafts for a resume."""
    from app.database import db

    try:
        cleared = await db.clear_scraped_jobs(resume_id)
        return {"cleared": cleared}
    except Exception as exc:
        logger.error("Failed to clear scraped jobs: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to clear jobs")


@router.patch("/drafts/{job_id}/apply")
async def mark_scraped_job_applied_endpoint(job_id: str, request: MarkAppliedRequest) -> dict:
    """Mark a scraped job draft as applied with the tailored resume ID."""
    from app.database import db

    try:
        marked = await db.mark_scraped_job_applied(job_id, request.resume_id)
        if not marked:
            raise HTTPException(status_code=404, detail="Job not found")
        return {"marked": True, "job_id": job_id, "resume_id": request.resume_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to mark job as applied: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to mark job as applied")


@router.patch("/drafts/{job_id}/archive")
async def set_scraped_job_archived_endpoint(
    job_id: str, request: UpdateArchiveRequest
) -> dict:
    """Archive or unarchive a scraped job draft."""
    from app.database import db

    try:
        updated = await db.set_scraped_job_archived(job_id, request.archived)
        if not updated:
            raise HTTPException(status_code=404, detail="Job not found")
        return {"job_id": job_id, "archived": request.archived}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update job archive status: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to update job")


@router.get("/health")
async def health_check() -> dict:
    """Health check for the job scraper service."""
    from app.services.job_scraper import get_mcp_manager

    manager = get_mcp_manager()
    statuses = await manager.detect_all()
    available = sum(1 for s in statuses.values() if s.available)
    return {
        "status": "ok",
        "mcp_available": available,
        "mcp_total": len(statuses),
    }
