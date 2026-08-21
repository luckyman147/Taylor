"""Deterministic resume audit scoring + evidence counters.

Computes JD-independent structural scores from the user's master resume
using the same internal helpers as ats.py. Returns pure dicts — no LLM calls.
"""

from __future__ import annotations

import logging
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)


def _extract_all_text(resume_data: dict[str, Any]) -> str:
    """Extract all text from a resume for pattern matching."""
    parts: list[str] = []
    if pi := resume_data.get("personalInfo"):
        for v in pi.values():
            if isinstance(v, str):
                parts.append(v)
    if summary := resume_data.get("summary"):
        parts.append(summary)
    for section in resume_data.get("workExperience", []):
        parts.append(section.get("company", ""))
        parts.append(section.get("title", ""))
        for d in section.get("description", []):
            if isinstance(d, str):
                parts.append(d)
    for section in resume_data.get("education", []):
        parts.append(section.get("institution", ""))
        parts.append(section.get("degree", ""))
    for section in resume_data.get("personalProjects", []):
        parts.append(section.get("name", ""))
        for d in section.get("description", []):
            if isinstance(d, str):
                parts.append(d)
    return "\n".join(parts)


def _compute_section_completeness(resume_data: dict[str, Any]) -> float:
    """Score how complete the resume sections are."""
    sections = {
        "personalInfo": resume_data.get("personalInfo"),
        "summary": resume_data.get("summary"),
        "workExperience": resume_data.get("workExperience"),
        "education": resume_data.get("education"),
    }
    present = sum(1 for v in sections.values() if v)
    total = len(sections)
    return round((present / total) * 100, 1) if total > 0 else 0.0


def _compute_quantification(resume_data: dict[str, Any]) -> float:
    """Score quantification: what % of description bullets contain numbers."""
    import re
    bullets: list[str] = []
    for section in resume_data.get("workExperience", []):
        for d in section.get("description", []):
            if isinstance(d, str):
                bullets.append(d)
    for section in resume_data.get("personalProjects", []):
        for d in section.get("description", []):
            if isinstance(d, str):
                bullets.append(d)
    if not bullets:
        return 0.0
    quantified = sum(1 for b in bullets if re.search(r"\d", b))
    return round((quantified / len(bullets)) * 100, 1)


def _compute_action_verbs(resume_data: dict[str, Any]) -> float:
    """Score action verb usage: what % of bullets start with a strong verb."""
    action_verbs = {
        "built", "created", "designed", "developed", "implemented", "led",
        "managed", "improved", "reduced", "increased", "optimized",
        "delivered", "streamlined", "automated", "established", "launched",
        "scaled", "migrated", "integrated", "architected", "mentored",
        "coordinated", "deployed", "configured", "maintained", "analyzed",
        "resolved", "enhanced", "refactored", "tested", "documented",
        "achieved", "spearheaded", "pioneered", "orchestrated", "spearheaded",
    }
    bullets: list[str] = []
    for section in resume_data.get("workExperience", []):
        for d in section.get("description", []):
            if isinstance(d, str):
                bullets.append(d)
    for section in resume_data.get("personalProjects", []):
        for d in section.get("description", []):
            if isinstance(d, str):
                bullets.append(d)
    if not bullets:
        return 0.0
    with_verbs = sum(
        1 for b in bullets
        if b.split()[0].lower().rstrip(".,;:") in action_verbs if b.split()
    )
    return round((with_verbs / len(bullets)) * 100, 1)


def _count_resume_mentions(text: str, skill: str) -> int:
    """Count how many times a skill appears in resume text."""
    lower = text.lower()
    skill_lower = skill.lower()
    count = 0
    start = 0
    while True:
        idx = lower.find(skill_lower, start)
        if idx == -1:
            break
        count += 1
        start = idx + len(skill_lower)
    return count


