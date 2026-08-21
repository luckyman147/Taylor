"""Job description management endpoints."""

import logging
import re

from fastapi import APIRouter, HTTPException, Query

from app.database import db
from app.schemas import JobUploadRequest, JobUploadResponse, MobileJobSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["Jobs"])

_CONTENT_PREVIEW_LEN = 300

# Lines that are never a job title when they open a raw JD text.
_BOILERPLATE_FIRST_LINES = {
    "about the job",
    "about the role",
    "job description",
    "job details",
    "job overview",
    "job summary",
    "the role",
    "responsibilities",
    "requirements",
    "qualifications",
    "company description",
    "company overview",
    "description",
    "skills required",
    "kills required",
    "we are looking for",
    "who we are",
    "what you'll do",
    "what you will do",
    "we are hiring",
    "join our team",
}

# Work-type / workplace tokens stripped from a "Title | Full-Time | ..." line.
_WORK_MODE_TOKENS = {
    "full-time",
    "part-time",
    "contract",
    "internship",
    "freelance",
    "temporary",
    "permanent",
    "on-site",
    "onsite",
    "hybrid",
    "remote",
    "cdi",
    "cdd",
    "stage",
    "alternance",
}

_TITLE_LABEL_RE = re.compile(
    r"^(job\s+)?(title|position|role|poste|intitul[ée]\s+du\s+poste)\s*[::-]\s*(.+)$",
    re.IGNORECASE,
)
_COMPANY_LABEL_RE = re.compile(
    r"^(company|employer|entreprise|soci[ée]t[ée])\s*[::-]\s*(.+)$",
    re.IGNORECASE,
)
_LOCATION_LABEL_RE = re.compile(
    r"^(location|lieu|localisation|workplace|place|emplacement)\s*[::-]\s*(.+)$",
    re.IGNORECASE,
)
_AT_COMPANY_RE = re.compile(r"^\(?\s*(.+?)\s+@\s+(.+?)\s*\)?\s*$")
_ABOUT_COMPANY_RE = re.compile(
    r"^(about|à propos de|a propos de)\s+(.+?)\s*:?$", re.IGNORECASE
)
_WORK_TYPE_SUFFIX_RE = re.compile(
    r"\s*[-–—|]\s*(?:full[- ]?time|part[- ]?time|contract|internship|freelance|temporary|permanent|on[- ]?site|hybrid|remote|cdi|cdd|stage|alternance)\s*$",
    re.IGNORECASE,
)

# Company names ending in a legal/entity suffix ("Bridges S.A.", "Acme GmbH")
# — the suffix keeps the period, so the next sentence must not cut it off.
_COMPANY_NAME_SUFFIX_RE = re.compile(
    r"^(?P<name>.{1,200}?)(?:\s+(?P<suffix>S\.A\.|S\.A\.S\.|SA|SAS|Ltd\.|LLC|Inc\.?|GmbH|SARL|SPA|PLC|Co\.|Corp\.?|AG|SE|B\.V\.|N\.V\.|Ltda|Pty|SrL))(?=\s|$)",
    re.IGNORECASE,
)


def _first_company_sentence(line: str) -> str:
    """Company-name slice of a ``Company Description`` follow-up line."""
    m = _COMPANY_NAME_SUFFIX_RE.match(line)
    if m:
        return f"{m.group('name').strip()} {m.group('suffix').strip()}".strip()
    return re.split(r"[.;!?]\s", line)[0].strip()


def _extract_mobile_job_fields(content: str) -> dict[str, str | None]:
    """Best-effort title/company/location extraction from a raw JD text.

    The TAYLOR mobile app uploads jobs as plain descriptions with no
    structured fields, so the table falls back to deterministic patterns
    observed in captured JDs, e.g.::

        ( Full-Stack Engineer @ Stravos )
        Junior Django Developer – Full-Time | On-site | Tunis, Tunisia
        À propos de Stravos :
        Company Description
        Bridges S.A. is ...

    Stored metadata always wins over extraction (the router merges).
    """
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    title = company = location = None
    seen_company_description = False

    for raw_line in lines[:8]:
        line = raw_line.rstrip(":：")

        m = _TITLE_LABEL_RE.match(line)
        if m and title is None:
            candidate = m.group(3).strip()
            if len(candidate) <= 200:
                title = candidate
                continue

        m = _COMPANY_LABEL_RE.match(line)
        if m and company is None:
            candidate = m.group(2).strip()
            if len(candidate) <= 200:
                company = candidate
                continue

        m = _LOCATION_LABEL_RE.match(line)
        if m and location is None:
            candidate = m.group(2).strip()
            if len(candidate) <= 200:
                location = candidate
                continue

        # "( Title @ Company )" — or "Recrutement - CDI ( Title @ Company )",
