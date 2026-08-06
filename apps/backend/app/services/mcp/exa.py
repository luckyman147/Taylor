"""Exa search adapter — calls Exa API directly via httpx."""

from __future__ import annotations

import json
import logging
import uuid

import httpx

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

EXA_API_KEY = "68170c2c-82b3-410c-92bc-f5fc35aa32d8"
EXA_SEARCH_URL = "https://api.exa.ai/search"


class ExaAdapter(BaseMCPAdapter):
    """Adapter for Exa semantic web search via API."""

    name = "exa"
    description = "Exa Web Search (via API)"
    timeout = 30.0

    async def is_available(self) -> bool:
        """Check if Exa API key is configured."""
        return bool(EXA_API_KEY)

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search jobs via Exa web search API."""
        try:
            query = f"software engineer jobs {keywords}"
            if filters.locations and filters.locations[0].value != "global":
                loc_names = {
                    "uae": "Dubai UAE",
                    "saudi_arabia": "Saudi Arabia",
                    "qatar": "Qatar",
                    "egypt": "Egypt",
                    "remote": "Remote",
                    "bahrain": "Bahrain",
                    "oman": "Oman",
                    "kuwait": "Kuwait",
                    "jordan": "Jordan",
                    "us": "USA",
                    "uk": "United Kingdom",
                    "canada": "Canada",
                    "germany": "Germany",
                    "france": "France",
                    "netherlands": "Netherlands",
                    "india": "India",
                    "turkey": "Turkey",
                    "australia": "Australia",
                    "singapore": "Singapore",
                    "tunisia": "Tunisia",
                }
                loc = loc_names.get(filters.locations[0].value, "")
                if loc:
                    query += f" {loc}"

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
            for item in results:
                highlights = item.get("highlights", [])
                description = " ".join(highlights) if highlights else item.get("text", "")
                jobs.append(
                    JobListing(
                        id=str(uuid.uuid4()),
                        title=item.get("title", "Unknown"),
                        company=item.get("author", "") or "",
                        location="",
                        url=item.get("url", ""),
                        source="exa",
                        description=description[:1000],
                        relevance_score=0.6,
                        remote=True,
                        posted_date=item.get("publishedDate"),
                    )
                )

            logger.info("Exa: found %d results", len(jobs))
            return jobs
        except Exception as exc:
            logger.error("Exa search failed: %s", exc)
            return []
