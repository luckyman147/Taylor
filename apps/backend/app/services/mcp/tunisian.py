"""Tunisian Freelance adapter — searches Tunisian freelance job sites via Exa + Jina Reader."""

from __future__ import annotations

import asyncio
import logging
import re
import uuid

import httpx

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

EXA_API_KEY = "68170c2c-82b3-410c-92bc-f5fc35aa32d8"
EXA_SEARCH_URL = "https://api.exa.ai/search"
JINA_BASE = "https://r.jina.ai/"

# Tunisian freelance sites to search
TUNISIAN_SITES = [
    "freelances.tn",
    "tunisiefreelance.tn",
]


class TunisianFreelanceAdapter(BaseMCPAdapter):
    """Adapter for Tunisian freelance job sites via Exa search + Jina Reader."""

    name = "tunisian"
    description = "Tunisian Freelance (Freelances.tn, Tunisie Freelance)"
    timeout = 30.0

    async def is_available(self) -> bool:
        """Check if Exa API key is configured."""
        return bool(EXA_API_KEY)

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search Tunisian freelance sites via Exa + Jina Reader."""
        tasks = [self._search_site(site, keywords) for site in TUNISIAN_SITES]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_jobs: list[JobListing] = []
        seen_urls: set[str] = set()

        for result in results:
            if isinstance(result, list):
                for job in result:
                    if job.url not in seen_urls:
                        seen_urls.add(job.url)
                        all_jobs.append(job)

        logger.info("Tunisian Freelance: found %d jobs total", len(all_jobs))
        return all_jobs

    async def _search_site(self, site: str, keywords: str) -> list[JobListing]:
        """Search a single Tunisian freelance site via Exa."""
        try:
            query = f"freelance jobs site:{site} {keywords}"
            payload = {
                "query": query,
                "type": "neural",
                "numResults": 10,
                "contents": {
                    "highlights": {"numSentences": 2, "highlightsPerUrl": 1},
                },
            }

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    EXA_SEARCH_URL,
                    json=payload,
                    headers={
                        "x-api-key": EXA_API_KEY,
                        "Content-Type": "application/json",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            results = data.get("results", [])
            jobs: list[JobListing] = []

            # Fetch page content in parallel for better descriptions
            fetch_tasks = []
            for item in results:
                url = item.get("url", "")
                if url:
                    fetch_tasks.append(self._fetch_page_content(url, item))
                else:
                    fetch_tasks.append(asyncio.coroutine(lambda: None)())

            fetched_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

            for item, fetched in zip(results, fetched_results):
                url = item.get("url", "")
                if not url:
                    continue

                title = item.get("title", "Unknown")
                highlights = item.get("highlights", [])
                description = " ".join(highlights) if highlights else item.get("text", "")

                # If we got page content, use it for better description
                if isinstance(fetched, dict) and fetched.get("content"):
                    page_content = fetched["content"]
                    parsed = self._parse_job_page(page_content)
                    if parsed.get("title"):
                        title = parsed["title"]
                    if parsed.get("description"):
                        description = parsed["description"]
                    if parsed.get("budget"):
                        description = f"Budget: {parsed['budget']}\n\n{description}"

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid4()),
                        title=title,
                        company="",
                        location="Tunisia",
                        url=url,
                        source="tunisian",
                        description=description[:1000],
                        relevance_score=0.6,
                        remote=True,
                        posted_date=item.get("publishedDate"),
                    )
                )

            logger.info("Tunisian site %s: found %d jobs", site, len(jobs))
            return jobs
        except Exception as exc:
            logger.error("Tunisian site %s failed: %s", site, exc)
            return []

    async def _fetch_page_content(self, url: str, item: dict) -> dict:
        """Fetch page content via Jina Reader for better job details."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{JINA_BASE}{url}",
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code == 200:
                    return {"content": resp.text, "item": item}
        except Exception as exc:
            logger.debug("Jina Reader failed for %s: %s", url, exc)
        return {}

    def _parse_job_page(self, content: str) -> dict:
        """Parse a job page to extract structured information."""
        result = {"title": "", "description": "", "budget": ""}

        lines = content.split("\n")

        # Try to find title (first heading or bold text)
        for line in lines[:20]:
            line = line.strip()
            if line.startswith("#"):
                result["title"] = line.lstrip("#").strip()
                break
            elif line.startswith("**") and line.endswith("**"):
                result["title"] = line.strip("*").strip()
                break

        # Try to find budget/TND information
        budget_patterns = [
            r"(?:Budget|Prix|Coût|TND|DT)\s*[:\-=]?\s*[\d.,]+",
            r"[\d.,]+\s*(?:TND|DT|dinars?)",
            r"(?:USD|EUR|\$|€)\s*[\d.,]+",
        ]
        for pattern in budget_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                result["budget"] = match.group(0).strip()
                break

        # Extract description (first meaningful paragraph)
        in_paragraph = False
        desc_lines = []
        for line in lines[20:50]:
            line = line.strip()
            if line and not line.startswith("#"):
                desc_lines.append(line)
                if len(desc_lines) >= 3:
                    break

        if desc_lines:
            result["description"] = " ".join(desc_lines)

        return result
