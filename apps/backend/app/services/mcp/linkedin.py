"""LinkedIn MCP adapter — uses linkedin-scraper-mcp via MCP client."""

from __future__ import annotations

import json
import logging
import re
import shutil
import uuid
from typing import Any

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\)]+)\)")
_PROFILE_PATH_RE = re.compile(r"^(?:https?://(?:www\.)?linkedin\.com)?(/(?:in|company)/[A-Za-z0-9\-_%]+)", re.I)
_EMAIL_RE = re.compile(
    r"(?<![\w.+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)"
)
_PHONE_RE = re.compile(r"(?<!\w)(\+?\d[\d\s().-]{7,17}\d)(?!\w)")
_FOLLOWERS_RE = re.compile(r"([\d,]+)\s+followers?", re.I)
_EMPLOYEES_RE = re.compile(r"(\d[\d,\-–\s]*\+?\s*employees?)", re.I)
# Markers of LinkedIn's 404 / auth-wall pages — never parse these as profile data.
_ERROR_PAGE_RE = re.compile(
    r"this page doesn['\u2019]?t exist|page not found|join linkedin|log in to linkedin|"
    r"sign up to view|authwall|redirecting you to the login",
    re.I,
)


def _is_error_page(text: str) -> bool:
    """True when the page content is a LinkedIn 404 / auth-wall shell."""
    return bool(text and _ERROR_PAGE_RE.search(text[:2000]))


# Page chrome that leaks into scraped ref text (follow buttons etc.).
_CHROME_RE = re.compile(r"follow this page|connections? follow|other connection|^page by\b", re.I)


def _profile_slug(value: str) -> str:
    """Extract the ``/in/`` username slug from a full URL or bare username.

    The MCP tool builds ``https://www.linkedin.com/in/{arg}`` itself, so
    passing a full URL produces a doubled path and a LinkedIn 404.
    """
    if "linkedin.com/in/" in value:
        slug = value.split("?")[0].rstrip("/")
        return slug.split("/in/")[-1].strip("/")
    return value.strip().strip("/")