async def compute_resume_audit(resume_data: dict[str, Any]) -> dict[str, Any]:
    """Compute a JD-independent resume audit score.

    Returns structural subscores + market alignment + overall score.
    """
    skills = await db.list_career_skills()
    skills_coverage = _compute_skills_coverage(resume_data, skills)
    section_completeness = _compute_section_completeness(resume_data)
    quantification = _compute_quantification(resume_data)
    action_verbs = _compute_action_verbs(resume_data)

    # Overall: weighted mean of 4 structural scores
    weights = {"skills": 0.3, "sections": 0.2, "quant": 0.25, "verbs": 0.25}
    overall = round(
        skills_coverage * weights["skills"]
        + section_completeness * weights["sections"]
        + quantification * weights["quant"]
        + action_verbs * weights["verbs"],
        1,
    )

    # Market alignment: % of career skills present in ≥50% of scraped jobs
    market_alignment = await _compute_market_alignment(resume_data)

    return {
        "overall_score": overall,
        "sub_scores": {
            "skills_coverage": skills_coverage,
            "section_completeness": section_completeness,
            "quantification": quantification,
            "action_verbs": action_verbs,
        },
        "market_alignment": market_alignment,
    }


def _compute_skills_coverage(
    resume_data: dict[str, Any],
    skills: list[dict[str, Any]] | None = None,
) -> float:
    """What fraction of career skills appear in the resume text."""
    if not skills:
        return 0.0
    resume_text = _extract_all_text(resume_data).lower()
    found = sum(
        1 for s in skills
        if (s.get("name") or "").lower() in resume_text
    )
    return round((found / len(skills)) * 100, 1)


async def _compute_market_alignment(resume_data: dict[str, Any]) -> float:
    """% of career skills present in ≥50% of scraped jobs."""
    try:
        skills = await db.list_career_skills()
        jobs = await db.list_scraped_jobs_for_analysis()
        if not skills or not jobs:
            return 0.0

        resume_text = _extract_all_text(resume_data).lower()
        aligned = 0
        for skill in skills:
            name = (skill.get("name") or "").lower()
            if not name:
                continue
            # Check if skill is in resume
            in_resume = name in resume_text
            if not in_resume:
                continue
            # Check job demand
            job_count_with_skill = 0
            for job in jobs:
                desc = (job.get("description") or "").lower()
                if name in desc:
                    job_count_with_skill += 1
            demand_ratio = job_count_with_skill / len(jobs) if jobs else 0
            if demand_ratio >= 0.5:
                aligned += 1

        return round((aligned / len(skills)) * 100, 1) if skills else 0.0
    except Exception:
        logger.warning("Market alignment computation failed", exc_info=True)
        return 0.0


async def get_evidence(skill: str) -> dict[str, Any]:
    """RAG-powered evidence: resume mentions + job dataset % + best location."""
    try:
        from app.services.rag import rag_index
        # Use RAG to find skill mentions in resume chunks
        results = await rag_index.query(
            skill,
            include_memories=False,
            include_skills=False,
            top_k=5,
            rerank=True,
        )
        resume_chunks = results.get("resumes", [])
        job_chunks = results.get("jobs", [])

        # Count mentions across retrieved resume chunks
        mentions = sum(
            _count_resume_mentions(chunk.text, skill)
            for chunk, _ in resume_chunks
        )

        # Job demand from retrieved chunks
        total_jobs = len(job_chunks)
        jobs_with_skill = sum(
            1 for chunk, _ in job_chunks
            if skill.lower() in chunk.text.lower()
        )
        pct = round((jobs_with_skill / total_jobs) * 100, 1) if total_jobs else 0.0

        # Best location from resume chunks
        best_location = None
        for chunk, _ in resume_chunks:
            if skill.lower() in chunk.text.lower():
                best_location = chunk.metadata.get("section")
                break

        return {
            "resume_mentions": mentions,
            "job_mention_pct": pct,
            "best_location": best_location,
            "total_jobs": total_jobs,
        }
    except Exception:
        logger.warning("Evidence computation failed for skill: %s", skill, exc_info=True)
        return {"resume_mentions": 0, "job_mention_pct": 0, "best_location": None, "total_jobs": 0}


def _find_best_evidence(processed_data: dict[str, Any], skill: str) -> str | None:
    """Find the section/entry with the strongest evidence for a skill."""
    skill_lower = skill.lower()
    best: tuple[int, str] = (0, "")

    for section_key in ("workExperience", "personalProjects"):
        for entry in processed_data.get(section_key, []):
            desc = entry.get("description", [])
            text = " ".join(d for d in desc if isinstance(d, str)).lower()
            count = text.count(skill_lower)
            if count > best[0]:
                label = entry.get("company") or entry.get("name") or "Unknown"
                best = (count, f"{section_key}: {label}")

    return best[1] if best[0] > 0 else None
