"""LinkedIn MCP adapter — uses linkedin-scraper-mcp via MCP client."""

from __future__ import annotations

import json
import logging
import shutil
import uuid

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)


class LinkedInAdapter(BaseMCPAdapter):
    """Adapter for LinkedIn job search via linkedin-scraper-mcp."""

    name = "linkedin"
    description = "LinkedIn (linkedin-scraper-mcp)"
    timeout = 120.0

    MCP_PORT = 3005

    async def is_available(self) -> bool:
        if not shutil.which("mcporter"):
            return False
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"http://localhost:{self.MCP_PORT}/mcp", timeout=5.0
                )
                return resp.status_code in (200, 406)
        except Exception:
            return False

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search LinkedIn jobs via MCP client."""
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            location = None
            if filters.locations:
                loc_map = {
                    "uae": "United Arab Emirates",
                    "saudi_arabia": "Saudi Arabia",
                    "qatar": "Qatar",
                    "egypt": "Egypt",
                    "bahrain": "Bahrain",
                    "oman": "Oman",
                    "kuwait": "Kuwait",
                    "jordan": "Jordan",
                    "remote": "Remote",
                    "global": None,
                    "us": "United States",
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
                non_global = [l for l in filters.locations if l.value != "global"]
                if non_global:
                    location = ", ".join(loc_map.get(l.value, l.value) for l in non_global)

            job_type_map = {
                "full_time": "full_time",
                "part_time": "part_time",
                "contract": "contract",
                "internship": "internship",
                "freelance": "other",
                "temporary": "temporary",
                "volunteer": "volunteer",
            }
            job_type = None
            if filters.job_types:
                types = [job_type_map.get(jt.value, jt.value) for jt in filters.job_types]
                job_type = ",".join(types)

            experience_map = {
                "internship": "internship",
                "entry": "entry",
                "associate": "associate",
                "mid_senior": "mid_senior",
                "director": "director",
                "executive": "executive",
            }
            experience_level = None
            if filters.experience_levels:
                levels = [experience_map.get(el.value, el.value) for el in filters.experience_levels]
                experience_level = ",".join(levels)

            work_type_map = {
                "remote": "remote",
                "hybrid": "hybrid",
                "on_site": "on_site",
            }
            work_type = None
            if filters.work_types:
                types = [work_type_map.get(wt.value, wt.value) for wt in filters.work_types]
                work_type = ",".join(types)

            date_posted_map = {
                "past_hour": "past_hour",
                "past_24_hours": "past_24_hours",
                "past_week": "past_week",
                "past_month": "past_month",
            }

            args: dict = {
                "keywords": keywords,
                "max_pages": filters.max_pages,
                "date_posted": date_posted_map.get(filters.date_posted.value, "past_24_hours"),
                "easy_apply": filters.easy_apply_only,
            }
            if location:
                args["location"] = location
            if job_type:
                args["job_type"] = job_type
            if experience_level:
                args["experience_level"] = experience_level
            if work_type:
                args["work_type"] = work_type

            async with streamablehttp_client(
                f"http://localhost:{self.MCP_PORT}/mcp"
            ) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool("search_jobs", arguments=args)

                    for item in result.content:
                        if hasattr(item, "text"):
                            data = json.loads(item.text)
                            refs = data.get("references", {}).get("search_results", [])
                            job_ids = []
                            for ref in refs:
                                if ref.get("kind") == "job":
                                    job_id = ref.get("url", "").rstrip("/").split("/")[-1]
                                    if job_id:
                                        job_ids.append((job_id, ref.get("text", "Unknown")))

                            # Fetch details for first 5 jobs to get company names
                            jobs: list[JobListing] = []
                            for job_id, title in job_ids[:5]:
                                try:
                                    detail_result = await session.call_tool(
                                        "get_job_details",
                                        {"job_id": job_id}
                                    )
                                    for detail_item in detail_result.content:
                                        if hasattr(detail_item, "text"):
                                            detail_data = json.loads(detail_item.text)

                                            # Extract company from references
                                            company = "Unknown"
                                            refs = detail_data.get("references", {}).get("job_posting", [])
                                            for ref in refs:
                                                if ref.get("kind") == "company":
                                                    company = ref.get("text", "Unknown")
                                                    break

                                            # Extract location from job_posting text
                                            posting = detail_data.get("sections", {}).get("job_posting", "")
                                            location = ""
                                            description = ""
                                            for line in posting.split("\n"):
                                                line = line.strip()
                                                if not line:
                                                    continue
                                                if "·" in line and ("ago" in line or "hour" in line or "day" in line):
                                                    # Line like "United Arab Emirates · 10 hours ago"
                                                    parts = line.split("·")
                                                    if parts:
                                                        location = parts[0].strip()
                                                elif len(line) > 50:
                                                    description = line
                                                    break

                                            jobs.append(
                                                JobListing(
                                                    id=job_id,
                                                    title=title,
                                                    company=company,
                                                    location=location,
                                                    url=f"https://www.linkedin.com/jobs/view/{job_id}/",
                                                    source="linkedin",
                                                    description=description[:500] if description else None,
                                                    relevance_score=0.0,
                                                    remote=True,
                                                )
                                            )
                                except Exception as exc:
                                    logger.warning("Failed to get details for job %s: %s", job_id, exc)
                                    jobs.append(
                                        JobListing(
                                            id=job_id,
                                            title=title,
                                            company="Unknown",
                                            location="",
                                            url=f"https://www.linkedin.com/jobs/view/{job_id}/",
                                            source="linkedin",
                                            relevance_score=0.0,
                                            remote=True,
                                        )
                                    )

                            # Add remaining jobs without details
                            for job_id, title in job_ids[5:]:
                                jobs.append(
                                    JobListing(
                                        id=job_id,
                                        title=title,
                                        company="Unknown",
                                        location="",
                                        url=f"https://www.linkedin.com/jobs/view/{job_id}/",
                                        source="linkedin",
                                        relevance_score=0.0,
                                        remote=True,
                                    )
                                )

                            return jobs
            return []
        except Exception as exc:
            logger.error("LinkedIn search failed: %s", exc)
            return []

    def _parse_results(self, data: dict) -> list[JobListing]:
        """Parse LinkedIn MCP response into JobListing objects."""
        jobs: list[JobListing] = []
        references = data.get("references", {}).get("search_results", [])
        for ref in references:
            if ref.get("kind") == "job":
                job_id = ref.get("url", "").rstrip("/").split("/")[-1]
                jobs.append(
                    JobListing(
                        id=job_id or str(uuid.uuid4()),
                        title=ref.get("text", "Unknown"),
                        company="",
                        location="",
                        url=f"https://www.linkedin.com{ref.get('url', '')}",
                        source="linkedin",
                        relevance_score=0.0,
                        remote=True,
                    )
                )
        return jobs
