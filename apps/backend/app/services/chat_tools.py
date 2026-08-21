"""Chat tool registry — declares tools, validates args, executes against existing services."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)


class ToolRequiresConfirmation(Exception):
    """Raised when a write tool needs user confirmation before execution."""

    def __init__(self, tool: str, args: dict[str, Any], summary: str):
        self.tool = tool
        self.args = args
        self.summary = summary


@dataclass
class ToolSpec:
    name: str
    description: str
    params: dict[str, dict[str, Any]]
    write: bool
    summary_template: str = ""


# Tool catalog

TOOL_CATALOG: dict[str, ToolSpec] = {
    "get_career_summary": ToolSpec(
        name="get_career_summary",
        description="Get a summary of the user's career profile, skills, education, and projects.",
        params={},
        write=False,
    ),
    "get_ats_audit": ToolSpec(
        name="get_ats_audit",
        description="Run a resume ATS audit. Pass resume_id to audit a specific resume. Omit resume_id to see available resumes for selection.",
        params={
            "resume_id": {"type": "str", "required": False, "max_len": 100},
        },
        write=False,
    ),
    "get_funnel_stats": ToolSpec(
        name="get_funnel_stats",
        description="Get application funnel statistics (total, conversion rates, rejection patterns).",
        params={},
        write=False,
    ),
    "get_skill_roi": ToolSpec(
        name="get_skill_roi",
        description="Get skill ROI analysis: which skills give the best return on learning investment.",
        params={},
        write=False,
    ),
    "get_market_position": ToolSpec(
        name="get_market_position",
        description="Get market position analysis: how the user's profile compares to job market demand.",
        params={},
        write=False,
    ),
    "get_skill_suggestions": ToolSpec(
        name="get_skill_suggestions",
        description="Get forgotten or missing skills that appear in target jobs but not in the user's profile.",
        params={},
        write=False,
    ),
    "get_applications": ToolSpec(
        name="get_applications",
        description="Get the user's job applications list.",
        params={},
        write=False,
    ),
    "get_rejections": ToolSpec(
        name="get_rejections",
        description="Get rejected applications with reasons.",
        params={},
        write=False,
    ),
    "get_contacts": ToolSpec(
        name="get_contacts",
        description="Get the user's networking contacts.",
        params={},
        write=False,
    ),
    "get_companies": ToolSpec(
        name="get_companies",
        description="Get the user's tracked companies.",
        params={},
        write=False,
    ),
    "search_jobs": ToolSpec(
        name="search_jobs",
        description="Search stored scraped jobs by query.",
        params={
            "query": {"type": "str", "required": True, "max_len": 200},
            "limit": {"type": "int", "required": False, "default": 5},
        },
        write=False,
    ),
    "get_job_verdict": ToolSpec(
        name="get_job_verdict",
        description="Get a job quality verdict with ghost-job risk score.",
        params={
            "job_id": {"type": "str", "required": True, "max_len": 100},
        },
        write=False,
    ),
    "get_resume_for_audit": ToolSpec(
        name="get_resume_for_audit",
        description="Load a specific resume for ATS analysis. Pass 'master' for the master resume or a resume_id.",
        params={
            "resume_id": {"type": "str", "required": True, "max_len": 100},
        },
        write=False,
    ),
    "get_evidence": ToolSpec(
        name="get_evidence",
        description="Get evidence counters for a skill: resume mentions vs job-dataset percentage.",
        params={
            "skill": {"type": "str", "required": True, "max_len": 100},
        },
        write=False,
    ),
    "create_application": ToolSpec(
        name="create_application",
        description="Add a new job application to the tracker.",
        params={
            "job_description": {"type": "str", "required": True, "max_len": 5000},
            "company": {"type": "str", "required": False, "max_len": 200},
            "role": {"type": "str", "required": False, "max_len": 200},
            "resume_id": {"type": "str", "required": True, "max_len": 100},
            "status": {"type": "str", "required": False, "default": "saved"},
        },
        write=True,
        summary_template="Create application: {role} at {company}",
    ),
    "update_application_status": ToolSpec(
        name="update_application_status",
        description="Update the status of a job application.",
        params={
            "application_id": {"type": "str", "required": True, "max_len": 100},
            "status": {"type": "str", "required": True, "max_len": 30},
        },
        write=True,
        summary_template="Update application {application_id} to {status}",
    ),
    "create_skill": ToolSpec(
        name="create_skill",
        description="Add a new skill to the user's career profile.",
        params={
            "name": {"type": "str", "required": True, "max_len": 100},
            "category": {"type": "str", "required": False, "max_len": 50},
        },
        write=True,
        summary_template="Add skill: {name}",
    ),
    "create_contact": ToolSpec(
        name="create_contact",
        description="Add a new networking contact.",
        params={
            "name": {"type": "str", "required": True, "max_len": 200},
            "company": {"type": "str", "required": False, "max_len": 200},
            "relationship": {"type": "str", "required": False, "max_len": 100},
        },
        write=True,
        summary_template="Add contact: {name}",
    ),
    "create_followup": ToolSpec(
        name="create_followup",
        description="Set a follow-up date for a contact.",
        params={
            "contact_id": {"type": "str", "required": True, "max_len": 100},
            "follow_up_date": {"type": "str", "required": True, "max_len": 30},
        },
        write=True,
        summary_template="Set follow-up for {contact_id} on {follow_up_date}",
    ),
}


def get_tool_catalog_json(mode: str | None = None) -> list[dict[str, Any]]:
    """Return tool catalog as JSON-serializable list, optionally filtered by mode."""
    from app.prompts import CHAT_MODE_CONFIGS

    allowlist: list[str] = []
    if mode and mode in CHAT_MODE_CONFIGS:
        allowlist = CHAT_MODE_CONFIGS[mode].get("allowlist", [])

    result = []
    for name, spec in TOOL_CATALOG.items():
        if allowlist and name not in allowlist:
            continue
        result.append({
            "name": spec.name,
            "description": spec.description,
            "params": spec.params,
            "write": spec.write,
        })
    return result


def validate_tool_args(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize tool arguments. Raises ValueError on invalid."""
    spec = TOOL_CATALOG.get(name)
    if spec is None:
        raise ValueError(f"Unknown tool: {name}")

    validated: dict[str, Any] = {}
    for param_name, param_spec in spec.params.items():
        if param_spec["required"] and param_name not in args:
            raise ValueError(f"Missing required parameter '{param_name}' for tool '{name}'")
        value = args.get(param_name, param_spec.get("default"))
        if value is not None:
            max_len = param_spec.get("max_len")
            if max_len and isinstance(value, str) and len(value) > max_len:
                value = value[:max_len]
            if param_spec["type"] == "int":
                try:
                    value = int(value)
                except (ValueError, TypeError):
                    raise ValueError(f"Parameter '{param_name}' must be an integer")
            validated[param_name] = value
        elif "default" in param_spec:
            validated[param_name] = param_spec["default"]
    return validated


