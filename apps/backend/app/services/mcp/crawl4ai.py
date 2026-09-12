"""Crawl4AI adapter — fetches web pages and returns clean Markdown."""

from __future__ import annotations

import logging
from typing import Any

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

# Maximum characters to return per page to avoid overwhelming the LLM context.
_MAX_PAGE_CHARS = 4000


class Crawl4AIAdapter(BaseMCPAdapter):
    """Adapter for crawling web pages using crawl4ai."""

    name = "crawl4ai"
    description = "Crawl4AI (Web Crawler)"
    timeout = 30.0

    async def is_available(self) -> bool:
        try:
            import crawl4ai  # noqa: F401

            return True
        except ImportError:
            return False

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Crawl4AI is a page fetcher, not a search engine."""
        return []

    async def fetch_page(self, url: str) -> str:
        """Fetch a single page and return clean Markdown content."""
        try:
            from crawl4ai import AsyncWebCrawler
            from crawl4ai.async_crawler_strategy import AsyncHTTPCrawlerStrategy

            strategy = AsyncHTTPCrawlerStrategy()
            async with AsyncWebCrawler(crawler_strategy=strategy) as crawler:
                result = await crawler.arun(url=url)
                if result.success and result.markdown:
                    md = result.markdown
                    if isinstance(md, dict):
                        md = md.get("fit_markdown") or md.get("raw_markdown") or ""
                    return str(md)[:_MAX_PAGE_CHARS]
        except Exception as exc:
            logger.warning("crawl4ai failed for %s: %s", url, exc)
        return ""

    async def fetch_pages(self, urls: list[str]) -> dict[str, str]:
        """Fetch multiple pages in parallel and return {url: markdown}."""
        if not urls:
            return {}
        try:
            from crawl4ai import AsyncWebCrawler
            from crawl4ai.async_crawler_strategy import AsyncHTTPCrawlerStrategy

            strategy = AsyncHTTPCrawlerStrategy()
            results: dict[str, str] = {}
            async with AsyncWebCrawler(crawler_strategy=strategy) as crawler:
                crawl_results = await crawler.arun_many(urls)
                for r in crawl_results:
                    if r.success and r.markdown:
                        md = r.markdown
                        if isinstance(md, dict):
                            md = md.get("fit_markdown") or md.get("raw_markdown") or ""
                        results[r.url] = str(md)[:_MAX_PAGE_CHARS]
            return results
        except Exception as exc:
            logger.warning("crawl4ai arun_many failed: %s", exc)
            return {}
