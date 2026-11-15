"""OpenStreetMap company discovery service.

Uses Nominatim for geocoding and Overpass API for querying companies
by office/business tags within an administrative area.

No API key required; respects OSM usage policies (Nominatim: 1 req/s,
Overpass: 25s timeout, fair use). Caches results via llm_cache.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.llm_cache import get_or_compute, make_key

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

USER_AGENT = "ResumeMatcher/1.0 (contact: iyed@example.com)"

OFFICE_TAGS_REGEX = (
    r"^(company|it|nonprofit|educational|government|ngo|association|"
    r"foundation|research|startup|consulting|technology|software|"
    r"telecommunication|financial|insurance|legal|accountancy|"
    r"architect|engineering|advertising|marketing|design|media|"
    r"publisher|newspaper|radio|television|film|production|studio|"
    r"agency|employment_agency|recruitment|security|cleaning|"
    r"logistics|transportation|real_estate|property|coworking_space)$"
)

OVERPASS_QUERY_TEMPLATE = """
[out:json][timeout:25];
area["boundary"="administrative"]["name"="{area_name}"]->.a;
(
  nwr["office"~"{office_regex}"](area.a);
  nwr["office"="company"]["company"](area.a);
);
out center tags;
"""

CITY_ALIASES = {
    "tunis": "Tunis",
    "tunisia": "Tunis",
    "sfax": "Sfax",
    "sousse": "Sousse",
    "bizerte": "Bizerte",
    "gabes": "Gabès",
    "kairouan": "Kairouan",
    "paris": "Paris",
    "lyon": "Lyon",
    "marseille": "Marseille",
    "london": "London",
    "berlin": "Berlin",
    "madrid": "Madrid",
    "rome": "Rome",
    "amsterdam": "Amsterdam",
    "barcelona": "Barcelona",
    "dubai": "Dubai",
    "riyadh": "Riyadh",
    "doha": "Doha",
    "cairo": "Cairo",
    "new york": "New York",
    "san francisco": "San Francisco",
    "los angeles": "Los Angeles",
    "toronto": "Toronto",
    "montreal": "Montreal",
    "vancouver": "Vancouver",
    "singapore": "Singapore",
    "tokyo": "Tokyo",
    "sydney": "Sydney",
    "melbourne": "Melbourne",
}


async def geocode_area(location: str) -> dict[str, Any] | None:
    """Geocode a location string to an OSM area via Nominatim.

    Returns a dict with 'place_id', 'lat', 'lon', 'display_name', 'boundingbox'.
    Cached for 24 hours via llm_cache.
    """
    key = make_key("osm_geocode", location.lower().strip())
    return await get_or_compute(key, lambda: _geocode_area_uncached(location), ttl=86400.0)


async def _geocode_area_uncached(location: str) -> dict[str, Any] | None:
    norm_loc = CITY_ALIASES.get(location.lower().strip(), location)
    params = {
        "format": "json",
        "limit": 1,
        "q": norm_loc,
        "addressdetails": 1,
        "extratags": 1,
    }
    headers = {"User-Agent": USER_AGENT}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(NOMINATIM_URL, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if not data:
                logger.warning("Nominatim: no results for %s", location)
                return None
            result = data[0]
            logger.info("Nominatim: geocoded %s -> %s", location, result.get("display_name"))
            return result
    except Exception as exc:
        logger.error("Nominatim geocode failed for %s: %s", location, exc)
        return None


async def fetch_companies_in_area(
    area_name: str,
    keywords: list[str] | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Fetch companies from Overpass within an administrative area.

    Returns a list of candidate companies with normalized fields.
    Cached for 6 hours via llm_cache.
    """
    cache_key = make_key("osm_companies", area_name.lower().strip(), tuple(keywords or []), limit)
    return await get_or_compute(cache_key, lambda: _fetch_companies_uncached(area_name, keywords, limit), ttl=21600.0)


async def _fetch_companies_uncached(
    area_name: str,
    keywords: list[str] | None,
    limit: int,
) -> list[dict[str, Any]]:
    query = OVERPASS_QUERY_TEMPLATE.format(area_name=area_name, office_regex=OFFICE_TAGS_REGEX)
    headers = {"User-Agent": USER_AGENT}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(OVERPASS_URL, data=query, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.error("Overpass query failed for %s: %s", area_name, exc)
        return []

    elements = data.get("elements", [])
    candidates: list[dict[str, Any]] = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue

        website = tags.get("website") or tags.get("contact:website") or tags.get("url")
        phone = tags.get("phone") or tags.get("contact:phone")
        email = tags.get("email") or tags.get("contact:email")
        address_parts = []
        for key in ("addr:street", "addr:housenumber", "addr:city", "addr:postcode"):
            if tags.get(key):
                address_parts.append(tags[key])
        address = ", ".join(address_parts) if address_parts else None
        city = tags.get("addr:city") or tags.get("city")
        country = tags.get("addr:country") or tags.get("country")
        office_type = tags.get("office")
        company_type = tags.get("company")
        industrial = tags.get("industrial")
        craft = tags.get("craft")
        shop = tags.get("shop")

        industry_parts = [v for v in (office_type, company_type, industrial, craft, shop) if v]
        industry = ", ".join(industry_parts) if industry_parts else None

        center = el.get("center") or {}
        lat = center.get("lat") or el.get("lat")
        lon = center.get("lon") or el.get("lon")

        candidate = {
            "name": name.strip(),
            "website": website.strip() if website else None,
            "phone": phone.strip() if phone else None,
            "email": email.strip() if email else None,
            "address": address,
            "city": city,
            "country": country,
            "industry": industry,
            "office_type": office_type,
            "lat": lat,
            "lon": lon,
            "source": "openstreetmap",
        }
        candidates.append(candidate)

    if keywords:
        kw_lower = [k.lower() for k in keywords]
        filtered = []
        for c in candidates:
            name_lower = c["name"].lower()
            industry_lower = (c["industry"] or "").lower()
            if any(kw in name_lower or kw in industry_lower for kw in kw_lower):
                filtered.append(c)
        candidates = filtered

    candidates.sort(key=lambda c: (c["industry"] is None, c["name"]))
    return candidates[:limit]


def extract_keywords_from_profile(profile: dict[str, Any] | None, skills: list[dict[str, Any]]) -> list[str]:
    """Extract searchable keywords from profile and skills."""
    keywords: list[str] = []
    if profile:
        for role in profile.get("target_roles", []):
            if isinstance(role, str) and role.strip():
                keywords.append(role.strip())
        for skill in skills:
            name = skill.get("name")
            if isinstance(name, str) and name.strip():
                keywords.append(name.strip())
    return keywords[:15]