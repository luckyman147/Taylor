"""Job scraper service — orchestrates MCP search, scoring, dedup, caching."""

from __future__ import annotations

import hashlib
import json
import logging
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

    manager.register(LinkedInAdapter())
    manager.register(RSSAdapter())
    manager.register(ExaAdapter())
    manager.register(WebAdapter())
    manager.register(GitHubAdapter())
    manager.register(TunisianFreelanceAdapter())
    manager.register(RemoteFreelanceAdapter())


def _make_search_id(keywords: str, filters: JobSearchFilters) -> str:
    """Generate a deterministic search ID for caching."""
    payload = json.dumps(
        {"k": keywords, "f": filters.model_dump()}, sort_keys=True
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


async def search_jobs(request: JobSearchRequest) -> JobSearchResponse:
    """Execute a full job search across all enabled MCPs."""
    manager = get_mcp_manager()

    # Extract keywords from resume if not provided
    keywords = request.filters.keywords
    if not keywords:
        keywords = await _extract_keywords_from_resume(request.resume_id)
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

    # Score relevance
    scored = _score_relevance(deduped, keywords)

    # Sort by relevance
    scored.sort(key=lambda j: j.relevance_score, reverse=True)

    response = JobSearchResponse(
        search_id=search_id,
        results=scored,
        total=len(scored),
        mcp_status=mcp_status,
        cached=False,
    )

    # Cache results
    await _cache_results(search_id, response)

    return response


async def search_freelance_jobs(keywords: str) -> JobSearchResponse:
    """Search only freelance-specific MCPs (Tunisian + Remote Freelance)."""
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

    # Score relevance
    scored = _score_relevance(deduped, keywords)

    # Sort by relevance
    scored.sort(key=lambda j: j.relevance_score, reverse=True)

    search_id = _make_search_id(keywords, JobSearchFilters(keywords=keywords))

    return JobSearchResponse(
        search_id=search_id,
        results=scored,
        total=len(scored),
        mcp_status=mcp_status,
        cached=False,
    )


async def _extract_keywords_from_resume(resume_id: str) -> str:
    """Extract search keywords from a resume's processed data."""
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

        # Extract education level
        education = processed.get("education", [])
        degree_level = ""
        for edu in education:
            degree = edu.get("degree", "").lower()
            if "phd" in degree or "doctorate" in degree:
                degree_level = "senior"
            elif "master" in degree:
                degree_level = "mid-senior"
            elif "bachelor" in degree:
                degree_level = "entry"

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


def _score_relevance(jobs: list[JobListing], keywords: str) -> list[JobListing]:
    """Score job relevance against search keywords."""
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

    return jobs


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
