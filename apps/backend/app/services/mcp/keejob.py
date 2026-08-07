"""Keejob adapter — scrapes job listings from keejob.com (Tunisia)."""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from app.schemas.job_scraper import JobListing, JobSearchFilters, JobType
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

BASE_URL = "https://www.keejob.com"
LISTINGS_PATH = "/offres-emploi/"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
COUNTRY_TUNISIA = "788"

DEFAULT_MAX_PAGES = 2
PAGE_REQUEST_DELAY = 0.3

# JobType -> keejob contract-type ids (checkbox values on the listing form)
JOBTYPE_TO_KEEJOB: dict[str, list[int]] = {
    JobType.FULL_TIME.value: [1],  # CDI
    JobType.CONTRACT.value: [2],  # CDD
    JobType.INTERNSHIP.value: [7],  # Stage/PFE
    JobType.FREELANCE.value: [5],  # Indépendant/Freelance
    JobType.TEMPORARY.value: [6],  # Intérim
}

# Listing contract tag text -> JobType value
TAG_TO_JOBTYPE: dict[str, str] = {
    "cdi": "full_time",
    "cdd": "contract",
    "stage/pfe": "internship",
    "stage": "internship",
    "pfe": "internship",
    "indépendant/freelance": "freelance",
    "indépendant": "freelance",
    "freelance": "freelance",
    "intérim": "temporary",
    "intrim": "temporary",
    "sivp": "other",
    "saisonnier": "other",
    "fonction publique": "other",
}

FRENCH_MONTHS: dict[str, int] = {
    "janvier": 1,
    "février": 2,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "août": 8,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "décembre": 12,
    "decembre": 12,
}

REMOTE_HINTS = ("à distance", "a distance", "télétravail", "teletravail", "remote", "home office", "full remote")


def _clean(text: str) -> str:
    """Collapse whitespace/newlines into single spaces."""
    return " ".join(text.split())


def _parse_posted_date(raw: str | None) -> str | None:
    """Parse keejob's French date text into an ISO date string."""
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None
    lowered = text.lower()
    now = datetime.now(timezone.utc)
    if lowered in ("aujourd'hui", "aujourd hui", "today"):
        return now.date().isoformat()
    if lowered in ("hier", "yesterday"):
        return (now.date() - timedelta(days=1)).isoformat()

    match = re.match(r"^(\d{1,2})\s+([a-zàâäéèêëîïôöùûüç]+)\s+(\d{4})", lowered)
    if not match:
        return None
    day, month_name, year = int(match.group(1)), match.group(2), int(match.group(3))
    month = FRENCH_MONTHS.get(month_name)
    if not month:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


class KeejobAdapter(BaseMCPAdapter):
    """Adapter for keejob.com (Tunisian job listings)."""

    name = "keejob"
    description = "Keejob (Tunisia)"
    timeout = 20.0

    async def is_available(self) -> bool:
        """Check the listing page responds with job cards."""
        try:
            async with httpx.AsyncClient(
                timeout=8.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}
            ) as client:
                resp = await client.get(BASE_URL + LISTINGS_PATH)
                return resp.status_code == 200 and "<article" in resp.text
        except Exception:
            return False

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search Keejob listings for the given keywords."""
        try:
            params: dict[str, str | list[str]] = {
                "keywords": keywords,
                "country": COUNTRY_TUNISIA,
            }
            job_type_ids = self._job_type_ids(filters)
            if job_type_ids:
                # Repeated param -> how Django's form parses a multi-select.
                params["job_types"] = job_type_ids

            pages = max(1, min(filters.max_pages or 0, DEFAULT_MAX_PAGES))

            all_jobs: list[JobListing] = []
            seen_urls: set[str] = set()

            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                for page in range(1, pages + 1):
                    if page > 1:
                        await asyncio.sleep(PAGE_REQUEST_DELAY)
                    page_params = dict(params)
                    if page > 1:
                        page_params["page"] = str(page)
                    html = await self._fetch_page(client, page_params)
                    if not html:
                        continue
                    for job in self._parse_listing_html(html):
                        if job.url not in seen_urls:
                            seen_urls.add(job.url)
                            all_jobs.append(job)

            logger.info("Keejob: found %d jobs across %d page(s)", len(all_jobs), pages)
            return all_jobs
        except Exception as exc:
            logger.error("Keejob search failed: %s", exc)
            return []

    async def _fetch_page(
        self, client: httpx.AsyncClient, params: dict[str, str | list[str]]
    ) -> str:
        """Fetch a single listing page; returns HTML string or empty on failure."""
        try:
            resp = await client.get(BASE_URL + LISTINGS_PATH, params=params)
            if resp.status_code != 200:
                logger.warning("Keejob listing returned %d", resp.status_code)
                return ""
            return resp.text
        except Exception as exc:
            logger.warning("Keejob listing page request failed: %s", exc)
            return ""

    def _parse_listing_html(self, html: str) -> list[JobListing]:
        """Parse job cards from a listing page into JobListing objects."""
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[JobListing] = []

        for article in soup.select("article"):
            title_anchor = article.select_one("h2 a")
            if not title_anchor:
                continue
            href = title_anchor.get("href", "")
            if not href or "/offres-emploi/" not in href:
                continue

            title = _clean(title_anchor.get_text(" "))
            company_span = article.select_one("p.mb-2 span")
            company = _clean(company_span.get_text(" ")) if company_span else ""

            description_el = article.select_one("div.mb-3 p")
            description = (
                _clean(description_el.get_text(" ")) if description_el else None
            )

            location = ""
            posted = ""
            for icon in article.select("i.fa-map-marker-alt"):
                loc_span = icon.find_next_sibling("span")
                if loc_span:
                    location = _clean(loc_span.get_text(" "))
                    break
            for icon in article.select("i.fa-clock"):
                date_span = icon.find_next_sibling("span")
                if date_span:
                    posted = _clean(date_span.get_text(" "))
                    break

            salary = ""
            for icon in article.select("i.fa-money-bill-wave"):
                tag_span = icon.parent
                if tag_span:
                    salary = _clean(tag_span.get_text(" "))
                break

            job_type: str | None = None
            for icon in article.select("i.fa-briefcase"):
                tag_span = icon.parent
                if not tag_span:
                    continue
                tag = _clean(tag_span.get_text(" ")).lower()
                mapped = TAG_TO_JOBTYPE.get(tag)
                if mapped:
                    job_type = mapped
                    break

            url = urljoin(BASE_URL, href)
            text_for_remote = f"{title} {description} {location}".lower()
            remote = any(kw in text_for_remote for kw in REMOTE_HINTS)

            jobs.append(
                JobListing(
                    id=str(uuid.uuid5(uuid.NAMESPACE_URL, url)),
                    title=title,
                    company=company,
                    location=location,
                    url=url,
                    source="keejob",
                    posted_date=_parse_posted_date(posted),
                    description=description[:1500] or None,
                    relevance_score=0.5,
                    remote=remote,
                    job_type=job_type,
                    salary=salary or None,
                )
            )

        return jobs

    @staticmethod
    def _job_type_ids(filters: JobSearchFilters) -> list[str]:
        """Map JobType filters to keejob contract-type ids."""
        ids: list[str] = []
        for jt in filters.job_types:
            mapped = JOBTYPE_TO_KEEJOB.get(jt.value)
            if mapped:
                ids.extend(str(i) for i in mapped)
        # Dedupe preserving order
        return list(dict.fromkeys(ids))