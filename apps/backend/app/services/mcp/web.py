"""Web adapter — uses Jina Reader to fetch job pages."""

from __future__ import annotations

import logging
import uuid

import httpx

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

JINA_BASE = "https://r.jina.ai/"


class WebAdapter(BaseMCPAdapter):
    """Adapter for reading web pages via Jina Reader."""

    name = "web"
    description = "Jina Reader (Web Pages)"
    timeout = 10.0

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{JINA_BASE}https://example.com",
                    timeout=5.0,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                return resp.status_code == 200
        except Exception:
            return False

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Jina Reader is used for fetching individual pages, not searching."""
        return []

    async def fetch_page(self, url: str) -> str:
        """Fetch a single page content via Jina Reader."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{JINA_BASE}{url}",
                    timeout=self.timeout,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code == 200:
                    return resp.text
        except Exception as exc:
            logger.error("Jina Reader failed for %s: %s", url, exc)
        return ""
