"""Company discovery service — orchestrates multi-source company search.

Combines:
- Job mining (existing job scrapers)
- Web search (Exa + Jina crawl)
- OpenStreetMap (Overpass + Nominatim)

Then merges, deduplicates, and scores candidates against the user profile.
"""

from __future__ import annotations

import copy
import json
import logging
import re
import uuid
from typing import Any

from app.database import db
from app.llm import complete_json
from app.llm_cache import get_or_compute, make_key
from app.services.career_profile import build_career_memory
from app.services.job_scraper import search_jobs
from app.services.osm_companies import (
    extract_keywords_from_profile,
    fetch_companies_in_area,
    geocode_area,
)
from app.services.skill_ontology import (
    build_profile_snapshot,
    build_search_queries,
    match_skills,
    match_title,
    seniority_score,
)
from app.schemas.job_scraper import JobSearchFilters, JobSearchRequest

logger = logging.getLogger(__name__)

MAX_CANDIDATES_PER_SOURCE = 20
MAX_TOTAL_CANDIDATES = 30


def _normalize_company_name(name: str) -> str:
    """Normalize company name for deduplication.

    Strips common suffixes like ' Inc', ' LLC', ' Ltd', ' GmbH', ' SA',
    location suffixes after '|' or ' - ', collapses whitespace, casefolds.
    """
    if not name:
        return ""
    normalized = name
    for suffix in (" inc", " inc.", " llc", " l.l.c.", " ltd", " ltd.", " gmbh", " sa", " s.a.", " s.r.l.", " pty", " co", " co.", " corp", " corp.", " corporation"):
        if normalized.lower().endswith(suffix):
            normalized = normalized[: -len(suffix)]
            break
    normalized = normalized.split("|")[0].split(" - ")[0]
    normalized = re.sub(r"\s+", " ", normalized.strip()).casefold()
    return normalized


async def _build_profile_context(resume_id: str | None = None) -> dict[str, Any]:
    """Build the full profile context for discovery."""
    memory = await build_career_memory()
    profile = memory.get("profile", {})
    skills = memory.get("skills", [])
    market_position = memory.get("market_position", {})

    snapshot = build_profile_snapshot(profile, skills, market_position)
    queries = build_search_queries(snapshot, skills)

    return {
        "profile": profile,
        "skills": skills,
        "market_position": market_position,
        "snapshot": snapshot,
        "queries": queries,
    }