async def execute_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a validated tool call. Read tools execute; write tools raise confirmation."""
    spec = TOOL_CATALOG.get(name)
    if spec is None:
        raise ValueError(f"Unknown tool: {name}")

    validated = validate_tool_args(name, args)

    if spec.write:
        summary = spec.summary_template.format(**validated)
        raise ToolRequiresConfirmation(name, validated, summary)

    return await _execute_read_tool(name, validated)


async def _execute_read_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a read-only tool."""
    try:
        if name == "get_career_summary":
            return await _get_career_summary()
        elif name == "get_ats_audit":
            return await _get_ats_audit(args.get("resume_id"))
        elif name == "get_funnel_stats":
            return await _get_funnel_stats()
        elif name == "get_skill_roi":
            return await _get_skill_roi()
        elif name == "get_market_position":
            return await _get_market_position()
        elif name == "get_skill_suggestions":
            return await _get_skill_suggestions()
        elif name == "get_applications":
            return await _get_applications()
        elif name == "get_rejections":
            return await _get_rejections()
        elif name == "get_contacts":
            return await _get_contacts()
        elif name == "get_companies":
            return await _get_companies()
        elif name == "search_jobs":
            return await _search_jobs(args["query"], args.get("limit", 5))
        elif name == "get_job_verdict":
            return await _get_job_verdict(args["job_id"])
        elif name == "get_evidence":
            from app.services.chat_audit import get_evidence
            return await get_evidence(args["skill"])
        elif name == "get_resume_for_audit":
            return await _get_resume_for_audit(args["resume_id"])
        else:
            return {"error": f"Unknown read tool: {name}"}
    except Exception as e:
        logger.error("Tool execution failed for %s: %s", name, e)
        return {"error": str(e)}


