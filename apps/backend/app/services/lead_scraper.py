"""Lead scraper service — orchestrates sources, categorization, dedup, persist.

Pipeline: source adapters (LinkedIn MCP + Exa + DuckDuckGo web) → heuristic
categorization → one batched AI call for unsure leftovers → three-tier dedup
(seeded with existing DB leads) → best-effort contact enrichment → persist.

Long work runs inline (same contract as the job scraper); result caps and
per-domain delays keep LinkedIn session usage and web crawls polite.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from typing import Any, Callable
from uuid import uuid4

from app.config_cache import get_content_language
from app.database import db
from app.llm import complete_json
from app.prompts import get_language_name
from app.prompts.leads import (
    LEAD_CLASSIFY_PROMPT,
    LEAD_CLASSIFY_SYSTEM_PROMPT,
    LEAD_CRITERIA_PROMPT,
    LEAD_CRITERIA_SYSTEM_PROMPT,
    LEAD_QUERY_PROMPT,
    LEAD_QUERY_SYSTEM_PROMPT,
)
from app.schemas.leads import (
    LeadCriteria,
    LeadCriteriaRequest,
    LeadCriteriaResponse,
    LeadOut,
    LeadSaveRequest,
    LeadSearchRequest,
    LeadSearchResponse,
    DedupStats,
)
from app.services.lead_categorizer import apply_ai_classification, apply_heuristics
from app.services.lead_dedup import LeadDeduper, normalize_name

logger = logging.getLogger(__name__)

MAX_ENRICH_PER_SEARCH = 12
MAX_PROFILE_FETCHES = 12
MAX_COMPANY_FETCHES = 6
MAX_LOCATION_QUERIES = 3
LINKEDIN_COMPANY_HITS = 10

# Progress callback: receives plain dicts shaped like LeadProgressEvent.
LeadEmit = Callable[[dict[str, Any]], None]

_REMOTE_LOCATION_TOKENS = {"remote", "anywhere", "worldwide", "global"}


def _make_search_id(req: LeadSearchRequest) -> str:
    payload = json.dumps(
        {
            "k": req.keywords,
            "t": (req.target or "").strip().lower(),
            "p": (req.purpose or "").strip().lower(),
            "loc": sorted(req.locations),
            "types": sorted(t.value for t in req.lead_types),
            "src": sorted(req.sources),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _location_str(req: LeadSearchRequest) -> str | None:
    return ", ".join(req.locations) if req.locations else None


def _location_queries(req: LeadSearchRequest) -> list[str]:
    """Individual location strings for per-location source queries (max 3)."""
    return [loc.strip() for loc in (req.locations or []) if loc.strip()][
        :MAX_LOCATION_QUERIES
    ]


def location_matches(candidate_location: str | None, requested_locations: list[str]) -> bool:
    """Strict gate: the candidate's known location must match a requested one.

    Each requested location is treated as a comma-separated group; any part
    matching with word boundaries counts. Unknown candidate locations never
    match (except a remote-flavored request against a remote-flavored
    candidate). No requested locations disables the gate.
    """
    if not requested_locations:
        return True
    if not candidate_location:
        return False
    loc = candidate_location.lower()
    for requested in requested_locations:
        parts = [p.strip().lower() for p in requested.split(",") if p.strip()]
        for part in parts:
            if part in _REMOTE_LOCATION_TOKENS:
                if any(token in loc for token in _REMOTE_LOCATION_TOKENS):
                    return True
                continue
            if re.search(rf"\b{re.escape(part)}\b", loc):
                return True
    return False


def filter_by_location(
    candidates: list[dict[str, Any]], requested_locations: list[str]
) -> list[dict[str, Any]]:
    """Keep only candidates whose known location matches the request."""
    if not requested_locations:
        return candidates
    return [
        c for c in candidates if location_matches(c.get("location"), requested_locations)
    ]


def _person_shaped(req: LeadSearchRequest) -> bool:
    from app.schemas.leads import LeadType

    return not req.lead_types or LeadType.person in req.lead_types


def _company_shaped(req: LeadSearchRequest) -> bool:
    from app.schemas.leads import LeadType

    return not req.lead_types or any(t in req.lead_types for t in (LeadType.company, LeadType.agency))


def _safe_name_from_title(title: str) -> str:
    """Extract a person name from a search-result title.

    Handles "Jane Doe - Acme | LinkedIn", "Jane Doe, CEO at Acme", "Jane Doe".
    """
    if not title:
        return ""
    cleaned = re.sub(r"\s*[|\-–•].*$", "", title).strip()
    cleaned = re.sub(r",\s.*$", "", cleaned).strip()
    cleaned = re.sub(r"\s+at\s+.*$", "", cleaned, flags=re.I).strip()
    return cleaned or title.strip()


def parse_snippet_fields(text: str) -> dict[str, str]:
    """Best-effort title/company/location extraction from search snippets.

    Handles shapes like "Jane Doe - Software Engineer at Acme - Tunis, Tunisia"
    and "Acme Corp - Software company in Paris · 11-50 employees".
    """
    fields: dict[str, str] = {}
    if not text:
        return fields
    # Drop LinkedIn suffix noise and URLs.
    cleaned = re.sub(r"\s*\|?\s*LinkedIn\s*$", "", text.strip(), flags=re.I)
    parts = [p.strip() for p in re.split(r"\s*[–—•·]|\s+-\s+", cleaned) if p.strip()]
    if len(parts) < 2:
        return fields
    # "Role at Company" / "Role - Company" → title + company.
    at_match = re.match(
        r"(.+?)\s+at\s+(.+?)(?:\s*[,(].*)?$", parts[1], flags=re.I
    )
    if at_match:
        fields["title"] = at_match.group(1).strip()
        fields["company"] = at_match.group(2).strip().rstrip(".,;")
    elif re.search(r"\b(CEO|CTO|CFO|COO|founder|head|director|manager|engineer|recruiter|president|partner|consultant)\b",
                   parts[1], flags=re.I):
        fields["title"] = parts[1].rstrip(".,;")
    elif len(parts[1]) <= 90 and not re.search(r"\d{4,}|http", parts[1]):
        fields["company"] = parts[1].rstrip(".,;")
    # Remaining segments: prefer "City, Country" / Title-Case place shapes.
    for part in parts[2:4]:
        if len(part) > 80 or re.search(r"\d{3,}|http|@", part):
            continue
        if "," in part or re.fullmatch(r"[A-Z][A-Za-z.\- ]+", part):
            fields["location"] = part.rstrip(".,;")
            break
    return fields


_LOCATION_LINE_RE = re.compile(r"^[A-Z][^,\n]{1,40},\s*[^,\n]{1,40}(?:\s*\([A-Z]{2}\))?$")
_INDUSTRY_RE = re.compile(r"\bis an?\s+([^.,\n]{3,60}?)\s+company\b", re.I)


def parse_person_snippet(item_title: str, text: str) -> dict[str, str]:
    """Extract title/company/location from an Exa/web person snippet.

    Snippets look like::

        Headline or Role at Company

        City, Country (CC)
        ...
        <about text>

    Newlines are structural here (unlike search-result titles), so parse
    line-by-line instead of splitting on dashes.
    """
    fields: dict[str, str] = {}
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    headline = ""
    for ln in lines[:6]:
        if _LOCATION_LINE_RE.match(ln):
            if "location" not in fields:
                fields["location"] = re.sub(r"\s*\([A-Z]{2}\)$", "", ln)
            continue
        if not headline and len(ln) <= 220 and not ln.startswith(("http", "...", "#")):
            headline = ln
    if not headline and item_title:
        headline = item_title.strip()
    if not headline:
        return fields
    at_match = re.match(r"(.+?)\s+at\s+(.+)$", headline, flags=re.I)
    if at_match:
        fields["title"] = at_match.group(1).strip()
        company = re.sub(r"\s*[|·•–—-]\s+.*$", "", at_match.group(2)).strip(" .,;|")
        if company:
            fields["company"] = company
    else:
        fields["title"] = re.sub(r"\s*[|·•–—].*$", "", headline).strip() or headline
    return fields


def parse_company_snippet(item_title: str, text: str) -> dict[str, str]:
    """Extract industry/location from an Exa/web company snippet.

    Exa company text typically opens with "Name is a/an <industry> company."
    and may mention "Headquartered in <City>".
    """
    fields: dict[str, str] = {}
    flat = re.sub(r"\s*\n+\s*", " ", text or "")
    industry = _INDUSTRY_RE.search(flat)
    if industry:
        fields["industry"] = industry.group(1).strip()
    hq = re.search(r"[Hh]eadquartered in ([^,.\n]{2,60}(?:,\s*[^,.\n]{2,60})?)", flat)
    if hq:
        fields["location"] = hq.group(1).strip()
    if not fields.get("location"):
        parsed = parse_snippet_fields(f"{item_title} - {flat[:300]}" if flat else item_title)
        fields.setdefault("location", parsed.get("location", ""))
    return fields


# -- AI steps -----------------------------------------------------------------


async def _profile_summary(resume_id: str | None) -> str:
    """Short profile text for the criteria prompt (career memory, else resume)."""
    chunks: list[str] = []
    try:
        from app.services.career_profile import build_career_memory

        memory = await build_career_memory()
        profile = memory.get("profile", {}) or {}
        skills = [s.get("name", "") for s in (memory.get("skills") or [])[:12]]
        if profile.get("headline") or profile.get("title"):
            chunks.append(f"Current role: {profile.get('headline') or profile.get('title')}")
        if skills:
            chunks.append("Skills: " + ", ".join(s for s in skills if s))
        market = memory.get("market_position", {}) or {}
        if market.get("target_titles"):
            chunks.append("Target titles: " + ", ".join(market["target_titles"][:5]))
    except Exception as exc:
        logger.debug("Career memory unavailable for criteria: %s", exc)
    if not chunks and resume_id:
        try:
            resume = await db.get_resume(resume_id)
            processed = (resume or {}).get("processed_data") or {}
            personal = processed.get("personalInfo", {}) or {}
            if personal.get("name"):
                chunks.append(f"Candidate: {personal['name']}")
            titles = [
                exp.get("title", "")
                for exp in processed.get("workExperience", [])[:3]
                if exp.get("title")
            ]
            if titles:
                chunks.append("Recent titles: " + ", ".join(titles))
        except Exception as exc:
            logger.debug("Resume unavailable for criteria: %s", exc)
    return "\n".join(chunks) if chunks else "No profile available — infer from the goal/niche only."


async def _tracked_names(limit: int = 40) -> list[str]:
    """Names already in Contacts/Companies — excluded from AI suggestions."""
    names: list[str] = []
    try:
        contacts = await db.list_contacts()
        names.extend(str(c.get("name") or "") for c in contacts if c.get("name"))
    except Exception as exc:
        logger.debug("list_contacts failed for tracked names: %s", exc)
    try:
        companies = await db.list_companies()
        names.extend(str(c.get("name") or "") for c in companies if c.get("name"))
    except Exception as exc:
        logger.debug("list_companies failed for tracked names: %s", exc)
    deduped: list[str] = []
    seen: set[str] = set()
    for name in names:
        key = normalize_name(name)
        if key and key not in seen:
            seen.add(key)
            deduped.append(name)
    return deduped[:limit]


def _format_current_params(req: LeadCriteriaRequest) -> str:
    """JSON dump of the user's non-empty in-form params for the prompt."""
    cur = req.current
    if cur is None:
        return "none"
    data: dict[str, Any] = {}
    if cur.keywords and cur.keywords.strip():
        data["keywords"] = cur.keywords.strip()
    if cur.target and cur.target.strip():
        data["target"] = cur.target.strip()
    if cur.purpose and cur.purpose.strip():
        data["purpose"] = cur.purpose.strip()
    if cur.locations:
        data["locations"] = list(cur.locations)
    if cur.lead_types:
        data["lead_types"] = [lt.value if hasattr(lt, "value") else str(lt) for lt in cur.lead_types]
    if cur.sources:
        data["sources"] = list(cur.sources)
    if not data:
        return "none"
    return json.dumps(data, ensure_ascii=False)


