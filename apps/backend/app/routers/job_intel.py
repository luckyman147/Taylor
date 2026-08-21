"""Job Intelligence endpoints: DNA extraction, Red Flags, Should I Apply."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from app.database import db
from app.schemas.job_intel import (
    HiringProbabilityResponse,
    JobDnaResponse,
    RedFlagsResponse,
    ShouldApplyResponse,
)
from app.services import job_intel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["Job Intelligence"])


async def _load_job(job_id: str) -> dict[str, Any]:
    """Load a job by ID — regular job or scraped-job draft.

    Returns a normalized dict with ``content`` and ``metadata_json`` so the
    deterministic services work for both sources.
    """
    job = await db.get_job(job_id)
    if job:
        return job

    scraped = await db.get_scraped_job(job_id)
    if scraped:
        return {
            "job_id": scraped["job_id"],
            "title": scraped.get("title", ""),
            "company": scraped.get("company", ""),
            "content": scraped.get("description") or "",
            "metadata_json": {},
        }
    raise HTTPException(status_code=404, detail="Job not found")


@router.get("/{job_id}/dna", response_model=JobDnaResponse)
async def get_job_dna(job_id: str) -> JobDnaResponse:
    """Get job DNA profile, career DNA, and comparison."""
    job = await _load_job(job_id)

    meta = job.get("metadata_json") or {}
    job_keywords = meta.get("job_keywords") or {}

    job_dna = await job_intel.extract_job_dna(job, job_keywords)

    career_memory = await job_intel._get_career_bundle()
    career_dna = job_intel.build_career_dna(career_memory)
    comparison = job_intel.compare_dna(job_dna, career_dna)

    return JobDnaResponse(
        job_dna=job_dna,
        career_dna=career_dna,
        comparison=comparison,
    )


@router.get("/{job_id}/red-flags", response_model=RedFlagsResponse)
async def get_red_flags(job_id: str) -> RedFlagsResponse:
    """Detect red flags in a job description."""
    job = await _load_job(job_id)

    meta = job.get("metadata_json") or {}
    job_keywords = meta.get("job_keywords") or {}
    content = job.get("content", "")

    result = job_intel.detect_red_flags(content, job_keywords)
    return RedFlagsResponse(**result)


@router.get("/{job_id}/hiring-probability", response_model=HiringProbabilityResponse)
async def get_hiring_probability(job_id: str) -> HiringProbabilityResponse:
    """Hiring probability: skills, experience, and seniority vs the profile."""
    job = await _load_job(job_id)

    meta = job.get("metadata_json") or {}
    job_keywords = meta.get("job_keywords") or {}
    content = job.get("content", "")

    job_dna = await job_intel.extract_job_dna(job, job_keywords)
    career_memory = await job_intel._get_career_bundle()
    career_dna = job_intel.build_career_dna(career_memory)
    comparison = job_intel.compare_dna(job_dna, career_dna)

    result = job_intel.assess_hiring_probability(
        job_dna=job_dna,
        career_dna=career_dna,
        comparison=comparison,
        job_keywords=job_keywords,
        content=content,
        career_data=career_memory,
    )
    return HiringProbabilityResponse(**result)


@router.post("/{job_id}/should-apply", response_model=ShouldApplyResponse)
async def should_apply(
    job_id: str,
    master_resume_id: str,
) -> ShouldApplyResponse:
    """Full Should I Apply analysis."""
    try:
        result = await job_intel.analyze_job(job_id, master_resume_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return ShouldApplyResponse(**result)