async def _get_career_summary() -> dict[str, Any]:
    """RAG-powered career summary — retrieves relevant chunks, not full dump."""
    from app.services.rag import rag_index
    profile = await db.get_career_profile() or {}
    skills = await db.list_career_skills()

    # Use RAG to retrieve relevant resume chunks
    try:
        results = await rag_index.query(
            "career profile skills experience",
            include_jobs=False,
            include_memories=False,
            top_k=5,
            rerank=False,
        )
        resume_chunks = [c.text for c, _ in results.get("resumes", [])]
        skill_chunks = [c.text for c, _ in results.get("skills", [])]
    except Exception:
        resume_chunks = []
        skill_chunks = []

    return {
        "name": profile.get("name"),
        "title": profile.get("title"),
        "skills": [s.get("name") for s in skills[:20]],
        "target_roles": profile.get("target_roles", []),
        "resume_highlights": resume_chunks[:3],
        "skill_details": skill_chunks[:3],
    }


async def _get_ats_audit(resume_id: str | None = None) -> dict[str, Any]:
    """Run deterministic resume audit. If no resume_id, return available resumes for selection."""
    from app.services.chat_audit import compute_resume_audit

    if resume_id:
        # Audit specific resume
        if resume_id == "master":
            resume = await db.get_master_resume()
        else:
            resume = await db.get_resume(resume_id)
        if not resume:
            return {"error": f"Resume not found: {resume_id}"}
        resume_data = resume.get("processed_data") or {}
        if not resume_data:
            return {"error": f"Resume has no processed data. Please re-upload and process the resume first."}
        result = await compute_resume_audit(resume_data)
        result["resume_id"] = resume.get("resume_id")
        result["resume_title"] = resume.get("title") or resume.get("filename") or "Untitled"
        return result

    # No resume_id — return list for user to pick
    resumes = await db.list_resumes()
    if not resumes:
        return {"error": "No resumes found. Upload a resume first."}
    if len(resumes) == 1:
        # Only one resume — audit it directly
        resume = resumes[0]
        resume_data = resume.get("processed_data") or {}
        if not resume_data:
            return {"error": f"Resume '{resume.get('title') or resume.get('filename')}' has no processed data. Please re-upload and process it first."}
        result = await compute_resume_audit(resume_data)
        result["resume_id"] = resume.get("resume_id")
        result["resume_title"] = resume.get("title") or resume.get("filename") or "Untitled"
        return result

    # Multiple resumes — present selection
    return {
        "needs_selection": True,
        "prompt": "Which resume would you like to audit?",
        "resumes": [
            {
                "resume_id": r.get("resume_id"),
                "title": r.get("title") or r.get("filename") or "Untitled",
                "is_master": r.get("is_master", False),
                "has_data": bool(r.get("processed_data")),
            }
            for r in resumes
        ],
    }


async def _get_funnel_stats() -> dict[str, Any]:
    """Get application funnel statistics."""
    from app.services.career_profile import compute_funnel_stats, get_career_insights
    applications = await db.list_applications()
    funnel = compute_funnel_stats(applications)
    insights = await get_career_insights()
    return {"funnel": funnel, "stats": insights.get("stats"), "narrative": insights.get("narrative")}


async def _get_skill_roi() -> dict[str, Any]:
    """Get skill ROI analysis."""
    from app.services.career_profile import compute_skill_roi
    jobs = await db.list_scraped_jobs_for_analysis()
    profile_skills = await db.list_career_skills()
    rows, _note = compute_skill_roi(jobs, profile_skills)
    return {"roi_table": rows[:15]}


async def _get_market_position() -> dict[str, Any]:
    """Get market position (deterministic model)."""
    from app.services.market_position import compute_market_position
    skills = await db.list_career_skills()
    certs = await db.list_career_certifications()
    profile = await db.get_career_profile() or {}
    work_exp = profile.get("work_experience", [])
    projects = await db.list_career_projects()
    return compute_market_position(
        skills=skills,
        certifications=certs,
        work_experience=work_exp,
        projects=projects,
    )


async def _get_skill_suggestions() -> dict[str, Any]:
    """Get forgotten/missing skill suggestions."""
    from app.services.career_profile import generate_skill_suggestions
    suggestions = await generate_skill_suggestions()
    return {"suggestions": (suggestions or [])[:10]}