async def recommend_criteria(req: LeadCriteriaRequest) -> LeadCriteriaResponse:
    """AI-proposed search criteria; the user reviews before any scraping.

    When ``req.current`` is provided the model optimizes the user's existing
    params instead of generating from scratch.
    """
    tracked = await _tracked_names()
    profile_summary = await _profile_summary(req.resume_id)
    output_language = get_language_name(get_content_language())
    prompt = LEAD_CRITERIA_PROMPT.format(
        profile_summary=profile_summary or "No profile available.",
        goal=req.goal or "general professional networking / lead research",
        niche=req.niche or "not specified",
        current_params=_format_current_params(req),
        tracked_names=json.dumps(tracked, ensure_ascii=False) if tracked else "none",
        output_language=output_language,
    )
    fallback = LeadCriteria(
        keywords=[req.niche] if req.niche else [],
        rationale="LLM unavailable — enter criteria manually.",
    )
    try:
        data = await complete_json(
            prompt,
            system_prompt=LEAD_CRITERIA_SYSTEM_PROMPT,
            schema_type="keywords",
            max_tokens=1200,
        )
        valid_types = {"person", "company", "agency"}
        lead_types = [t for t in (data.get("lead_types") or []) if t in valid_types] or [
            "person",
            "company",
        ]
        criteria = LeadCriteria(
            keywords=[str(k) for k in (data.get("keywords") or [])][:8],
            titles=[str(t) for t in (data.get("titles") or [])][:6],
            industries=[str(i) for i in (data.get("industries") or [])][:5],
            locations=[str(l) for l in (data.get("locations") or [])][:4],
            company_types=[str(c) for c in (data.get("company_types") or [])][:4],
            lead_types=lead_types,
            seniorities=[str(s) for s in (data.get("seniorities") or [])][:5],
            target=str(data.get("target")).strip()[:300] if data.get("target") else None,
            purpose=str(data.get("purpose")).strip()[:300] if data.get("purpose") else None,
            recency_hint=data.get("recency_hint") or None,
            rationale=data.get("rationale") or None,
        )
        return LeadCriteriaResponse(criteria=criteria, tracked_names=tracked)
    except Exception as exc:
        logger.error("Lead criteria recommendation failed: %s", exc)
        return LeadCriteriaResponse(criteria=fallback, tracked_names=tracked)