# where the parenthesized part carries the actual title/company.
        paren = re.search(r"\(([^()]*@[^()]*)\)", line)
        at_target = paren.group(1) if paren else line
        m = _AT_COMPANY_RE.match(at_target)
        if m and (title is None or company is None):
            at_title, at_company = m.group(1).strip(), m.group(2).strip()
            if title is None and 0 < len(at_title) <= 200:
                title = at_title
            if company is None and 0 < len(at_company) <= 200:
                company = at_company
            continue

        m = _ABOUT_COMPANY_RE.match(line)
        if m and company is None:
            candidate = m.group(2).strip()
            if candidate.lower() in {
                "the job",
                "this job",
                "the role",
                "this role",
                "the company",
                "this company",
                "us",
                "our company",
                "the team",
                "our team",
            }:
                continue
            if 0 < len(candidate) <= 200:
                company = candidate
            continue

        # "Company Description" / "À propos de l'entreprise" headers: the next
        # line is usually the company name.
        lowered = line.lower()
        if (
            lowered in {"company description", "company overview", "about the company"}
            or lowered.startswith("à propos de l'entreprise")
            or lowered.startswith("a propos de l'entreprise")
        ):
            seen_company_description = True
            continue

        if seen_company_description and company is None:
            candidate = _first_company_sentence(line)
            if 0 < len(candidate) <= 200:
                company = candidate
                seen_company_description = False
                continue

        # "Title – Full-Time | On-site | Tunis, Tunisia"
        if "|" in line:
            segments = [seg.strip() for seg in line.split("|")]
            if len(segments) >= 2:
                for seg in reversed(segments[1:]):
                    lowered_seg = seg.lower()
                    if lowered_seg in _WORK_MODE_TOKENS:
                        continue
                    if location is None and 0 < len(seg) <= 200:
                        location = seg
                        break
                if title is None:
                    first = segments[0]
                    first = _WORK_TYPE_SUFFIX_RE.sub("", first).strip()
                    if (
                        0 < len(first) <= 200
                        and first.lower() not in _BOILERPLATE_FIRST_LINES
                    ):
                        title = first
                continue

        # Last resort: a short first line that does not look like boilerplate.
        if title is None and raw_line == lines[0]:
            lowered = raw_line.lower()
            if (
                0 < len(raw_line) <= 200
                and lowered not in _BOILERPLATE_FIRST_LINES
                and "description" not in lowered
                and "requirements" not in lowered
                and "looking for" not in lowered
            ):
                title = raw_line
                continue

    return {"title": title, "company": company, "location": location}


@router.post("/upload", response_model=JobUploadResponse)
async def upload_job_descriptions(request: JobUploadRequest) -> JobUploadResponse:
    """Upload one or more job descriptions.

    Two input modes, both backward compatible:

    - ``job_descriptions``: a list of raw job-description texts (legacy).
    - ``jobs``: structured mobile payloads (``title``, ``company``,
      ``location``, ``description``, ``url``, ``source``, ...). Structured
      fields are stored in the job's metadata and flatten to top-level keys
      on read, so the existing improve/tailor pipeline works unchanged.

    Returns an array of ``job_id`` values corresponding to the input array.
    """
    if request.jobs:
        if request.job_descriptions:
            raise HTTPException(
                status_code=400,
                detail="Provide either 'job_descriptions' or 'jobs', not both",
            )
        job_ids: list[str] = []
        for job in request.jobs:
            if not job.description.strip():
                raise HTTPException(status_code=400, detail="Empty job description")
            metadata = {
                key: value
                for key, value in {
                    "title": job.title,
                    "company": job.company,
                    "location": job.location,
                    "url": job.url,
                    "web_url": job.web_url,
                    "source": job.source,
                    "posted_at": job.posted_at,
                }.items()
                if value
            }
            created = await db.create_job(
                content=job.description.strip(),
                resume_id=request.resume_id,
                metadata=metadata,
            )
            job_ids.append(created["job_id"])
        return JobUploadResponse(
            message=f"{len(job_ids)} structured job(s) stored",
            job_id=job_ids,
            request={"jobs": request.jobs, "resume_id": request.resume_id},
        )

    if not request.job_descriptions:
        raise HTTPException(status_code=400, detail="No job descriptions provided")

    job_ids = []
    for jd in request.job_descriptions:
        if not jd.strip():
            raise HTTPException(status_code=400, detail="Empty job description")

        job = await db.create_job(
            content=jd.strip(),
            resume_id=request.resume_id,
        )
        job_ids.append(job["job_id"])

    return JobUploadResponse(
        message="data successfully processed",
        job_id=job_ids,
        request={
            "job_descriptions": request.job_descriptions,
            "resume_id": request.resume_id,
        },
    )


@router.get("", response_model=list[MobileJobSummary])
async def list_jobs(
    source: str | None = Query(default=None, max_length=50),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[MobileJobSummary]:
    """List jobs newest-first for the PC frontend table.

    Structured fields (``title``, ``company``, ``location``, ``url``,
    ``source``) come from each job's flattened metadata; ``content_preview``
    is the leading slice of the raw description.
    """
    jobs = await db.list_jobs(source=source, limit=limit)
    out: list[MobileJobSummary] = []
    for job in jobs:
        fields = _extract_mobile_job_fields(job["content"])
        out.append(
            MobileJobSummary(
                job_id=job["job_id"],
                title=job.get("title") or fields["title"],
                company=job.get("company") or fields["company"],
                location=job.get("location") or fields["location"],
                url=job.get("url"),
                web_url=job.get("web_url"),
                source=job.get("source"),
                posted_at=job.get("posted_at"),
                created_at=job["created_at"],
                content_preview=job["content"][:_CONTENT_PREVIEW_LEN],
            )
        )
    return out


@router.delete("/{job_id}")
async def delete_job(job_id: str) -> dict:
    """Delete a job description by ID."""
    deleted = await db.delete_job(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"deleted": True, "job_id": job_id}


@router.get("/{job_id}")
async def get_job(job_id: str) -> dict:
    """Get job description by ID."""
    job = await db.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not (job.get("title") or job.get("company") or job.get("location")):
        fields = _extract_mobile_job_fields(job["content"])
        job.setdefault("title", fields["title"])
        job.setdefault("company", fields["company"])
        job.setdefault("location", fields["location"])

    return job
