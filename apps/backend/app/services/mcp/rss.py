"""RSS adapter — fetches jobs from RSS feeds (WWR, Dice, Arbeitnow)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import httpx

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

# WWR category feeds - use the main feed for broadest coverage
WWR_FEEDS: dict[str, str] = {
    "all": "https://weworkremotely.com/remote-jobs.rss",
    "programming": "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "fullstack": "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
    "frontend": "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
    "backend": "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    "devops": "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    "design": "https://weworkremotely.com/categories/remote-design-jobs.rss",
}

# Keywords that map to specific WWR categories
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "fullstack": ["full stack", "fullstack", "full-stack"],
    "frontend": ["front end", "frontend", "front-end", "react", "vue", "angular", "ui", "ux"],
    "backend": ["back end", "backend", "back-end", "api", "server", "database", "python", "java", "go", "rust", "node"],
    "devops": ["devops", "sre", "infrastructure", "cloud", "aws", "azure", "gcp", "kubernetes", "docker"],
    "design": ["design", "figma", "sketch", "ui/ux", "product designer"],
}

# Tech skill keywords for relevance scoring
TECH_SKILLS = {
    "javascript", "typescript", "python", "java", "go", "golang", "rust", "c#", "c++",
    "react", "vue", "angular", "svelte", "nextjs", "next.js", "node", "nodejs",
    "fastapi", "django", "flask", "spring", "nestjs", "express",
    "docker", "kubernetes", "k8s", "aws", "azure", "gcp",
    "sql", "postgresql", "mysql", "mongodb", "redis",
    "git", "ci/cd", "terraform", "ansible",
    "html", "css", "tailwind", "sass",
    "graphql", "rest", "api",
}


class RSSAdapter(BaseMCPAdapter):
    """Adapter for RSS-based job feeds."""

    name = "rss"
    description = "RSS Feeds (WWR, Dice, Arbeitnow)"
    timeout = 10.0

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    WWR_FEEDS["all"],
                    timeout=5.0,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                return resp.status_code == 200
        except Exception:
            return False

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search all RSS feeds in parallel."""
        import asyncio

        # Determine which WWR feeds to fetch based on keywords
        feeds_to_fetch = self._select_wwr_feeds(keywords)

        tasks = []
        # Fetch WWR feeds
        for feed_name, feed_url in feeds_to_fetch.items():
            tasks.append(self._fetch_wwr_feed(feed_name, feed_url, keywords))

        # Fetch other feeds
        tasks.append(self._fetch_dice_feed(keywords))
        tasks.append(self._fetch_arbeitnow_feed(keywords))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        all_jobs: list[JobListing] = []
        seen_urls: set[str] = set()

        for result in results:
            if isinstance(result, list):
                for job in result:
                    # Dedupe by URL
                    if job.url not in seen_urls:
                        seen_urls.add(job.url)
                        all_jobs.append(job)

        return all_jobs

    def _select_wwr_feeds(self, keywords: str) -> dict[str, str]:
        """Select WWR feeds based on keywords."""
        keywords_lower = keywords.lower()
        selected: dict[str, str] = {}

        # Always include the main feed for broadest coverage
        selected["all"] = WWR_FEEDS["all"]

        # Add category-specific feeds based on keywords
        for category, trigger_words in CATEGORY_KEYWORDS.items():
            for word in trigger_words:
                if word in keywords_lower:
                    selected[category] = WWR_FEEDS[category]
                    break

        return selected

    async def _fetch_wwr_feed(
        self, feed_name: str, feed_url: str, keywords: str
    ) -> list[JobListing]:
        """Fetch and parse a WWR RSS feed."""
        try:
            import feedparser

            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    feed_url,
                    timeout=self.timeout,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code != 200:
                    logger.warning("WWR feed %s returned %d", feed_name, resp.status_code)
                    return []

            feed = feedparser.parse(resp.text)
            jobs: list[JobListing] = []
            keywords_lower = keywords.lower().split()
            # Filter out very short keywords (less than 2 chars)
            keywords_lower = [kw for kw in keywords_lower if len(kw) >= 2]

            for entry in feed.entries[:100]:
                title = entry.get("title", "")
                summary = entry.get("summary", entry.get("description", ""))
                link = entry.get("link", "")

                # Skip if no link
                if not link:
                    continue

                # Compute relevance score
                text = f"{title} {summary}".lower()
                relevance = self._compute_relevance(text, keywords_lower)

                # Skip jobs with very low relevance
                if relevance < 0.1:
                    continue

                # Parse posted date
                posted = None
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        posted = datetime(*entry.published_parsed[:6]).isoformat()
                    except (TypeError, ValueError):
                        pass

                # Detect remote (WWR is always remote)
                remote = True

                # Extract company
                company = self._extract_company(entry)

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, link)),
                        title=title,
                        company=company,
                        location="Remote",
                        url=link,
                        source="weworkremotely",
                        posted_date=posted,
                        description=summary[:1000],
                        relevance_score=min(relevance, 1.0),
                        remote=remote,
                    )
                )

            logger.info("WWR feed %s: found %d jobs", feed_name, len(jobs))
            return jobs
        except Exception as exc:
            logger.error("WWR feed %s failed: %s", feed_name, exc)
            return []

    def _compute_relevance(self, text: str, keywords: list[str]) -> float:
        """Compute relevance score based on keyword matches."""
        if not keywords:
            return 0.5  # Default score when no keywords

        score = 0.0
        matched_keywords = 0

        for kw in keywords:
            if kw in text:
                matched_keywords += 1
                # Boost score for exact keyword matches
                score += 0.2
                # Extra boost if keyword is a tech skill
                if kw in TECH_SKILLS:
                    score += 0.15

        # Bonus for matching multiple keywords
        if matched_keywords >= 2:
            score += 0.1

        # Title matches are worth more
        title_text = text[:200]  # Approximate title length
        for kw in keywords:
            if kw in title_text:
                score += 0.2

        return min(score, 1.0)

    async def _fetch_dice_feed(self, keywords: str) -> list[JobListing]:
        """Fetch Dice RSS feed."""
        try:
            import feedparser

            # Dice supports keyword search in the URL
            search_query = keywords.replace(" ", "+")
            feed_url = f"https://www.dice.com/rss?q={search_query}"

            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    feed_url,
                    timeout=self.timeout,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code != 200:
                    return []

            feed = feedparser.parse(resp.text)
            jobs: list[JobListing] = []
            keywords_lower = keywords.lower().split()
            keywords_lower = [kw for kw in keywords_lower if len(kw) >= 2]

            for entry in feed.entries[:50]:
                title = entry.get("title", "")
                summary = entry.get("summary", entry.get("description", ""))
                link = entry.get("link", "")

                if not link:
                    continue

                text = f"{title} {summary}".lower()
                relevance = self._compute_relevance(text, keywords_lower)

                if relevance < 0.1:
                    continue

                posted = None
                if hasattr(entry, "published_parsed") and entry.published_parsed:
                    try:
                        posted = datetime(*entry.published_parsed[:6]).isoformat()
                    except (TypeError, ValueError):
                        pass

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, link)),
                        title=title,
                        company=self._extract_company(entry),
                        location="",
                        url=link,
                        source="dice",
                        posted_date=posted,
                        description=summary[:1000],
                        relevance_score=min(relevance, 1.0),
                        remote="remote" in text,
                    )
                )

            return jobs
        except Exception as exc:
            logger.error("Dice feed failed: %s", exc)
            return []

    async def _fetch_arbeitnow_feed(self, keywords: str) -> list[JobListing]:
        """Fetch Arbeitnow API feed."""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://arbeiten.work/api/jobs",
                    timeout=self.timeout,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code != 200:
                    return []

            data = resp.json()
            jobs: list[JobListing] = []
            keywords_lower = keywords.lower().split()
            keywords_lower = [kw for kw in keywords_lower if len(kw) >= 2]

            for item in data.get("data", [])[:50]:
                title = item.get("title", "")
                description = item.get("description", "")
                url = item.get("url", "")

                if not url:
                    continue

                text = f"{title} {description}".lower()
                relevance = self._compute_relevance(text, keywords_lower)

                if relevance < 0.1:
                    continue

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, url)),
                        title=title,
                        company=item.get("company_name", ""),
                        location=item.get("location", ""),
                        url=url,
                        source="arbeitnow",
                        posted_date=item.get("created_at"),
                        description=description[:1000],
                        relevance_score=min(relevance, 1.0),
                        remote=True,
                    )
                )

            return jobs
        except Exception as exc:
            logger.error("Arbeitnow feed failed: %s", exc)
            return []

    def _extract_company(self, entry) -> str:
        """Try to extract company name from RSS entry."""
        if hasattr(entry, "author"):
            return entry.author
        if hasattr(entry, "authors") and entry.authors:
            return entry.authors[0].get("name", "")
        # Try to extract from title (common pattern: "Company Name - Job Title")
        title = entry.get("title", "")
        if " - " in title:
            return title.split(" - ")[0].strip()
        return ""