async def build_search_query(req: LeadSearchRequest) -> str:
    """One refined keywords string from the target/purpose context.

    Uses a small LLM call; falls back to naive ``keywords + target`` when no
    LLM is configured or the call fails. Returns the original keywords when
    neither context field is set.
    """
    if not (req.target or req.purpose):
        return req.keywords
    fallback = " ".join(
        part for part in (req.keywords.strip(), (req.target or "").strip()) if part
    )[:200]
    prompt = LEAD_QUERY_PROMPT.format(
        keywords=req.keywords,
        target=req.target or "not specified",
        purpose=req.purpose or "not specified",
    )
    try:
        data = await complete_json(
            prompt,
            system_prompt=LEAD_QUERY_SYSTEM_PROMPT,
            schema_type="keywords",
            max_tokens=200,
        )
        refined = str((data or {}).get("keywords") or "").strip()
        if refined:
            return refined[:200]
    except Exception as exc:
        logger.warning("Lead query planning failed (using fallback): %s", exc)
    return fallback


async def _ai_classify_unsure(
    unsure: list[dict[str, Any]], purpose: str | None = None
) -> dict[str, str]:
    """One batched LLM call classifying only the heuristic-unsure leftovers."""
    if not unsure:
        return {}
    leads_json = json.dumps(
        [
            {
                "id": str(i),
                "name": r.get("name"),
                "title": r.get("title"),
                "company": r.get("company"),
                "description": (r.get("description") or "")[:200],
            }
            for i, r in enumerate(unsure)
        ],
        ensure_ascii=False,
    )
    output_language = get_language_name(get_content_language())
    try:
        data = await complete_json(
            LEAD_CLASSIFY_PROMPT.format(
                leads_json=leads_json,
                output_language=output_language,
                purpose=purpose or "not specified",
            ),
            system_prompt=LEAD_CLASSIFY_SYSTEM_PROMPT,
            schema_type="keywords",
            max_tokens=800,
        )
        id_map = {str(i): r for i, r in enumerate(unsure)}
        classifications: dict[str, str] = {}
        for key, value in (data or {}).items():
            record = id_map.get(str(key))
            if record is None:
                continue
            lookup = str(record.get("linkedin_url") or record.get("name") or "").lower()
            if lookup and value in ("contact", "company", "agency"):
                classifications[lookup] = value
        return classifications
    except Exception as exc:
        logger.warning("AI lead classification failed (keeping unsure): %s", exc)
        return {}