async def discover_from_jobs(
    profile_ctx: dict[str, Any],
    keywords: list[str] | None = None,
    locations: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Branch A: Mine companies from job search results."""
    snapshot = profile_ctx["snapshot"]
    search_keywords = keywords or snapshot.get("skill_names", [])[:10]
    search_locations = locations or snapshot.get("target_locations", [])[:3]

    if not search_keywords:
        search_keywords = ["software engineer"]
    if not search_locations:
        search_locations = ["remote"]

    # Map location strings to LocationFilter enum values
    location_map = {
        "tunis": "tunisia",
        "tunisia": "tunisia",
        "sfax": "tunisia",
        "sousse": "tunisia",
        "remote": "remote",
        "paris": "france",
        "france": "france",
        "london": "uk",
        "uk": "uk",
        "berlin": "germany",
        "germany": "germany",
        "madrid": "spain",
        "spain": "spain",
        "new york": "us",
        "us": "us",
        "united states": "us",
        "canada": "canada",
        "singapore": "singapore",
        "dubai": "uae",
        "uae": "uae",
        "riyadh": "saudi_arabia",
        "saudi": "saudi_arabia",
        "doha": "qatar",
        "qatar": "qatar",
        "cairo": "egypt",
        "egypt": "egypt",
    }
    mapped_locations = []
    for loc in search_locations:
        loc_lower = loc.lower().strip()
        mapped = location_map.get(loc_lower, "global")
        if mapped not in mapped_locations:
            mapped_locations.append(mapped)

    filters = JobSearchFilters(
        keywords=" ".join(search_keywords),
        locations=mapped_locations if mapped_locations else ["global"],
        job_types=[],
        experience_levels=[],
        work_types=[],
        date_posted="past_month",
        easy_apply_only=False,
        max_pages=3,
    )
    request = JobSearchRequest(
        resume_id="",
        filters=filters,
        sources=["linkedin", "exa", "rss", "keejob", "remote_freelance", "tunisian"],
    )

    try:
        response = await search_jobs(request)
        jobs = response.results
    except Exception as exc:
        logger.warning("Job mining failed: %s", exc)
        return []

    company_map: dict[str, dict[str, Any]] = {}
    for job in jobs:
        company_name = job.company
        if not company_name:
            continue
        norm = _normalize_company_name(company_name)
        if norm not in company_map:
            company_map[norm] = {
                "name": company_name,
                "source": "job_mining",
                "website": None,
                "industry": None,
                "description": None,
                "sample_roles": [],
                "locations": set(),
            }
        entry = company_map[norm]
        if job.title:
            entry["sample_roles"].append(job.title)
        if job.location:
            entry["locations"].add(job.location)

    candidates = []
    for entry in company_map.values():
        entry["locations"] = list(entry["locations"])
        candidates.append(entry)
    return candidates[:MAX_CANDIDATES_PER_SOURCE]


async def discover_from_web_search(
    profile_ctx: dict[str, Any],
    queries: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Branch B: Exa/Jina web search for companies."""
    from app.services.mcp.exa import ExaAdapter
    from app.services.mcp.web import WebAdapter
    from app.services.mcp.crawl4ai import Crawl4AIAdapter

    search_queries = queries or profile_ctx.get("queries", [])
    if not search_queries:
        search_queries = ["top tech companies hiring"]

    candidates: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    exa = ExaAdapter()
    web = WebAdapter()
    crawl = Crawl4AIAdapter()

    for query in search_queries[:3]:
        try:
            exa_jobs = await exa.search_jobs(query, JobSearchFilters(keywords=query))
        except Exception:
            exa_jobs = []

        for job in exa_jobs[:10]:
            company_name = job.company or ""
            if not company_name:
                continue
            norm = _normalize_company_name(company_name)
            if norm in seen_names:
                continue
            seen_names.add(norm)

            website = job.url
            description = job.description[:500] if job.description else None

            candidates.append({
                "name": company_name,
                "source": "web",
                "website": website,
                "industry": None,
                "description": description,
                "sample_roles": [job.title] if job.title else [],
                "locations": [job.location] if job.location else [],
            })

            if len(candidates) >= MAX_CANDIDATES_PER_SOURCE:
                break

        if len(candidates) >= MAX_CANDIDATES_PER_SOURCE:
            break

    return candidates[:MAX_CANDIDATES_PER_SOURCE]


async def discover_from_openstreetmap(
    profile_ctx: dict[str, Any],
) -> list[dict[str, Any]]:
    """Branch C: OpenStreetMap Overpass query for companies in target locations."""
    snapshot = profile_ctx["snapshot"]
    target_locations = snapshot.get("target_locations", [])
    keywords = extract_keywords_from_profile(profile_ctx.get("profile"), profile_ctx.get("skills", []))

    if not target_locations:
        return []

    all_candidates: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for location in target_locations[:3]:
        area = await geocode_area(location)
        if not area:
            continue

        area_name = area.get("display_name", "").split(",")[0].strip()
        try:
            osm_companies = await fetch_companies_in_area(area_name, keywords, MAX_CANDIDATES_PER_SOURCE)
        except Exception as exc:
            logger.warning("OSM fetch failed for %s: %s", location, exc)
            continue

        for c in osm_companies:
            norm = _normalize_company_name(c["name"])
            if norm in seen_names:
                continue
            seen_names.add(norm)

            all_candidates.append({
                "name": c["name"],
                "source": "openstreetmap",
                "website": c.get("website"),
                "industry": c.get("industry"),
                "description": None,
                "sample_roles": [],
                "locations": [location],
                "city": c.get("city"),
                "country": c.get("country"),
                "phone": c.get("phone"),
                "email": c.get("email"),
            })

    return all_candidates[:MAX_CANDIDATES_PER_SOURCE]


def _merge_and_dedupe(
    branch_results: dict[str, list[dict[str, Any]]],
    existing_companies: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge candidates from all branches, deduplicate by normalized name.

    Skips companies already tracked by the user.
    """
    existing_norms = {_normalize_company_name(c.get("name", "")) for c in existing_companies}
    merged: dict[str, dict[str, Any]] = {}
    sources_seen: dict[str, set[str]] = {}

    for source, candidates in branch_results.items():
        for c in candidates:
            norm = _normalize_company_name(c["name"])
            if norm in existing_norms:
                c["tracked"] = True
            else:
                c["tracked"] = False

            if norm not in merged:
                merged[norm] = copy.deepcopy(c)
                merged[norm]["sources"] = {source}
                sources_seen[norm] = {source}
            else:
                merged[norm]["sources"].add(source)
                sources_seen[norm].add(source)
                if not merged[norm].get("website") and c.get("website"):
                    merged[norm]["website"] = c["website"]
                if not merged[norm].get("industry") and c.get("industry"):
                    merged[norm]["industry"] = c["industry"]
                if c.get("city") and not merged[norm].get("city"):
                    merged[norm]["city"] = c["city"]
                if c.get("country") and not merged[norm].get("country"):
                    merged[norm]["country"] = c["country"]
                merged[norm]["sample_roles"] = list(
                    set(merged[norm].get("sample_roles", []) + c.get("sample_roles", []))
                )
                merged[norm]["locations"] = list(
                    set(merged[norm].get("locations", []) + c.get("locations", []))
                )

    result = list(merged.values())
    result.sort(key=lambda c: (c.get("tracked", False), -len(c.get("sources", [])), c["name"]))
    return result[:MAX_TOTAL_CANDIDATES]


async def _score_candidates(
    profile_ctx: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Score candidates against the profile.

    Deterministic pre-score + single batched LLM call for match reasons.
    """
    snapshot = profile_ctx["snapshot"]
    profile = profile_ctx["profile"]
    skills = profile_ctx["skills"]

    scored = []
    for c in candidates:
        text_parts = [
            c.get("name", ""),
            c.get("industry", "") or "",
            c.get("description", "") or "",
            " ".join(c.get("sample_roles", [])),
        ]
        combined_text = " ".join(text_parts)

        skill_matches = match_skills(combined_text, snapshot)
        exact_count = sum(1 for v in skill_matches.values() if v["tier"] == "exact")
        related_count = sum(1 for v in skill_matches.values() if v["tier"] == "related")
        total_skills = len(skill_matches)
        skill_score = (exact_count * 1.0 + related_count * 0.85) / max(total_skills, 1)

        role_families = snapshot.get("role_families", [])
        best_family, title_score = match_title(
            " ".join(c.get("sample_roles", []) or [""]), role_families
        )

        seniority_band = snapshot.get("seniority_band")
        seniority = seniority_score(seniority_band or "mid", " ".join(c.get("sample_roles", [])))

        det_score = 0.45 * skill_score + 0.25 * title_score + 0.15 * seniority + 0.15 * min(len(c.get("sources", [])) * 0.1, 0.3)

        c["det_score"] = det_score
        c["skill_matches"] = skill_matches
        c["best_family"] = best_family
        c["title_score"] = title_score
        c["seniority"] = seniority
        scored.append(c)

    scored.sort(key=lambda c: c["det_score"], reverse=True)
    top_candidates = scored[:MAX_TOTAL_CANDIDATES]

    if not top_candidates:
        return top_candidates

    cache_key = make_key(
        "discovery_score",
        profile_ctx["profile"].get("source_resume_id", ""),
        tuple(sorted(c["name"] for c in top_candidates)),
    )

    async def _llm_score() -> dict[str, Any]:
        prompt = _build_scoring_prompt(profile, skills, top_candidates)
        result = await complete_json(prompt, temperature=0.1, max_tokens=2000)
        return result

    try:
        llm_result = await get_or_compute(cache_key, _llm_score, ttl=3600.0)
        reasons_map = llm_result.get("reasons", {}) if isinstance(llm_result, dict) else {}
    except Exception as exc:
        logger.warning("LLM scoring failed: %s", exc)
        reasons_map = {}

    for c in top_candidates:
        c["match_score"] = round(c["det_score"], 3)
        c["match_reasons"] = reasons_map.get(c["name"], [
            f"Skill match: {c['det_score']:.0%}",
            f"Role fit: {c['title_score']:.0%}",
            f"Seniority alignment: {c['seniority']:.0%}",
        ][:3])
        del c["det_score"]
        del c["skill_matches"]
        del c["best_family"]
        del c["title_score"]
        del c["seniority"]

    return top_candidates


def _build_scoring_prompt(
    profile: dict[str, Any],
    skills: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
) -> str:
    """Build the LLM scoring prompt."""
    skill_names = [s.get("name", "") for s in skills[:20] if s.get("name")]
    target_roles = profile.get("target_roles", [])
    target_locations = profile.get("target_locations", [])

    candidate_lines = []
    for c in candidates:
        parts = [f"- {c['name']}"]
        if c.get("industry"):
            parts.append(f"  Industry: {c['industry']}")
        if c.get("sample_roles"):
            parts.append(f"  Roles: {', '.join(c['sample_roles'][:3])}")
        if c.get("locations"):
            parts.append(f"  Locations: {', '.join(c['locations'][:3])}")
        if c.get("website"):
            parts.append(f"  Website: {c['website']}")
        candidate_lines.append("\n".join(parts))

    return f"""Analyze these companies against the candidate's profile and return a JSON object with match reasons.

Candidate Profile:
- Skills: {', '.join(skill_names[:15])}
- Target Roles: {', '.join(target_roles) if target_roles else 'Not specified'}
- Target Locations: {', '.join(target_locations) if target_locations else 'Not specified'}

Companies to Evaluate:
{chr(10).join(candidate_lines)}

Return JSON: {{"reasons": {{"Company Name": ["reason 1", "reason 2", "reason 3"]}}}}
Each company should have 2-3 specific, concise reasons referencing the profile (skills, roles, location).
Only include companies from the list above. No extra commentary."""


async def discover_companies(
    resume_id: str | None = None,
    keywords: list[str] | None = None,
    locations: list[str] | None = None,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    """Main entry point: run the full discovery pipeline.

    Returns:
        dict with 'search_id' and 'companies' list
    """
    profile_ctx = await _build_profile_context(resume_id)

    existing = await db.list_companies()

    branch_results: dict[str, list[dict[str, Any]]] = {}

    if not sources or "jobs" in sources:
        branch_results["jobs"] = await discover_from_jobs(profile_ctx, keywords, locations)

    if not sources or "web" in sources:
        branch_results["web"] = await discover_from_web_search(profile_ctx, profile_ctx.get("queries", []))

    if not sources or "openstreetmap" in sources:
        branch_results["openstreetmap"] = await discover_from_openstreetmap(profile_ctx)

    merged = _merge_and_dedupe(branch_results, existing)
    scored = await _score_candidates(profile_ctx, merged)

    search_id = str(uuid.uuid4())[:16]
    for c in scored:
        await db.create_discovered_company(
            search_id=search_id,
            name=c["name"],
            website=c.get("website"),
            industry=c.get("industry"),
            description=c.get("description"),
            match_score=c["match_score"],
            match_reasons=c["match_reasons"],
            source=",".join(sorted(c.get("sources", []))),
        )

    return {"search_id": search_id, "companies": scored}