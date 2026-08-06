"""Remote Freelance adapter — fetches jobs from RemoteOK, Himalayas, and Jobicy APIs."""

from __future__ import annotations

import asyncio
import logging
import uuid

import httpx

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)


class RemoteFreelanceAdapter(BaseMCPAdapter):
    """Adapter for remote freelance job platforms (free APIs, no auth)."""

    name = "remote_freelance"
    description = "Remote Freelance (RemoteOK, Himalayas, Jobicy)"
    timeout = 15.0

    async def is_available(self) -> bool:
        """Always available — these are free public APIs."""
        return True

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search all remote freelance platforms in parallel."""
        tasks = [
            self._fetch_remoteok(keywords),
            self._fetch_himalayas(keywords),
            self._fetch_jobicy(keywords),
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_jobs: list[JobListing] = []
        seen_urls: set[str] = set()

        for result in results:
            if isinstance(result, list):
                for job in result:
                    if job.url not in seen_urls:
                        seen_urls.add(job.url)
                        all_jobs.append(job)

        logger.info("Remote Freelance: found %d jobs total", len(all_jobs))
        return all_jobs

    async def _fetch_remoteok(self, keywords: str) -> list[JobListing]:
        """Fetch jobs from RemoteOK API."""
        try:
            # RemoteOK uses tag-based search
            search_tag = keywords.split()[0].lower() if keywords else "python"
            url = f"https://remoteok.com/api?tag={search_tag}"

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code != 200:
                    logger.warning("RemoteOK returned %d", resp.status_code)
                    return []

            data = resp.json()
            jobs: list[JobListing] = []
            keywords_lower = keywords.lower().split()
            keywords_lower = [kw for kw in keywords_lower if len(kw) >= 2]

            # First item is metadata, skip it
            for item in data[1:50] if isinstance(data, list) else data.get("jobs", [])[:50]:
                title = item.get("position", "")
                company = item.get("company", "")
                description = item.get("description", "")
                job_url = item.get("url", "")
                tags = item.get("tags", [])

                if not job_url:
                    continue

                # Build full URL if relative
                if job_url.startswith("/"):
                    job_url = f"https://remoteok.com{job_url}"

                # Compute relevance
                text = f"{title} {company} {' '.join(tags)}".lower()
                relevance = self._compute_relevance(text, keywords_lower)

                if relevance < 0.1:
                    continue

                # Parse date
                posted = None
                if item.get("date"):
                    posted = item["date"]

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, job_url)),
                        title=title,
                        company=company,
                        location="Remote",
                        url=job_url,
                        source="remoteok",
                        posted_date=posted,
                        description=description[:1000],
                        relevance_score=min(relevance, 1.0),
                        remote=True,
                    )
                )

            logger.info("RemoteOK: found %d jobs", len(jobs))
            return jobs
        except Exception as exc:
            logger.error("RemoteOK failed: %s", exc)
            return []

    async def _fetch_himalayas(self, keywords: str) -> list[JobListing]:
        """Fetch jobs from Himalayas API."""
        try:
            url = "https://himalayas.app/jobs/api/search"
            params = {
                "q": keywords,
                "limit": 50,
            }

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    url,
                    params=params,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code != 200:
                    logger.warning("Himalayas returned %d", resp.status_code)
                    return []

            data = resp.json()
            jobs: list[JobListing] = []
            keywords_lower = keywords.lower().split()
            keywords_lower = [kw for kw in keywords_lower if len(kw) >= 2]

            for item in data.get("jobs", [])[:50]:
                title = item.get("title", "")
                company = item.get("companyName", "")
                description = item.get("description", "")
                job_url = item.get("url", "")
                salary_min = item.get("salaryMin")
                salary_max = item.get("salaryMax")
                salary_currency = item.get("salaryCurrency", "USD")

                if not job_url:
                    continue

                # Build full URL if relative
                if job_url.startswith("/"):
                    job_url = f"https://himalayas.app{job_url}"

                # Compute relevance
                text = f"{title} {company} {description}".lower()
                relevance = self._compute_relevance(text, keywords_lower)

                if relevance < 0.1:
                    continue

                # Build salary info
                salary_info = ""
                if salary_min and salary_max:
                    salary_info = f"Salary: {salary_currency} {salary_min:,} - {salary_max:,}"
                elif salary_min:
                    salary_info = f"Salary: {salary_currency} {salary_min:,}+"

                # Parse date
                posted = item.get("createdAt")

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, job_url)),
                        title=title,
                        company=company,
                        location="Remote",
                        url=job_url,
                        source="himalayas",
                        posted_date=posted,
                        description=f"{salary_info}\n\n{description}"[:1000] if salary_info else description[:1000],
                        relevance_score=min(relevance, 1.0),
                        remote=True,
                    )
                )

            logger.info("Himalayas: found %d jobs", len(jobs))
            return jobs
        except Exception as exc:
            logger.error("Himalayas failed: %s", exc)
            return []

    async def _fetch_jobicy(self, keywords: str) -> list[JobListing]:
        """Fetch jobs from Jobicy API."""
        try:
            # Jobicy uses tag-based search
            search_tag = keywords.split()[0].lower() if keywords else "python"
            url = "https://jobicy.com/api/v2/remote-jobs"
            params = {
                "tag": search_tag,
                "count": 50,
            }

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    url,
                    params=params,
                    headers={"User-Agent": "ResumeMatcher/1.0"},
                )
                if resp.status_code != 200:
                    logger.warning("Jobicy returned %d", resp.status_code)
                    return []

            data = resp.json()
            jobs: list[JobListing] = []
            keywords_lower = keywords.lower().split()
            keywords_lower = [kw for kw in keywords_lower if len(kw) >= 2]

            for item in data.get("jobs", [])[:50]:
                title = item.get("jobTitle", "")
                company = item.get("companyName", "")
                description = item.get("jobDescription", "")
                job_url = item.get("url", "")
                job_type = item.get("jobType", "")
                salary_min = item.get("annualSalaryMin")
                salary_max = item.get("annualSalaryMax")
                salary_currency = item.get("salaryCurrency", "USD")

                if not job_url:
                    continue

                # Compute relevance
                text = f"{title} {company} {description}".lower()
                relevance = self._compute_relevance(text, keywords_lower)

                if relevance < 0.1:
                    continue

                # Build salary info
                salary_info = ""
                if salary_min and salary_max:
                    salary_info = f"Salary: {salary_currency} {salary_min:,} - {salary_max:,}/year"
                elif salary_min:
                    salary_info = f"Salary: {salary_currency} {salary_min:,}+/year"

                # Parse date
                posted = item.get("pubDate")

                jobs.append(
                    JobListing(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, job_url)),
                        title=title,
                        company=company,
                        location="Remote",
                        url=job_url,
                        source="jobicy",
                        posted_date=posted,
                        description=f"{salary_info}\n\n{description}"[:1000] if salary_info else description[:1000],
                        relevance_score=min(relevance, 1.0),
                        remote=True,
                    )
                )

            logger.info("Jobicy: found %d jobs", len(jobs))
            return jobs
        except Exception as exc:
            logger.error("Jobicy failed: %s", exc)
            return []

    def _compute_relevance(self, text: str, keywords: list[str]) -> float:
        """Compute relevance score based on keyword matches."""
        if not keywords:
            return 0.5

        score = 0.0
        matched_keywords = 0

        for kw in keywords:
            if kw in text:
                matched_keywords += 1
                score += 0.2
                # Extra boost for tech skills
                if kw in {
                    "javascript", "typescript", "python", "java", "go", "rust",
                    "react", "vue", "angular", "node", "nextjs", "fastapi",
                    "django", "docker", "kubernetes", "aws", "azure",
                }:
                    score += 0.15

        # Bonus for matching multiple keywords
        if matched_keywords >= 2:
            score += 0.1

        # Title matches are worth more
        title_text = text[:200]
        for kw in keywords:
            if kw in title_text:
                score += 0.2

        return min(score, 1.0)