# -- Source adapters -----------------------------------------------------------


async def _search_linkedin(
    req: LeadSearchRequest, emit: LeadEmit | None = None
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """People + company search via the logged-in LinkedIn MCP session."""
    from app.services.mcp.linkedin import LinkedInAdapter

    emit = emit or (lambda _e: None)
    adapter = LinkedInAdapter()
    status: dict[str, Any] = {"available": False, "details": "not checked"}
    try:
        available = await adapter.is_available()
    except Exception as exc:
        return [], {"available": False, "details": str(exc)}
    status = {"available": available, "details": "Connected" if available else "LinkedIn MCP not running"}
    if not available:
        return [], status

    candidates: list[dict[str, Any]] = []
    keywords = req.keywords

    if _person_shaped(req):
        # One query per requested location — a glued "City1, City2" string
        # degrades LinkedIn's location filter.
        people_hits: list[dict[str, Any]] = []
        for loc in _location_queries(req) or [None]:
            emit({"phase": "searching", "source": "linkedin", "detail": loc})
            try:
                hits = await adapter.search_people(keywords, location=loc)
            except Exception as exc:
                logger.warning("LinkedIn search_people failed for %r: %s", loc, exc)
                hits = []
            for hit in hits:
                hit["_queried_location"] = loc
            people_hits.extend(hits)

        # Cross-location duplicates would double the slow profile reads.
        seen_urls: set[str] = set()
        for hit in people_hits:
            url = (hit.get("url") or "").rstrip("/").lower()
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            candidates.append(
                {
                    "name": hit.get("name") or "",
                    "lead_type": "person",
                    "linkedin_url": hit.get("url"),
                    "location": hit.get("_queried_location"),
                    "source": "linkedin",
                    "sources": ["linkedin"],
                }
            )

        # Enrich profiles for title/company/location/contact (browser calls
        # are slow, so capped — but enough to fill the visible first page).
        fetch_targets = [c for c in candidates if c.get("linkedin_url")][
            :MAX_PROFILE_FETCHES
        ]
        for index, candidate in enumerate(fetch_targets):
            url = candidate["linkedin_url"]
            emit(
                {
                    "phase": "profiles",
                    "done": index + 1,
                    "total": len(fetch_targets),
                    "detail": candidate.get("name") or url,
                }
            )
            try:
                profile = await adapter.get_person_profile(url)
            except Exception as exc:
                logger.debug("get_person_profile failed for %s: %s", url, exc)
                continue
            if not profile:
                continue
            if profile.get("name") and not candidate.get("name"):
                candidate["name"] = profile["name"]
            candidate["title"] = profile.get("current_title") or profile.get("headline")
            candidate["company"] = profile.get("current_company")
            if profile.get("location"):
                candidate["location"] = profile["location"]
            if profile.get("email"):
                candidate["email"] = profile["email"]
            if profile.get("phone"):
                candidate["phone"] = profile["phone"]
            if profile.get("about"):
                candidate["description"] = profile["about"]

    if _company_shaped(req):
        try:
            companies = await adapter.search_companies(keywords)
        except Exception as exc:
            logger.warning("LinkedIn search_companies failed: %s", exc)
            companies = []
        for hit in companies:
            candidates.append(
                {
                    "name": hit.get("name") or "",
                    "lead_type": "company",
                    "linkedin_url": hit.get("url"),
                    "source": "linkedin",
                    "sources": ["linkedin"],
                }
            )
        company_targets = [c for c in candidates if c.get("lead_type") == "company"][
            :MAX_COMPANY_FETCHES
        ]
        for index, candidate in enumerate(company_targets):
            url = candidate.get("linkedin_url") or ""
            slug = url.rstrip("/").rsplit("/", 1)[-1]
            if not slug:
                continue
            emit(
                {
                    "phase": "companies",
                    "done": index + 1,
                    "total": len(company_targets),
                    "detail": candidate.get("name") or slug,
                }
            )
            try:
                profile = await adapter.get_company_profile(slug)
            except Exception as exc:
                logger.debug("get_company_profile failed for %s: %s", slug, exc)
                continue
            if not profile:
                continue
            # The about page opens with the canonical display name.
            if profile.get("name"):
                candidate["name"] = profile["name"]
            if profile.get("about"):
                candidate["description"] = profile["about"]
            if profile.get("industry"):
                candidate["industry"] = profile["industry"]
            if profile.get("location"):
                candidate["location"] = profile["location"]
            if profile.get("company_size"):
                candidate["company_size"] = profile["company_size"]

    return [c for c in candidates if c.get("name")], status


async def _search_exa(
    req: LeadSearchRequest, emit: LeadEmit | None = None
) -> list[dict[str, Any]]:
    """Exa neural search for LinkedIn profiles/company pages + open web."""
    from app.services.mcp.exa import ExaAdapter

    emit = emit or (lambda _e: None)
    adapter = ExaAdapter()
    if not await adapter.is_available():
        return []
    location = _location_str(req) or ""
    queries: list[str] = []
    if _person_shaped(req):
        queries.append(f"{req.keywords} {location} site:linkedin.com/in".strip())
    if _company_shaped(req):
        queries.append(f"{req.keywords} {location} site:linkedin.com/company".strip())
        queries.append(f"{req.keywords} agency {location}".strip())

    emit({"phase": "searching", "source": "exa", "detail": f"{len(queries)} queries"})
    candidates: list[dict[str, Any]] = []
    for query in queries[:3]:
        try:
            results = await adapter.search_web(query, num_results=10)
        except Exception as exc:
            logger.warning("Exa lead search failed for %r: %s", query, exc)
            continue
        for item in results:
            url = item.get("url") or ""
            title = item.get("title") or ""
            text = item.get("text") or ""
            lowered = url.lower()
            if "linkedin.com/in/" in lowered:
                snippet_fields = parse_person_snippet(title, text)
                candidates.append(
                    {
                        "name": _safe_name_from_title(title),
                        "lead_type": "person",
                        "linkedin_url": url.split("?")[0],
                        "title": snippet_fields.get("title"),
                        "company": snippet_fields.get("company"),
                        "location": snippet_fields.get("location"),
                        "description": text[:500] or None,
                        "source": "exa",
                        "sources": ["exa"],
                    }
                )
            elif "linkedin.com/company/" in lowered:
                snippet_fields = parse_company_snippet(title, text)
                candidates.append(
                    {
                        "name": _safe_name_from_title(title),
                        "lead_type": "company",
                        "linkedin_url": url.split("?")[0],
                        "location": snippet_fields.get("location") or None,
                        "industry": snippet_fields.get("industry") or None,
                        "description": text[:500] or None,
                        "source": "exa",
                        "sources": ["exa"],
                    }
                )
            elif title:
                snippet_fields = parse_company_snippet(title, text)
                candidates.append(
                    {
                        "name": _safe_name_from_title(title),
                        "lead_type": "company",
                        "website": url,
                        "location": snippet_fields.get("location") or None,
                        "industry": snippet_fields.get("industry") or None,
                        "description": text[:500] or None,
                        "source": "exa",
                        "sources": ["exa"],
                    }
                )
    emit({"phase": "searching", "source": "exa", "detail": f"{len(candidates)} hits"})
    return candidates


async def _search_web(
    req: LeadSearchRequest, emit: LeadEmit | None = None
) -> list[dict[str, Any]]:
    """DuckDuckGo text search — free fallback for agencies and company sites."""
    try:
        from ddgs import DDGS
    except Exception as exc:
        logger.debug("ddgs unavailable: %s", exc)
        return []

    location = _location_str(req) or ""
    emit = emit or (lambda _e: None)
    queries: list[str] = []
    if _company_shaped(req):
        queries.append(f"{req.keywords} agency {location}".strip())
        queries.append(f"{req.keywords} company {location}".strip())
    if _person_shaped(req):
        queries.append(f"{req.keywords} founder OR CEO OR head {location}".strip())

    emit({"phase": "searching", "source": "web", "detail": f"{len(queries)} queries"})
    candidates: list[dict[str, Any]] = []

    def _run(query: str) -> list[dict[str, Any]]:
        ddgs = DDGS()
        return list(ddgs.text(query, max_results=8))

    for query in queries[:3]:
        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, _run, query)
        except Exception as exc:
            logger.warning("DDGS lead search failed for %r: %s", query, exc)
            continue
        for item in results:
            url = item.get("href") or ""
            title = item.get("title") or ""
            body = item.get("body") or ""
            if not url or not title:
                continue
            lowered = url.lower()
            if "linkedin.com/in/" in lowered:
                snippet_fields = parse_person_snippet(title, body)
                candidates.append(
                    {
                        "name": _safe_name_from_title(title),
                        "lead_type": "person",
                        "linkedin_url": url.split("?")[0],
                        "title": snippet_fields.get("title"),
                        "company": snippet_fields.get("company"),
                        "location": snippet_fields.get("location"),
                        "description": body[:500] or None,
                        "source": "web",
                        "sources": ["web"],
                    }
                )
            elif "linkedin.com/company/" in lowered:
                snippet_fields = parse_company_snippet(title, body)
                candidates.append(
                    {
                        "name": _safe_name_from_title(title),
                        "lead_type": "company",
                        "linkedin_url": url.split("?")[0],
                        "location": snippet_fields.get("location") or None,
                        "industry": snippet_fields.get("industry") or None,
                        "description": body[:500] or None,
                        "source": "web",
                        "sources": ["web"],
                    }
                )
            else:
                snippet_fields = parse_company_snippet(title, body)
                candidates.append(
                    {
                        "name": _safe_name_from_title(title),
                        "lead_type": "company",
                        "website": url,
                        "location": snippet_fields.get("location") or None,
                        "industry": snippet_fields.get("industry") or None,
                        "description": body[:500] or None,
                        "source": "web",
                        "sources": ["web"],
                    }
                )
    emit({"phase": "searching", "source": "web", "detail": f"{len(candidates)} hits"})
    return candidates


