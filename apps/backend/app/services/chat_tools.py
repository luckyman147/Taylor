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
    needs_confirmation: bool = False
    summary_template: str = ""


# Tool catalog

TOOL_CATALOG: dict[str, ToolSpec] = {
    "get_career_summary": ToolSpec(
        name="get_career_summary",
        description="Get a summary of the user's career profile, skills, education, and projects.",
        params={},
        write=False,
    ),
    "compare_resumes": ToolSpec(
        name="compare_resumes",
        description="Compare all uploaded resumes side by side: titles, master status, processing status, sections, skills count, and word count.",
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
    "search_mcp_jobs": ToolSpec(
        name="search_mcp_jobs",
        description="Search for jobs across all enabled external sources (LinkedIn, Exa web search, RSS feeds, RemoteOK, Keejob, Tunisian freelance boards). Returns live job listings with title, company, location, and URL.",
        params={
            "query": {"type": "str", "required": True, "max_len": 200},
            "limit": {"type": "int", "required": False, "default": 10},
            "seniority": {"type": "str", "required": False, "default": ""},
            "location": {"type": "str", "required": False, "default": ""},
            "remote": {"type": "str", "required": False, "default": ""},
        },
        write=False,
    ),
    "list_mcp_sources": ToolSpec(
        name="list_mcp_sources",
        description="List all available MCP data sources (LinkedIn, Exa, GitHub, RSS, etc.) and their current connection status.",
        params={},
        write=False,
    ),
    "web_search": ToolSpec(
        name="web_search",
        description="Search the general web for any topic. Uses DuckDuckGo to find relevant URLs, then Crawl4AI fetches full page content. Returns titles, URLs, and rich page excerpts. Use for technology trends, news, research, or any non-job query.",
        params={
            "query": {"type": "str", "required": True, "max_len": 200},
            "num_results": {"type": "int", "required": False, "default": 8},
        },
        write=False,
    ),
}


def get_tool_catalog_json(mode: str | None = None, skills: list[str] | None = None) -> list[dict[str, Any]]:
    """Return tool catalog as JSON-serializable list, optionally filtered by mode and skills."""
    from app.prompts import CHAT_BASE_MODES, get_skill_allowlist

    # If skills are active, use their UNION allowlist
    allowlist: list[str] = []
    if skills:
        allowlist = get_skill_allowlist(skills)

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

    if spec.write or spec.needs_confirmation:
        summary = spec.summary_template.format(**validated) if spec.summary_template else f"Execute {name}"
        raise ToolRequiresConfirmation(name, validated, summary)

    return await _execute_read_tool(name, validated)


async def execute_tool_confirmed(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a write tool that has been confirmed by the user."""
    spec = TOOL_CATALOG.get(name)
    if spec is None:
        raise ValueError(f"Unknown tool: {name}")

    validated = validate_tool_args(name, args)
    return await _execute_write_tool(name, validated)


async def _execute_read_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a read-only tool."""
    try:
        if name == "get_career_summary":
            return await _get_career_summary()
        elif name == "compare_resumes":
            return await _compare_resumes()
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
        elif name == "get_job_verdict":
            return await _get_job_verdict(args["job_id"])
        elif name == "get_evidence":
            from app.services.chat_audit import get_evidence
            return await get_evidence(args["skill"])
        elif name == "get_resume_for_audit":
            return await _get_resume_for_audit(args["resume_id"])
        elif name == "search_mcp_jobs":
            return await _search_mcp_jobs(args["query"], args.get("limit", 10))
        elif name == "list_mcp_sources":
            return await _list_mcp_sources()
        elif name == "web_search":
            return await _web_search(args["query"], args.get("num_results", 8))
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
    projects = await db.list_career_projects()

    profile_source = "rag"
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
        logger.exception("Career profile RAG retrieval failed, falling back to database")
        profile_source = "database"
        resume_chunks = [
            p.get("description", "") for p in projects[:3] if p.get("description")
        ]
        skill_chunks = [
            f"{s.get('name', '')} ({s.get('category', '')})"
            for s in skills[:10] if s.get("name")
        ]

    project_list = []
    for p in projects[:8]:
        proj = {"name": p.get("name", "")}
        if p.get("role"):
            proj["role"] = p["role"]
        if p.get("languages"):
            proj["languages"] = p["languages"][:8]
        if p.get("description"):
            proj["description"] = p["description"][:3]
        project_list.append(proj)

    return {
        "name": profile.get("name"),
        "title": profile.get("title"),
        "skills": [s.get("name") for s in skills[:20]],
        "target_roles": profile.get("target_roles", []),
        "projects": project_list,
        "resume_highlights": resume_chunks[:3],
        "skill_details": skill_chunks[:3],
        "profile_source": profile_source,
    }


async def _compare_resumes() -> dict[str, Any]:
    """Compare all uploaded resumes side by side."""
    resumes = await db.list_resumes()
    if not resumes:
        return {"resumes": [], "hint": "No resumes uploaded yet."}

    result = []
    for r in resumes:
        data = r.get("processed_data") or {}
        skills = data.get("skills", [])
        work = data.get("workExperience", [])
        education = data.get("education", [])
        projects = data.get("personalProjects", [])
        summary = data.get("summary", "")
        full_text = json.dumps(data, ensure_ascii=False)
        word_count = len(full_text.split())

        sections = []
        if data.get("personalInfo"):
            sections.append("personalInfo")
        if summary:
            sections.append("summary")
        if work:
            sections.append("workExperience")
        if education:
            sections.append("education")
        if projects:
            sections.append("personalProjects")
        if skills:
            sections.append("skills")

        result.append({
            "resume_id": r.get("resume_id"),
            "title": r.get("title") or r.get("filename") or "Untitled",
            "is_master": r.get("is_master", False),
            "processing_status": r.get("processing_status", "unknown"),
            "sections": sections,
            "skills_count": len(skills),
            "work_entries": len(work),
            "education_entries": len(education),
            "project_entries": len(projects),
            "word_count": word_count,
        })

    return {"resumes": result, "total": len(result)}


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

    # Try LLM-based suggestions first
    suggestions = await generate_skill_suggestions()
    if suggestions:
        return {"suggestions": suggestions[:10], "source": "llm"}

    # Fallback: deterministic comparison against Full-Stack skill set
    profile_skills = await db.list_career_skills()
    existing = {s.get("name", "").lower() for s in profile_skills if s.get("name")}

    FULLSTACK_SKILLS = {
        "React": "Frontend framework — most in-demand UI library",
        "Next.js": "Full-stack React framework with SSR/SSG",
        "TypeScript": "Type-safe JavaScript — essential for large codebases",
        "Node.js": "Server-side JavaScript runtime",
        "PostgreSQL": "Production-grade relational database",
        "Docker": "Containerization for consistent deployments",
        "AWS": "Cloud platform — most demanded in job listings",
        "GraphQL": "API query language — preferred over REST in many roles",
        "Redis": "In-memory cache and session store",
        "Kubernetes": "Container orchestration for scaling",
        "CI/CD": "Automated testing and deployment pipelines",
        "Git": "Version control — assumed but worth confirming",
        "REST API": "Standard API design pattern",
        "Tailwind CSS": "Utility-first CSS framework",
        "Prisma": "Type-safe database ORM for Node.js",
        "Jest": "Testing framework for JavaScript",
        "Playwright": "End-to-end testing framework",
        "MongoDB": "NoSQL document database",
        "Firebase": "Backend-as-a-service for rapid prototyping",
        "Vercel": "Deployment platform for Next.js apps",
    }

    missing = []
    for skill, reason in FULLSTACK_SKILLS.items():
        if skill.lower() not in existing:
            missing.append({
                "name": skill,
                "reason": reason,
                "kind": "learn_next",
            })

    return {"suggestions": missing[:10], "source": "fallback"}


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
                "description": c.get("description"),
                "linkedin_url": c.get("linkedin_url"),
                "website_url": c.get("website_url"),
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


async def _search_mcp_jobs(query: str, limit: int = 10, seniority: str = "", location: str = "", remote: str = "") -> dict[str, Any]:
    """Search all enabled MCP sources for live job listings."""
    from app.services.job_scraper import get_mcp_manager
    from app.schemas.job_scraper import JobSearchFilters, ExperienceLevel, WorkType

    manager = get_mcp_manager()

    # Map extracted seniority to structured ExperienceLevel
    seniority_map = {
        "intern": ExperienceLevel.INTERNSHIP,
        "internship": ExperienceLevel.INTERNSHIP,
        "entry": ExperienceLevel.ENTRY,
        "entry-level": ExperienceLevel.ENTRY,
        "junior": ExperienceLevel.ENTRY,
        "mid-level": ExperienceLevel.MID_SENIOR,
        "associate": ExperienceLevel.ASSOCIATE,
        "senior": ExperienceLevel.MID_SENIOR,
        "lead": ExperienceLevel.MID_SENIOR,
        "staff": ExperienceLevel.DIRECTOR,
        "principal": ExperienceLevel.DIRECTOR,
        "head": ExperienceLevel.DIRECTOR,
        "chief": ExperienceLevel.EXECUTIVE,
    }
    experience_levels = []
    if seniority:
        level = seniority_map.get(seniority.lower())
        if level:
            experience_levels.append(level)

    # Map remote keyword to WorkType
    work_types = []
    if remote:
        rt = remote.lower().replace("work from home", "remote").replace("wfh", "remote").replace("on-site", "on_site").replace("onsite", "on_site")
        if rt == "remote":
            work_types.append(WorkType.REMOTE)
        elif rt == "hybrid":
            work_types.append(WorkType.HYBRID)
        elif rt == "on_site":
            work_types.append(WorkType.ON_SITE)

    filters = JobSearchFilters(
        keywords=query,
        experience_levels=experience_levels,
        work_types=work_types,
    )

    try:
        jobs, mcp_status = await manager.search_all(query, filters)
    except Exception as e:
        logger.error("MCP search failed: %s", e)
        return {"error": f"MCP search failed: {e}", "jobs": [], "sources": {}}

    results = []
    for job in jobs[:limit]:
        results.append({
            "title": job.title,
            "company": job.company,
            "location": job.location or "Not specified",
            "url": job.url or "",
            "source": job.source or "",
            "description_snippet": (job.description or "")[:200],
        })

    sources_status = {}
    for name, status in mcp_status.items():
        sources_status[name] = {
            "status": status.get("status", "unknown"),
            "count": status.get("count", 0),
            "error": status.get("error"),
        }

    return {
        "query": query,
        "total_results": len(jobs),
        "returned": len(results),
        "jobs": results,
        "sources": sources_status,
    }


def serialize_job(chunk: Any, score: float | None = None) -> dict[str, Any]:
    """Normalize a RAG job chunk into a consistent schema."""
    metadata = getattr(chunk, "metadata", None) or {}
    return {
        "job_id": getattr(chunk, "source_id", ""),
        "title": metadata.get("title", ""),
        "company": metadata.get("company", ""),
        "location": metadata.get("location"),
        "url": metadata.get("url") or metadata.get("link"),
        "source": metadata.get("source"),
        "description_snippet": (
            metadata.get("description_snippet")
            or metadata.get("description")
            or (getattr(chunk, "text", None) or "")[:500]
        ),
        "score": round(score, 3) if score is not None else None,
        "published_at": metadata.get("published_at"),
    }


async def _list_mcp_sources() -> dict[str, Any]:
    """List all MCP sources and their connection status."""
    from app.services.job_scraper import get_mcp_manager

    manager = get_mcp_manager()

    try:
        statuses = await manager.detect_all()
    except Exception as e:
        logger.error("MCP status check failed: %s", e)
        return {"error": str(e), "sources": {}}

    sources = {}
    for name, status in statuses.items():
        sources[name] = {
            "available": status.available,
            "enabled": status.enabled,
            "backend": status.backend,
            "details": status.details,
        }

    return {"sources": sources}


async def _web_search(query: str, num_results: int = 8) -> dict[str, Any]:
    """General web search via DuckDuckGo + Crawl4AI page fetching.

    1. DuckDuckGo finds relevant URLs (free, no API key).
    2. Crawl4AI fetches full page content as clean Markdown.
    """
    import asyncio

    # Step 1: DuckDuckGo search for URLs
    try:
        from ddgs import DDGS

        loop = asyncio.get_event_loop()
        ddgs = DDGS()
        search_results = await loop.run_in_executor(
            None,
            lambda: list(ddgs.text(query, max_results=num_results)),
        )
    except Exception as e:
        logger.error("DuckDuckGo search failed for '%s': %s", query, e)
        return {"error": str(e), "query": query, "results": []}

    if not search_results:
        return {"query": query, "total_results": 0, "results": []}

    # Build basic results from DuckDuckGo snippets
    results = []
    urls_to_crawl = []
    for item in search_results:
        url = item.get("href", "")
        title = item.get("title", "Unknown")
        snippet = item.get("body", "")
        results.append({
            "title": title,
            "url": url,
            "source": url,
            "snippet": snippet[:500],
            "published_date": None,
        })
        if url:
            urls_to_crawl.append(url)

    # Step 2: Crawl4AI fetches full page content for top results (in parallel)
    try:
        from app.services.mcp.crawl4ai import Crawl4AIAdapter

        crawler = Crawl4AIAdapter()
        if await crawler.is_available() and urls_to_crawl:
            # Crawl top results in parallel (limit to avoid overload)
            crawl_urls = urls_to_crawl[:min(num_results, 5)]
            crawled = await crawler.fetch_pages(crawl_urls)

            # Enrich results with full page content
            for r in results:
                url = r["url"]
                if url in crawled and crawled[url]:
                    # Use first 1000 chars of page content as enriched snippet
                    r["snippet"] = crawled[url][:1000]
    except Exception as e:
        logger.warning("Crawl4AI page fetch failed (using snippets only): %s", e)

    return {
        "query": query,
        "total_results": len(results),
        "results": results,
    }


async def _execute_write_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a confirmed write tool."""
    try:
        if name == "create_application":
            return await _create_application(args)
        elif name == "update_application_status":
            return await _update_application_status(args)
        elif name == "create_skill":
            return await _create_skill(args)
        elif name == "create_contact":
            return await _create_contact(args)
        elif name == "create_followup":
            return await _create_followup(args)
        else:
            return {"error": f"Unknown write tool: {name}"}
    except Exception as e:
        logger.error("Write tool execution failed for %s: %s", name, e)
        return {"error": str(e)}
