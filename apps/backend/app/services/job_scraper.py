"""Job scraper service — orchestrates MCP search, scoring, dedup, caching."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.database import db
from app.schemas.job_scraper import (
    JobListing,
    JobSearchFilters,
    JobSearchRequest,
    JobSearchResponse,
)
from app.services.mcp.manager import MCPManager
from app.services.mcp.circuit_breaker import CircuitOpenError
from app.services.market_position import compute_market_position
from app.services.skill_ontology import (
    build_profile_snapshot,
    build_search_queries,
    match_skills,
    match_title,
    negative_penalty,
    seniority_score,
    _family_from_text,
)

logger = logging.getLogger(__name__)

# Global MCP manager instance
_mcp_manager: MCPManager | None = None


def get_mcp_manager() -> MCPManager:
    """Get or create the global MCP manager with all adapters registered."""
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = MCPManager()
        _register_adapters(_mcp_manager)
    return _mcp_manager


def _register_adapters(manager: MCPManager) -> None:
    """Register all available MCP adapters."""
    from app.services.mcp.linkedin import LinkedInAdapter
    from app.services.mcp.rss import RSSAdapter
    from app.services.mcp.exa import ExaAdapter
    from app.services.mcp.web import WebAdapter
    from app.services.mcp.github import GitHubAdapter
    from app.services.mcp.tunisian import TunisianFreelanceAdapter
    from app.services.mcp.remote_freelance import RemoteFreelanceAdapter
    from app.services.mcp.keejob import KeejobAdapter

    manager.register(LinkedInAdapter())
    manager.register(RSSAdapter())
    manager.register(ExaAdapter())
    manager.register(WebAdapter())
    manager.register(GitHubAdapter())
    manager.register(TunisianFreelanceAdapter())
    manager.register(RemoteFreelanceAdapter())
    manager.register(KeejobAdapter())


def _make_search_id(keywords: str, filters: JobSearchFilters) -> str:
    """Generate a deterministic search ID for caching."""
    payload = json.dumps(
        {"k": keywords, "f": filters.model_dump()}, sort_keys=True
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


async def search_jobs(request: JobSearchRequest) -> JobSearchResponse:
    """Execute a full job search across all enabled MCPs."""
    manager = get_mcp_manager()

    # Profile-driven keywords + snapshot (skills + experience decide the
    # queries); falls back to resume-derived keywords.
    keywords = request.filters.keywords
    snapshot: dict[str, Any] | None = None
    if not keywords:
        keywords, snapshot = await _generated_keywords(request.resume_id)
    if not keywords:
        keywords = "software engineer"

    filters = request.filters
    search_id = _make_search_id(keywords, filters)

    # Check cache
    cached = await _get_cached_results(search_id)
    if cached:
        return cached

    # Search all MCPs
    all_jobs, mcp_status = await manager.search_all(keywords, filters)

    # Deduplicate
    deduped = _deduplicate(all_jobs)

    # Score relevance against the profile (snapshot) or keywords fallback
    if snapshot and snapshot.get("snapshot", {}).get("has_profile"):
        scored, relevant = _score_jobs(deduped, snapshot)
    else:
        scored, relevant = _score_relevance(deduped, keywords)

    # Sort by relevance
    scored.sort(key=lambda j: j.relevance_score, reverse=True)

    response = JobSearchResponse(
        search_id=search_id,
        results=scored,
        total=len(scored),
        mcp_status=mcp_status,
        cached=False,
        total_found=relevant,
    )

    # Cache results
    await _cache_results(search_id, response)

    return response


async def search_freelance_jobs(keywords: str) -> JobSearchResponse:
    """Search only freelance-specific MCPs (Tunisian + Remote Freelance).

    Uses the profile snapshot for scoring when available, so the relevance
    of freelance results is also profile-driven.
    """
    manager = get_mcp_manager()

    # Only search freelance adapters
    freelance_adapters = ["tunisian", "remote_freelance"]

    all_jobs: list[JobListing] = []
    mcp_status: dict[str, dict[str, Any]] = {}

    import asyncio
    tasks: list[tuple[str, asyncio.Task]] = []
    for name in freelance_adapters:
        if name not in manager.adapters:
            continue
        adapter = manager.adapters[name]
        if not adapter.enabled:
            continue
        circuit = manager.circuits[name]
        task = asyncio.create_task(
            manager._safe_search(name, adapter, circuit, keywords, JobSearchFilters(keywords=keywords))
        )
        tasks.append((name, task))

    results = await asyncio.gather(*(t for _, t in tasks), return_exceptions=True)

    for (name, _), result in zip(tasks, results):
        if isinstance(result, CircuitOpenError):
            mcp_status[name] = {"status": "skipped", "error": "Circuit open"}
        elif isinstance(result, asyncio.TimeoutError):
            mcp_status[name] = {"status": "timeout"}
        elif isinstance(result, Exception):
            mcp_status[name] = {"status": "failed", "error": str(result)}
        else:
            all_jobs.extend(result)
            mcp_status[name] = {"status": "ok", "count": len(result)}

    # Deduplicate
    deduped = _deduplicate(all_jobs)

    # Score relevance against the profile when available
    bundle = await _load_profile_snapshot(request.resume_id)
    if not bundle["empty"]:
        scored, relevant = _score_jobs(deduped, bundle)
    else:
        scored, relevant = _score_relevance(deduped, keywords)

    # Sort by relevance
    scored.sort(key=lambda j: j.relevance_score, reverse=True)

    search_id = _make_search_id(keywords, JobSearchFilters(keywords=keywords))

    return JobSearchResponse(
        search_id=search_id,
        results=scored,
        total=len(scored),
        mcp_status=mcp_status,
        cached=False,
        total_found=relevant,
    )


async def _load_profile_snapshot(resume_id: str | None = None) -> dict[str, Any]:
    """Build the profile snapshot for discovery (skills + experience).

    Returns ``{"snapshot": ..., "skills": [...], "empty": bool}``. The
    snapshot is empty when the user has no tracked skills, in which case
    discovery falls back to resume-derived keywords / substring scoring.

    Work experience comes from the career profile; when the profile has
    none, the resume's parsed work experience is used so roles still
    decide what to fetch.
    """
    skills = await db.list_career_skills()
    profile = await db.get_career_profile()
    work_experience = (profile or {}).get("work_experience") or []
    if not work_experience:
        work_experience = await _resume_work_experience(resume_id)
    has_profile_data = bool(skills)
    snapshot: dict[str, Any] = {}
    market: dict[str, Any] = {}
    if has_profile_data:
        certifications = await db.list_career_certifications()
        projects = await db.list_career_projects()
        profile_for_snapshot = dict(profile or {})
        profile_for_snapshot["work_experience"] = work_experience
        market = compute_market_position(
            skills, certifications, work_experience, projects
        )
        snapshot = build_profile_snapshot(profile_for_snapshot, skills, market)
    return {
        "snapshot": snapshot,
        "skills": skills,
        "empty": not has_profile_data,
    }


async def _resume_work_experience(resume_id: str | None = None) -> list[dict[str, Any]]:
    """Work experience parsed from a resume (role fallback)."""
    try:
        resume = None
        if resume_id:
            resume = await db.get_resume(resume_id)
        if not resume:
            resume = await db.get_master_resume()
        if not resume:
            return []
        processed = resume.get("processed_data") or {}
        return [
            {"role": str(exp.get("title") or "").strip(), "years": str(exp.get("startDate") or "")}
            for exp in processed.get("workExperience", [])
            if exp.get("title")
        ]
    except Exception as exc:
        logger.error("Failed to read resume experience: %s", exc)
        return []


async def _generated_keywords(resume_id: str) -> tuple[str, dict[str, Any] | None]:
    """Profile-driven search keywords + snapshot (fallback to resume)."""
    bundle = await _load_profile_snapshot(resume_id)
    if bundle["empty"]:
        return await _extract_keywords_from_resume(resume_id), None
    queries = build_search_queries(bundle["snapshot"], bundle["skills"])
    keywords = queries[0] if queries else ""
    return keywords, bundle


async def _extract_keywords_from_resume(resume_id: str) -> str:
    """Extract search keywords from a resume's processed data.

    Fallback path used only when the career profile has no skills or work
    experience.
    """
    try:
        resume = await db.get_resume(resume_id)
        if not resume:
            return ""

        processed = resume.get("processed_data", {})
        if not processed:
            return ""

        # Extract skills
        skills = processed.get("additional", {}).get("technicalSkills", [])

        # Extract job titles
        titles = [
            exp.get("title", "")
            for exp in processed.get("workExperience", [])
        ]

        # Build smart keywords
        all_keywords = []

        # Add top skills (most relevant for job search)
        priority_skills = [
            "JavaScript", "TypeScript", "Python", "React", "Node.js",
            "Angular", ".NET", "ASP.NET", "Docker", "Kubernetes",
            "FastAPI", "NestJS", "Spring Boot"
        ]
        for skill in skills:
            for ps in priority_skills:
                if ps.lower() in skill.lower():
                    all_keywords.append(ps)
                    break

        # Add job titles (shorter is better for search)
        for title in titles:
            if "full" in title.lower() or "backend" in title.lower():
                all_keywords.append("Full-Stack Developer")
            elif "software" in title.lower():
                all_keywords.append("Software Engineer")

        # Deduplicate and take top keywords
        seen = set()
        unique = []
        for kw in all_keywords:
            kw_lower = kw.lower()
            if kw_lower not in seen:
                seen.add(kw_lower)
                unique.append(kw)

        return " ".join(unique[:8]) if unique else " ".join(skills[:5])
    except Exception as exc:
        logger.error("Failed to extract keywords from resume %s: %s", resume_id, exc)
        return ""


def _deduplicate(jobs: list[JobListing]) -> list[JobListing]:
    """Remove duplicate jobs by (title, company, location)."""
    seen: set[tuple[str, str, str]] = set()
    unique: list[JobListing] = []
    for job in jobs:
        key = (job.title.lower().strip(), job.company.lower().strip(), job.location.lower().strip())
        if key not in seen:
            seen.add(key)
            unique.append(job)
    return unique


def _score_relevance(jobs: list[JobListing], keywords: str) -> tuple[list[JobListing], int]:
    """Score job relevance against search keywords (fallback, no profile).

    Returns ``(visible_jobs, total_found)`` where jobs below the visibility
    threshold are dropped.
    """
    kw_set = set(k.lower() for k in keywords.split() if k.strip() and len(k) > 1)
    for job in jobs:
        title_lower = job.title.lower()
        desc_lower = (job.description or "").lower()
        text = f"{title_lower} {desc_lower}"

        if not kw_set:
            job.relevance_score = 0.5
            continue

        # Exact title match (highest weight)
        title_matches = sum(1 for kw in kw_set if kw in title_lower)
        title_score = title_matches / len(kw_set) if kw_set else 0.0

        # Description keyword match
        desc_matches = sum(1 for kw in kw_set if kw in desc_lower)
        desc_score = desc_matches / len(kw_set) if kw_set else 0.0

        # Combined keyword score (title weighted 3x)
        keyword_score = (title_score * 3 + desc_score) / 4

        # Role match bonus
        role_bonus = 0.0
        role_keywords = ["engineer", "developer", "software", "full-stack", "fullstack", "backend", "frontend"]
        if any(rk in title_lower for rk in role_keywords):
            role_bonus = 0.15

        # Experience level match
        exp_bonus = 0.0
        if any(level in title_lower for level in ["senior", "lead", "principal"]):
            exp_bonus = 0.1
        elif any(level in title_lower for level in ["junior", "entry", "intern"]):
            exp_bonus = -0.1

        # Remote bonus
        remote_bonus = 0.1 if job.remote else 0.0

        # Recency bonus
        recency_bonus = 0.0
        if job.posted_date:
            try:
                posted = datetime.fromisoformat(job.posted_date.replace("Z", "+00:00"))
                hours_ago = (datetime.now(timezone.utc) - posted).total_seconds() / 3600
                if hours_ago < 24:
                    recency_bonus = 0.1
                elif hours_ago < 168:
                    recency_bonus = 0.05
            except (ValueError, TypeError):
                pass

        # Easy Apply bonus
        easy_apply_bonus = 0.05 if job.easy_apply else 0.0

        job.relevance_score = min(
            1.0,
            0.40 * keyword_score  # Main keyword match
            + role_bonus          # Role type match
            + exp_bonus           # Experience level
            + remote_bonus        # Remote work
            + recency_bonus       # Recent posts
            + easy_apply_bonus    # Easy Apply
        )

    total_found = len(jobs)
    visible = [
        job
        for job in jobs
        if job.relevance_score >= _FALLBACK_VISIBLE_THRESHOLD
    ]
    return visible, total_found


_FALLBACK_VISIBLE_THRESHOLD = 0.35
_MATCH_THRESHOLD = 0.55
_STRETCH_THRESHOLD = 0.35


def _score_jobs(
    jobs: list[JobListing], bundle: dict[str, Any]
) -> tuple[list[JobListing], int]:
    """Profile-driven scoring (skills + experience + seniority + fit).

    Weights: overall = 0.45*skills + 0.25*experience + 0.15*seniority
             + 0.15*fit + small bonuses (remote / recency / easy-apply).

    Filtering: >= 0.55 shown as matches; 0.35-0.55 kept as *stretch* jobs
    only when the title matches the primary role family; < 0.35 hidden.
    Returns ``(visible_jobs, total_found)``.
    """
    snapshot = bundle.get("snapshot", {})
    if not snapshot.get("has_profile"):
        return _score_relevance(jobs, "")

    role_families = snapshot.get("role_families", [])
    primary_family = role_families[0] if role_families else None
    seniority_band = snapshot.get("seniority_band")
    target_locations = snapshot.get("target_locations", [])

    def _role_align(title: str) -> tuple[float, bool]:
        """Role alignment 0..1 plus whether the primary family matched."""
        family, family_score = match_title(title, role_families)
        if family is not None:
            return 0.6 + 0.4 * family_score, family == primary_family
        other_family = _family_from_text(title)
        return (0.3 if other_family else 0.1), False

    for job in jobs:
        title = job.title
        desc = job.description or ""

        # --- skills (45%) -------------------------------------------------
        matched = match_skills(f"{title}. {desc}", snapshot)
        tier_values = {
            "exact": 1.0,
            "related": 0.85,
            "ecosystem": 0.7,
            "unrelated": 0.2,
        }
        present = [
            tier_values[info["tier"]]
            for info in matched.values()
            if info["tier"] in ("exact", "related", "ecosystem")
        ]
        skills_score = sum(present) / len(present) if present else 0.15

        # --- experience (25%) ---------------------------------------------
        role_align, primary_hit = _role_align(title)
        exp_years = snapshot.get("experience_years")
        jd_years = _jd_experience_years(desc)
        years_align = 1.0
        if jd_years and exp_years:
            years_align = min(1.0, exp_years / jd_years) if jd_years > exp_years else 1.0
        experience_score = 0.7 * role_align + 0.3 * years_align

        # --- seniority (15%) ----------------------------------------------
        seniority = seniority_score(title, seniority_band)

        # --- fit (15%) ----------------------------------------------------
        fit_score = max(0.0, 1.0 - negative_penalty(title, role_families))

        # --- bonuses -------------------------------------------------------
        bonus = 0.0
        if job.remote and any(
            loc.lower() in ("remote", "remote work", "anywhere") or "remote" in loc.lower()
            for loc in target_locations
        ):
            bonus += 0.04
        if job.posted_date:
            try:
                posted = datetime.fromisoformat(job.posted_date.replace("Z", "+00:00"))
                hours_ago = (datetime.now(timezone.utc) - posted).total_seconds() / 3600
                if hours_ago < 168:
                    bonus += 0.03
            except (ValueError, TypeError):
                pass
        if job.easy_apply:
            bonus += 0.03

        job.relevance_score = min(
            1.0,
            0.45 * skills_score
            + 0.25 * experience_score
            + 0.15 * seniority
            + 0.15 * fit_score
            + bonus,
        )
        job.is_stretch = False

    total_found = len(jobs)
    visible: list[JobListing] = []
    for job in jobs:
        score = job.relevance_score
        if score >= _MATCH_THRESHOLD:
            visible.append(job)
        elif score >= _STRETCH_THRESHOLD:
            _, primary_hit = _role_align(job.title)
            if primary_hit and primary_family:
                job.is_stretch = True
                visible.append(job)
    return visible, total_found


def _jd_experience_years(jd_text: str) -> int | None:
    """Best-effort years-of-experience from a JD description."""
    if not jd_text:
        return None
    m = re.search(
        r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp\.)?",
        jd_text,
        re.IGNORECASE,
    )
    if m:
        return int(m.group(1))
    m = re.search(r"(\d{1,2})\s*[-–—]\s*\d{1,2}\s*(?:years?|yrs?)", jd_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


async def _get_cached_results(search_id: str) -> JobSearchResponse | None:
    """Check if we have cached results for this search."""
    try:
        # Simple in-memory cache check — could be extended to SQLite
        return None
    except Exception:
        return None


async def _cache_results(search_id: str, response: JobSearchResponse) -> None:
    """Cache search results."""
    # Store in memory for now — SQLite caching can be added later
    pass