# -- Orchestration -------------------------------------------------------------


async def _persist(
    candidates: list[dict[str, Any]],
    search_id: str,
    emit: LeadEmit | None = None,
    purpose: str | None = None,
) -> tuple[list[dict[str, Any]], DedupStats]:
    """Categorize → dedupe (seeded with DB) → insert new / backfill existing."""
    emit = emit or (lambda _e: None)
    emit({"phase": "categorize", "detail": f"{len(candidates)} candidates"})
    records, unsure = apply_heuristics(candidates)
    if unsure:
        classifications = await _ai_classify_unsure(unsure, purpose=purpose)
        if classifications:
            apply_ai_classification(records, classifications)

    emit({"phase": "dedupe"})
    existing = await db.list_leads()
    deduper = LeadDeduper(existing=existing)
    final, raw_stats = deduper.dedupe(records)

    new_inserted = 0
    already_in_db = deduper.already_in_db_ids
    stored: list[dict[str, Any]] = []
    capped = final[:200]
    for record in capped:
        fields = {
            "search_id": search_id,
            "lead_type": record.get("lead_type") or "person",
            "name": record.get("name"),
            "title": record.get("title"),
            "company": record.get("company"),
            "email": record.get("email"),
            "phone": record.get("phone"),
            "linkedin_url": record.get("linkedin_url"),
            "website": record.get("website"),
            "location": record.get("location"),
            "industry": record.get("industry"),
            "company_size": record.get("company_size"),
            "description": record.get("description"),
            "source": record.get("source") or "web",
            "sources": record.get("sources")
            or ([record["source"]] if record.get("source") else []),
            "suggested_type": record.get("suggested_type") or "unsure",
            "category_source": record.get("category_source") or "heuristic",
            "category_confidence": record.get("category_confidence") or 0.0,
        }
        # Records matched against DB rows carry that row's lead_id — the
        # facade's backfill path handles them without counting as inserts.
        lead, created = await db.create_lead(**fields)
        if created:
            new_inserted += 1
        stored.append(lead)

    stats = DedupStats(
        raw=raw_stats.get("raw", 0),
        after_exact=raw_stats.get("after_exact", 0),
        after_fuzzy=raw_stats.get("after_fuzzy", 0),
        merged=raw_stats.get("merged", 0),
        already_in_db=max(raw_stats.get("already_in_db", 0), len(already_in_db)),
        new_inserted=new_inserted,
    )
    emit({"phase": "persisted", "detail": f"{new_inserted} new"})
    return stored, stats