# Degree badges / connection counters that sit between name and headline.
_BADGE_LINE_RE = re.compile(
    r"^[·•|]?\s*\d+(?:st|nd|rd|th)\s*$"
    r"|^\d[\d,]*\+?\s+connections?$"
    r"|^[·•|]\s*$",
    re.I,
)
# Section headers that may prefix the experience list.
_SECTION_HEADER_RE = re.compile(
    r"^(?:experience|education|activity|about|contact info|people also viewed|"
    r"skills|recommendations|licenses & certifications|courses|publications|"
    r"awards & honors|volunteering experience|organizations|featured|"
    r"interests|key signals|people who can introduce you|"
    r"profile enhanced with premium|sales insights)$",
    re.I,
)
_DATE_LINE_RE = re.compile(
    r"^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\bpresent\b|^\d{4}\s*[-–]",
    re.I,
)


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

                    logger.debug(
                        "LinkedIn MCP search_jobs result: %d content items, "
                        "is_error=%s",
                        len(result.content),
                        getattr(result, "isError", None),
                    )

                    for idx, item in enumerate(result.content):
                        has_text = hasattr(item, "text")
                        logger.debug(
                            "LinkedIn MCP content[%d]: type=%s, has_text=%s",
                            idx,
                            type(item).__name__,
                            has_text,
                        )
                        if has_text:
                            raw_text = item.text[:2000]
                            logger.debug(
                                "LinkedIn MCP content[%d] text (first 2000 chars): %s",
                                idx,
                                raw_text,
                            )
                            try:
                                data = json.loads(item.text)
                            except json.JSONDecodeError as exc:
                                logger.warning(
                                    "LinkedIn MCP content[%d] JSON parse failed: %s",
                                    idx,
                                    exc,
                                )
                                continue

                            refs = data.get("references", {}).get("search_results", [])
                            if not refs:
                                logger.debug(
                                    "LinkedIn MCP content[%d] top-level keys: %s, "
                                    "references keys: %s",
                                    idx,
                                    list(data.keys()),
                                    list(data.get("references", {}).keys()),
                                )
                            job_ids = []
                            ref_kinds = []
                            for ref in refs:
                                ref_kinds.append(ref.get("kind", "none"))
                                if ref.get("kind") == "job":
                                    job_id = ref.get("url", "").rstrip("/").split("/")[-1]
                                    if job_id:
                                        job_ids.append((job_id, ref.get("text", "Unknown")))

                            logger.debug(
                                "LinkedIn MCP parsed %d refs, kinds=%s, "
                                "extracted %d job_ids: %s",
                                len(refs),
                                ref_kinds,
                                len(job_ids),
                                [jid for jid, _ in job_ids],
                            )

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

    # -- Lead research tools (search_people / companies / profiles) --------

    async def _call_tool(self, tool: str, arguments: dict[str, Any]) -> list[dict[str, Any]]:
        """Call one MCP tool and return every parsed JSON payload.

        Each content item that carries JSON text becomes one dict. Errors are
        swallowed into an empty list so one flaky tool never kills a search.
        """
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            payloads: list[dict[str, Any]] = []
            async with streamablehttp_client(
                f"http://localhost:{self.MCP_PORT}/mcp"
            ) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(tool, arguments=arguments)
                    for item in result.content:
                        text = getattr(item, "text", None)
                        if not text:
                            continue
                        try:
                            payloads.append(json.loads(text))
                        except json.JSONDecodeError:
                            logger.debug(
                                "LinkedIn MCP %s content is not JSON (first 200 chars): %s",
                                tool,
                                text[:200],
                            )
            return payloads
        except Exception as exc:
            logger.error("LinkedIn MCP %s failed: %s", tool, exc)
            return []

    @staticmethod
    def _parse_search_refs(payload: dict[str, Any], kind: str) -> list[dict[str, Any]]:
        """Parse ``references.search_results`` (+ markdown fallback) into leads.

        ``kind`` is "person" or "company" — used to tag the shape of each hit.
        """
        hits: list[dict[str, Any]] = []
        seen: set[str] = set()
        refs = payload.get("references", {}).get("search_results", []) or []
        for ref in refs:
            path = str(ref.get("url") or "")
            match = _PROFILE_PATH_RE.match(path)
            if not match:
                continue
            slug_path = match.group(1)
            url = f"https://www.linkedin.com{slug_path}".lower()
            if url in seen:
                continue
            seen.add(url)
            text = str(ref.get("text") or "").strip()
            name = ""
            if text:
                first_line = text.splitlines()[0].strip()
                # Page text can carry follow-button chrome or huge headlines;
                # the slug ("the-software-engineer-coach") is the real name.
                if len(first_line) <= 120 and not _CHROME_RE.search(first_line):
                    name = first_line
            if not name:
                name = slug_path.rsplit("/", 1)[-1].replace("-", " ").strip()
            hits.append({"name": name, "url": url, "kind": kind})
        if hits:
            return hits
        # Fallback: scrape markdown links out of the raw search_results text.
        sections = payload.get("sections", {}) or {}
        raw = str(sections.get("search_results") or "")
        for label, link in _MARKDOWN_LINK_RE.findall(raw):
            match = _PROFILE_PATH_RE.match(link)
            if not match:
                continue
            slug_path = match.group(1)
            url = f"https://www.linkedin.com{slug_path}".lower()
            if url in seen:
                continue
            seen.add(url)
            hits.append({"name": label.strip(), "url": url, "kind": kind})
        return hits

    async def search_people(
        self, keywords: str, location: str | None = None, max_results: int = 25
    ) -> list[dict[str, Any]]:
        """Search LinkedIn people; returns [{name, url, kind: person}]."""
        args: dict[str, Any] = {"keywords": keywords}
        if location:
            args["location"] = location
        payloads = await self._call_tool("search_people", args)
        hits: list[dict[str, Any]] = []
        for payload in payloads:
            hits.extend(self._parse_search_refs(payload, kind="person"))
        return hits[:max_results]

    @staticmethod
    def _parse_contact_info(text: str) -> tuple[str | None, str | None]:
        """Pull email/phone out of a LinkedIn contact_info section."""
        email = next(
            (e for e in _EMAIL_RE.findall(text or "") if not e.endswith((".png", ".jpg", ".svg"))),
            None,
        )
        phone = None
        for match in _PHONE_RE.findall(text or ""):
            if "\n" in match or "\r" in match:
                continue
            digits = re.sub(r"\D", "", match)
            # Require an international prefix or a full 10+ digit number so
            # page counters ("359 441 457") never become phone numbers.
            if match.strip().startswith("+"):
                if 8 <= len(digits) <= 15:
                    phone = match.strip()
                    break
            elif 10 <= len(digits) <= 15:
                phone = match.strip()
                break
        return email, phone

    async def get_person_profile(
        self, username_or_url: str, sections: str = "experience,contact_info"
    ) -> dict[str, Any] | None:
        """Read one person profile.

        Returns {url, name, headline, location, email, phone, current_title,
        current_company, experience_text, about}. Email/phone come from the
        ``contact_info`` section when LinkedIn exposes them; location is the
        header line under the headline. ``username_or_url`` may be a full
        profile URL or a bare slug — only the slug is sent to the tool.
        """
        slug = _profile_slug(username_or_url)
        payloads = await self._call_tool(
            "get_person_profile",
            {"linkedin_username": slug, "sections": sections},
        )
        if not payloads:
            return None
        payload = payloads[0]
        sec = payload.get("sections", {}) or {}
        # The main page text is the first section value; name/headline/location
        # are the first three non-empty lines ("Jane Doe / Title / City, Country").
        main_text = ""
        for key, value in sec.items():
            if key in ("experience", "contact_info", "about"):
                continue
            if isinstance(value, str) and value.strip():
                main_text = value
                break
        if _is_error_page(main_text) or _is_error_page(str(sec.get("experience") or "")):
            # 404 / auth-wall shell — nothing usable on this profile.
            return None
        lines = [ln.strip() for ln in main_text.splitlines() if ln.strip()]
        name = lines[0] if lines else ""
        # Degree badges ("· 3rd", "500+ connections") sit between name and
        # headline; everything after the "Contact info" marker is page chrome.
        rest = [ln for ln in lines[1:] if not _BADGE_LINE_RE.match(ln)]
        for i, ln in enumerate(rest):
            if ln.lower().strip(" ·•") == "contact info":
                rest = rest[:i]
                break
        headline = rest[0] if rest else ""
        location = rest[1] if len(rest) > 1 else None
        # Header line 3 is a location when short; long lines are about-text noise.
        if location and (
            len(location) > 80
            or "http" in location.lower()
            or location[0].isdigit()
            or _FOLLOWERS_RE.search(location)
        ):
            location = None
        email, phone = self._parse_contact_info(str(sec.get("contact_info") or ""))
        experience_text = str(sec.get("experience") or "")
        current_title, current_company = None, None
        if experience_text:
            exp_lines = [ln.strip() for ln in experience_text.splitlines() if ln.strip()]
            meaningful = [
                ln for ln in exp_lines if not _SECTION_HEADER_RE.match(ln.strip(" ·•\t"))
            ]
            if meaningful:
                first = meaningful[0]
                segs = [s.strip() for s in re.split(r"[·|•]", first) if s.strip()]
                if segs and not _DATE_LINE_RE.match(segs[0]):
                    current_title = segs[0][:120]
                if len(segs) > 1 and not _DATE_LINE_RE.match(segs[1]):
                    current_company = segs[1][:120]
                else:
                    # Fallback: next non-date line holds the company name.
                    for line in meaningful[1:4]:
                        if _DATE_LINE_RE.match(line) or len(line) > 120:
                            continue
                        company_part = re.split(r"[·|•]", line)[0].strip()
                        if company_part:
                            current_company = company_part[:120]
                            break
        about = str(sec.get("about") or "")
        url = str(payload.get("url") or f"https://www.linkedin.com/in/{slug}")
        return {
            "url": url,
            "name": name,
            "headline": headline,
            "location": location,
            "email": email,
            "phone": phone,
            "current_title": current_title or headline or None,
            "current_company": current_company,
            "experience_text": experience_text[:2000],
            "about": about[:2000],
        }

    async def search_companies(self, keywords: str, max_results: int = 15) -> list[dict[str, Any]]:
        """Search LinkedIn companies; returns [{name, url, kind: company}]."""
        payloads = await self._call_tool("search_companies", {"keywords": keywords})
        hits: list[dict[str, Any]] = []
        for payload in payloads:
            hits.extend(self._parse_search_refs(payload, kind="company"))
        return hits[:max_results]

    async def get_company_profile(self, company_name: str) -> dict[str, Any] | None:
        """Read a company about page.

        Returns {url, name, about, slug, industry, location, company_size}.
        LinkedIn company pages open with a header line like
        "Software · Tunis, Tunisia · 11-50 employees · 1,234 followers" —
        the parts before the employee/followers counts are industry/location.
        """
        payloads = await self._call_tool(
            "get_company_profile", {"company_name": company_name}
        )
        if not payloads:
            return None
        payload = payloads[0]
        sec = payload.get("sections", {}) or {}
        about = ""
        for value in sec.values():
            if isinstance(value, str) and value.strip():
                about = value
                break
        if _is_error_page(about):
            return None
        lines = [ln.strip() for ln in about.splitlines() if ln.strip()]
        name = lines[0].lstrip("#").strip() if lines else company_name
        url = str(payload.get("url") or "")

        industry: str | None = None
        location: str | None = None
        company_size: str | None = None
        # The header line sits right under the name (line 1) on most pages;
        # fall back to scanning the first few lines for the ·-separated shape.
        header = lines[1] if len(lines) > 1 else ""
        if "·" not in header:
            header = next(
                (ln for ln in lines[1:5] if ln.count("·") >= 1 and len(ln) < 200),
                "",
            )
        if header:
            parts = [p.strip() for p in re.split(r"[·|•]", header) if p.strip()]
            size_idx = next(
                (i for i, p in enumerate(parts) if _EMPLOYEES_RE.search(p)), None
            )
            followers_idx = next(
                (i for i, p in enumerate(parts) if _FOLLOWERS_RE.search(p)), None
            )
            # Keep only the meaningful head: industry, location, size.
            end = size_idx if size_idx is not None else (followers_idx or len(parts))
            head = parts[:end]
            if size_idx is not None:
                company_size = _EMPLOYEES_RE.search(parts[size_idx]).group(1).strip()
            if head:
                industry = head[0] or None
            if len(head) > 1:
                location = head[1] or None

        return {
            "url": url,
            "name": name,
            "about": about[:2000],
            "slug": url.rstrip("/").rsplit("/", 1)[-1] if url else company_name,
            "industry": industry,
            "location": location,
            "company_size": company_size,
        }

    async def get_company_employees(
        self, company_name: str, keywords: str | None = None, max_results: int = 20
    ) -> list[dict[str, Any]]:
        """List company employees; returns [{name, url, kind: person}]."""
        args: dict[str, Any] = {"company_name": company_name}
        if keywords:
            args["keywords"] = keywords
        payloads = await self._call_tool("get_company_employees", args)
        hits: list[dict[str, Any]] = []
        for payload in payloads:
            refs = payload.get("references", {}) or {}
            employees = refs.get("employees") or refs.get("search_results") or []
            for ref in employees:
                path = str(ref.get("url") or "")
                match = _PROFILE_PATH_RE.match(path)
                if not match:
                    continue
                slug_path = match.group(1)
                url = f"https://www.linkedin.com{slug_path}".lower()
                hits.append(
                    {
                        "name": str(ref.get("text") or slug_path.rsplit("/", 1)[-1]),
                        "url": url,
                        "kind": "person",
                    }
                )
        return hits[:max_results]