async def _get_applications() -> dict[str, Any]:
    """Get all applications."""
    apps = await db.list_applications()
    return {
        "total": len(apps),
        "applications": [
            {
                "application_id": a.get("application_id"),
                "company": a.get("company"),
                "role": a.get("role"),
                "status": a.get("status"),
                "applied_at": a.get("applied_at"),
            }
            for a in apps[:50]
        ],
    }


async def _get_rejections() -> dict[str, Any]:
    """Get rejected applications."""
    apps = await db.list_applications()
    rejected = [a for a in apps if a.get("status") == "rejected"]
    return {
        "total": len(rejected),
        "rejections": [
            {
                "company": a.get("company"),
                "role": a.get("role"),
                "rejection_reason": a.get("rejection_reason"),
                "interview_rounds": a.get("interview_rounds"),
            }
            for a in rejected[:20]
        ],
    }


async def _get_contacts() -> dict[str, Any]:
    """Get networking contacts."""
    contacts = await db.list_contacts()
    return {
        "total": len(contacts),
        "contacts": [
            {
                "contact_id": c.get("contact_id"),
                "name": c.get("name"),
                "company": c.get("company"),
                "relationship": c.get("relationship"),
                "status": c.get("status"),
                "follow_up_date": c.get("follow_up_date"),
            }
            for c in contacts[:50]
        ],
    }


async def _get_companies() -> dict[str, Any]:
    """Get tracked companies."""
    companies = await db.list_companies()
    return {
        "total": len(companies),
        "companies": [
            {
                "company_id": c.get("company_id"),
                "name": c.get("name"),
                "industry": c.get("industry"),
                "status": c.get("status"),
            }
            for c in companies[:50]
        ],
    }


async def _search_jobs(query: str, limit: int = 5) -> dict[str, Any]:
    """RAG-powered job search — hybrid vector + keyword search."""
    from app.services.rag import rag_index
    try:
        results = await rag_index.query(
            query,
            include_resumes=False,
            include_memories=False,
            include_skills=False,
            top_k=limit,
            rerank=True,
        )
        jobs = results.get("jobs", [])
        return {
            "total": len(jobs),
            "jobs": [
                {
                    "job_id": chunk.source_id,
                    "title": chunk.metadata.get("title", ""),
                    "company": chunk.metadata.get("company", ""),
                    "score": round(score, 3),
                }
                for chunk, score in jobs
            ],
        }
    except Exception:
        # Fallback to keyword search
        all_jobs = await db.list_scraped_jobs_for_analysis()
        query_lower = query.lower()
        matches = [
            j for j in all_jobs
            if query_lower in (j.get("title") or "").lower()
            or query_lower in (j.get("company") or "").lower()
            or query_lower in (j.get("description") or "").lower()
        ]
        return {
            "total": len(matches),
            "jobs": [
                {
                    "job_id": j.get("job_id"),
                    "title": j.get("title"),
                    "company": j.get("company"),
                    "location": j.get("location"),
                }
                for j in matches[:limit]
            ],
        }


async def _get_job_verdict(job_id: str) -> dict[str, Any]:
    """Get a job quality verdict."""
    from app.services.job_intel import analyze_job
    master = await db.get_master_resume()
    master_id = master.get("resume_id") if master else ""
    if not master_id:
        return {"error": "No master resume found"}
    return await analyze_job(job_id, master_id)


async def _get_resume_for_audit(resume_id: str) -> dict[str, Any]:
    """Load a specific resume for ATS analysis."""
    if resume_id == "master":
        resume = await db.get_master_resume()
    else:
        resume = await db.get_resume(resume_id)
    if not resume:
        return {"error": f"Resume not found: {resume_id}"}
    processed = resume.get("processed_data") or {}
    return {
        "resume_id": resume.get("resume_id"),
        "title": resume.get("title"),
        "is_master": resume.get("is_master"),
        "sections": {
            "personalInfo": processed.get("personalInfo"),
            "summary": processed.get("summary"),
            "workExperience": [
                {"company": w.get("company"), "title": w.get("title"), "bullets": len(w.get("description", []))}
                for w in processed.get("workExperience", [])
            ],
            "education": [
                {"institution": e.get("institution"), "degree": e.get("degree")}
                for e in processed.get("education", [])
            ],
            "projects": [
                {"name": p.get("name"), "bullets": len(p.get("description", []))}
                for p in processed.get("personalProjects", [])
            ],
        },
    }