async def _resolve_company_website(company: str) -> str | None:
    """One cheap Exa query for a company's official website."""
    from app.services.mcp.exa import ExaAdapter

    adapter = ExaAdapter()
    if not await adapter.is_available():
        return None
    try:
        results = await adapter.search_web(f"{company} official website", num_results=3)
    except Exception as exc:
        logger.debug("Company website lookup failed for %r: %s", company, exc)
        return None
    for item in results:
        url = item.get("url") or ""
        lowered = url.lower()
        if not url or any(
            skip in lowered
            for skip in ("linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com")
        ):
            continue
        return url.split("?")[0]
    return None


def _scrape_contacts_from_text(lead: dict[str, Any]) -> None:
    """Pull email/phone out of the lead's own description text (no network)."""
    from app.services.contact_enrichment import extract_emails, extract_phones

    text = lead.get("description") or ""
    if not text:
        return
    if not lead.get("email"):
        emails = extract_emails(text)
        personal = [
            e
            for e in emails
            if e.split("@", 1)[0]
            not in {
                "info", "hello", "hi", "contact", "support", "sales", "office",
                "admin", "team", "mail", "noreply", "no-reply", "press", "jobs",
                "careers", "hr",
            }
        ]
        if personal:
            lead["email"] = personal[0]
        elif emails:
            lead["email"] = emails[0]
    if not lead.get("phone"):
        phones = extract_phones(text)
        if phones:
            lead["phone"] = phones[0]


async def _enrich_leads(
    leads: list[dict[str, Any]], cap: int = MAX_ENRICH_PER_SEARCH, emit: LeadEmit | None = None
) -> None:
    """Best-effort email/phone for leads missing contact info.

    Order of attempts (cheapest first):
    1. Emails/phones already present in the stored description snippet.
    2. Crawl the lead's own website (companies, open-web hits).
    3. For persons without a website: resolve the company's official site
       via one Exa query, then crawl it (also enables the first.last@domain
       pattern guess from the person's name).
    """
    from app.services.contact_enrichment import enrich_from_website

    emit = emit or (lambda _e: None)

    # 1. Free pass: text already on the record.
    for lead in leads:
        _scrape_contacts_from_text(lead)

    # 2 + 3. Network enrichment, capped.
    tasks: list[tuple[dict[str, Any], Any]] = []
    for lead in leads:
        if len(tasks) >= cap:
            break
        if lead.get("email") and lead.get("phone"):
            continue
        website = lead.get("website")
        if not website and lead.get("lead_type") == "person" and lead.get("company"):
            website = await _resolve_company_website(lead["company"])
            if website:
                lead["website"] = website
        if not website:
            continue
        tasks.append((lead, enrich_from_website(website, lead.get("name"))))
    if not tasks:
        # Persist any text-scraped contacts before bailing.
        await _persist_enrichment(leads)
        return

    emit({"phase": "enrich", "done": 0, "total": len(tasks)})
    finished = 0

    async def _run_one(website: str | None, coro: Any) -> Any:
        nonlocal finished
        try:
            return await coro
        finally:
            finished += 1
            emit(
                {
                    "phase": "enrich",
                    "done": finished,
                    "total": len(tasks),
                    "detail": website,
                }
            )

    results = await asyncio.gather(
        *(_run_one(lead.get("website"), coro) for lead, coro in tasks),
        return_exceptions=True,
    )
    for (lead, _), result in zip(tasks, results):
        if isinstance(result, Exception) or not isinstance(result, dict):
            continue
        if result.get("email") and not lead.get("email"):
            lead["email"] = result["email"]
        if result.get("phone") and not lead.get("phone"):
            lead["phone"] = result["phone"]
    await _persist_enrichment(leads)


async def _persist_enrichment(leads: list[dict[str, Any]]) -> None:
    """Write any newly found email/phone/website back to the DB."""
    for lead in leads:
        updates: dict[str, Any] = {}
        for field in ("email", "phone", "website"):
            if lead.get(field):
                updates[field] = lead[field]
        if not updates or not lead.get("lead_id"):
            continue
        try:
            await db.update_lead(lead["lead_id"], updates)
        except Exception as exc:
            logger.debug("Failed to persist enrichment for %s: %s", lead.get("lead_id"), exc)


def _to_lead_out(row: dict[str, Any]) -> LeadOut:
    data = dict(row)
    data.setdefault("sources", [row.get("source")] if row.get("source") else [])
    return LeadOut(**data)


async def search_leads(
    req: LeadSearchRequest, emit: LeadEmit | None = None
) -> LeadSearchResponse:
    """Run a full multi-source lead search with categorization and dedup."""
    emit = emit or (lambda _e: None)
    search_id = _make_search_id(req)
    enabled_sources = [s.lower() for s in req.sources] if req.sources else ["linkedin", "exa", "web"]

    # Refine keywords with the target/purpose context before hitting sources.
    effective_req = req
    if req.target or req.purpose:
        emit({"phase": "searching", "detail": "planning queries"})
        refined = await build_search_query(req)
        if refined and refined.strip() and refined != req.keywords:
            effective_req = req.model_copy(update={"keywords": refined.strip()})

    tasks: list[tuple[str, Any]] = []
    if "linkedin" in enabled_sources:
        tasks.append(("linkedin", _search_linkedin(effective_req, emit)))
    if "exa" in enabled_sources:
        tasks.append(("exa", _search_exa(effective_req, emit)))
    if "web" in enabled_sources:
        tasks.append(("web", _search_web(effective_req, emit)))

    emit({"phase": "searching", "detail": f"{len(tasks)} sources"})
    gathered = await asyncio.gather(
        *(coro for _, coro in tasks), return_exceptions=True
    )
    candidates: list[dict[str, Any]] = []
    mcp_status: dict[str, dict] = {}
    for (name, _), result in zip(tasks, gathered):
        if isinstance(result, Exception):
            logger.error("Lead source %s failed: %s", name, result)
            mcp_status[name] = {"available": False, "details": str(result)}
            continue
        if name == "linkedin":
            found, status = result
            mcp_status[name] = status
            candidates.extend(found)
        else:
            mcp_status[name] = {"available": True, "details": f"{len(result)} raw hits"}
            candidates.extend(result)

    # Strict location gate — sources only get location as a hint, so enforce
    # it here on every candidate's known location.
    if req.locations:
        total_found = len(candidates)
        candidates = filter_by_location(candidates, req.locations)
        emit(
            {
                "phase": "filtering",
                "done": len(candidates),
                "total": total_found,
                "detail": f"{len(candidates)} of {total_found} match the location filter",
            }
        )

    stored, stats = await _persist(candidates, search_id, emit, purpose=req.purpose)

    if req.enrich_contacts:
        try:
            await _enrich_leads(stored, emit=emit)
        except Exception as exc:
            logger.warning("Contact enrichment step failed: %s", exc)

    # Re-read enriched rows for the response.
    fresh: list[LeadOut] = []
    for row in stored:
        current = await db.get_lead(row["lead_id"])
        fresh.append(_to_lead_out(current or row))

    return LeadSearchResponse(
        search_id=search_id,
        leads=fresh,
        dedup_stats=stats,
        mcp_status=mcp_status,
    )


async def save_lead(
    lead_id: str, req: LeadSaveRequest
) -> tuple[dict[str, Any] | None, str | None]:
    """Save one lead as a contact or company; returns (lead, error)."""
    lead = await db.get_lead(lead_id)
    if lead is None:
        return None, "Lead not found"

    if req.target == "contact":
        contact = await db.create_contact(
            name=lead["name"],
            email=lead.get("email"),
            company=lead.get("company"),
            location=lead.get("location"),
            status="to_contact",
            description=lead.get("description"),
            linkedin_url=lead.get("linkedin_url"),
            website_url=lead.get("website"),
        )
        company_id = lead.get("company_id")
        if req.create_linked_company and lead.get("company") and not company_id:
            company = await db.create_company(
                name=lead["company"],
                website=lead.get("website"),
                linkedin_url=None,
                industry=lead.get("industry"),
                company_size=lead.get("company_size"),
                status="watching",
            )
            company_id = company.get("company_id")
        updated = await db.update_lead(
            lead_id,
            {
                "status": "saved",
                "contact_id": contact.get("contact_id"),
                "company_id": company_id,
            },
        )
        return updated or lead, None

    company = await db.create_company(
        name=lead["name"],
        email=lead.get("email"),
        phone=lead.get("phone"),
        website=lead.get("website"),
        linkedin_url=lead.get("linkedin_url"),
        industry=lead.get("industry"),
        company_size=lead.get("company_size"),
        company_type="agency" if lead.get("suggested_type") == "agency" else None,
        description=lead.get("description"),
        status="watching",
    )
    updated = await db.update_lead(
        lead_id, {"status": "saved", "company_id": company.get("company_id")}
    )
    return updated or lead, None


async def save_leads_bulk(
    lead_ids: list[str], req: LeadSaveRequest
) -> tuple[int, list[str]]:
    """Bulk save; returns (affected, per-lead error details)."""
    affected = 0
    details: list[str] = []
    for lead_id in lead_ids:
        lead, error = await save_lead(lead_id, req)
        if error:
            details.append(f"{lead_id}: {error}")
        else:
            affected += 1
    return affected, details


def new_search_id() -> str:
    """Random search id for manual imports (not criteria-derived)."""
    return uuid4().hex[:16]
