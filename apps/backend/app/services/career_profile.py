"""Career profile aggregation: memory bundle, funnel stats and skill ROI.

Keeps the deterministic math (funnel statistics, salary parsing, ROI scoring)
in pure functions so tests can exercise them without a database; only the
memory bundle and GitHub summaries touch ``db`` / the network.

The memory bundle and the insights narrative are cached in-process keyed on a
database fingerprint (see ``db.career_data_fingerprint``): any write to the
tables feeding the bundle changes the stamp and invalidates the cache, so the
LLM features never serve stale data and repeat reads skip redundant work
(e.g. the gap-analysis LLM call only runs when the data actually changed).
"""

import copy
import json
import logging
import re
from collections import Counter
from datetime import datetime
from typing import Any

from app.config_cache import get_content_language
from app.database import APPLICATION_STATUSES, db
from app.llm import complete, get_llm_config
from app.prompts import get_language_name
from app.prompts.templates import (
    CAREER_ADVISOR_PROMPT,
    CAREER_ADVISOR_SYSTEM_PROMPT,
    CAREER_GAP_ANALYSIS_PROMPT,
    CAREER_ROI_ADVICE_PROMPT,
)
from app.services.improver import _sanitize_user_input

logger = logging.getLogger(__name__)

# Context budget caps so the memory bundle fits comfortably in the LLM window.
_MAX_MASTER_RESUME_CHARS = 6000
_MAX_JD_CHARS = 1500
_MAX_REJECTED_APPS = 20
_MAX_JOBS_IN_MEMORY = 25
_MAX_CONTACTS_IN_MEMORY = 50
_MAX_GITHUB_REPOS = 10
_MAX_ROI_ROWS = 25
_MAX_ROI_TABLE_ROWS_FOR_ADVICE = 10

# Canonical skill catalog for ROI: aliases (word-boundary matched against job
# descriptions) and a coarse learning-effort heuristic. Skills not listed get a
# neutral "medium" effort and their name itself as the only search term.
_SKILL_CATALOG: dict[str, dict[str, Any]] = {
    "Kubernetes": {"aliases": ["k8s"], "effort": "high"},
    "Docker": {"aliases": ["docker"], "effort": "low"},
    "AWS": {"aliases": ["amazon web services", "amazon aws"], "effort": "medium"},
    "Azure": {"aliases": ["microsoft azure"], "effort": "medium"},
    "GCP": {"aliases": ["google cloud"], "effort": "medium"},
    "Terraform": {"aliases": [], "effort": "medium"},
    "Ansible": {"aliases": [], "effort": "low"},
    "Python": {"aliases": [], "effort": "low"},
    "Java": {"aliases": [], "effort": "medium"},
    "Go": {"aliases": ["golang"], "effort": "medium"},
    "Rust": {"aliases": [], "effort": "high"},
    "TypeScript": {"aliases": ["ts"], "effort": "low"},
    "JavaScript": {"aliases": ["js", "es6"], "effort": "low"},
    "React": {"aliases": ["react.js", "reactjs"], "effort": "low"},
    "Vue": {"aliases": ["vue.js", "vuejs"], "effort": "low"},
    "Angular": {"aliases": [], "effort": "medium"},
    "Node.js": {"aliases": ["node", "nodejs"], "effort": "low"},
    "Next.js": {"aliases": ["nextjs"], "effort": "low"},
    "GraphQL": {"aliases": [], "effort": "medium"},
    "SQL": {"aliases": [], "effort": "low"},
    "PostgreSQL": {"aliases": ["postgres"], "effort": "low"},
    "MySQL": {"aliases": [], "effort": "low"},
    "MongoDB": {"aliases": ["mongo"], "effort": "low"},
    "Redis": {"aliases": [], "effort": "low"},
    "Kafka": {"aliases": ["apache kafka"], "effort": "medium"},
    "RabbitMQ": {"aliases": [], "effort": "low"},
    "Elasticsearch": {"aliases": ["elastic"], "effort": "medium"},
    "Spark": {"aliases": ["apache spark", "pyspark"], "effort": "high"},
    "Hadoop": {"aliases": [], "effort": "high"},
    "Airflow": {"aliases": ["apache airflow"], "effort": "medium"},
    "dbt": {"aliases": [], "effort": "medium"},
    "Snowflake": {"aliases": [], "effort": "medium"},
    "BigQuery": {"aliases": [], "effort": "medium"},
    "Databricks": {"aliases": [], "effort": "high"},
    "TensorFlow": {"aliases": ["tf"], "effort": "high"},
    "PyTorch": {"aliases": [], "effort": "high"},
    "scikit-learn": {"aliases": ["sklearn"], "effort": "medium"},
    "pandas": {"aliases": [], "effort": "low"},
    "LangChain": {"aliases": ["langchain"], "effort": "medium"},
    "FastAPI": {"aliases": [], "effort": "low"},
    "Django": {"aliases": [], "effort": "medium"},
    "Flask": {"aliases": [], "effort": "low"},
    "Spring": {"aliases": ["spring boot"], "effort": "medium"},
    "C#": {"aliases": ["csharp", ".net core"], "effort": "medium"},
    "C++": {"aliases": [], "effort": "high"},
    "Ruby": {"aliases": [], "effort": "medium"},
    "PHP": {"aliases": [], "effort": "low"},
    "Swift": {"aliases": [], "effort": "medium"},
    "Kotlin": {"aliases": [], "effort": "medium"},
    "Linux": {"aliases": [], "effort": "low"},
    "Git": {"aliases": [], "effort": "low"},
    "GitLab": {"aliases": [], "effort": "low"},
    "Prometheus": {"aliases": [], "effort": "medium"},
    "Grafana": {"aliases": [], "effort": "low"},
    "OpenTelemetry": {"aliases": ["otel"], "effort": "medium"},
    "Cypress": {"aliases": [], "effort": "low"},
    "Jest": {"aliases": [], "effort": "low"},
    "Pytest": {"aliases": [], "effort": "low"},
    "Tableau": {"aliases": [], "effort": "medium"},
    "Power BI": {"aliases": ["powerbi"], "effort": "medium"},
    "LLM": {"aliases": ["large language model", "llms"], "effort": "high"},
}


def _llm_configured() -> bool:
    """Whether an LLM is available for chat / insight generation."""
    try:
        config = get_llm_config()
        return bool(config.api_key) or config.provider in ("ollama", "openai_compatible")
    except Exception:
        return False


def compute_funnel_stats(applications: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute deterministic rejection-learning statistics.

    Pure function over the tracker applications so it is unit-testable.
    """
    by_status = {status: 0 for status in APPLICATION_STATUSES}
    for app in applications:
        status = app.get("status")
        if status in by_status:
            by_status[status] += 1

    total = len(applications)
    rejected = by_status["rejected"]
    interviewed = by_status["interview"]
    accepted = by_status["accepted"]

    # Conversion denominators: applications that actually left the gate.
    advanced = sum(
        by_status[s]
        for s in ("applied", "no_response", "response", "interview", "accepted", "rejected")
    )

    def _rate(numerator: int, denominator: int) -> float:
        return round(numerator / denominator, 3) if denominator else 0.0

    # Median days from application to reaching "interview" (via updated_at).
    days: list[float] = []
    for app in applications:
        if app.get("status") != "interview":
            continue
        try:
            applied = datetime.fromisoformat(app["applied_at"]) if app.get("applied_at") else None
            updated = datetime.fromisoformat(app["updated_at"]) if app.get("updated_at") else None
            if applied and updated:
                days.append((updated - applied).total_seconds() / 86400.0)
        except (ValueError, TypeError):
            continue
    median_days = _median(days)

    top_companies = [
        {"company": name, "count": count}
        for name, count in Counter(
            app.get("company") for app in applications if app.get("company")
        ).most_common(5)
    ]

    rejection_reasons = [
        {"reason": reason, "count": count}
        for reason, count in Counter(
            app.get("rejection_reason")
            for app in applications
            if app.get("status") == "rejected" and app.get("rejection_reason")
        ).most_common(8)
    ]

    return {
        "total": total,
        "by_status": by_status,
        "rejected": rejected,
        "interviewed": interviewed,
        "accepted": accepted,
        "rejection_rate": _rate(rejected, advanced),
        "applied_to_interview_rate": _rate(interviewed, advanced),
        "interview_to_accepted_rate": _rate(accepted, interviewed),
        "median_days_to_interview": round(median_days, 1) if median_days is not None else None,
        "top_companies": top_companies,
        "rejection_reasons": rejection_reasons,
    }


def _median(values: list[float]) -> float | None:
    """Median of a list (None when empty)."""
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


_CURRENCY_RE = re.compile(r"([$€£])")
_NUMBER_RE = re.compile(r"(\d[\d,]*)([kKmM])\b|(\d[\d,]*(?:\.\d+)?)")
_THOUSANDS_SUFFIX = {"k": 1_000, "m": 1_000_000}


def _parse_salary(raw: str | None) -> tuple[int, int, str] | None:
    """Parse a salary string into (low, high, currency) midpoints.

    Accepts "80,000 - 100,000", "$80k-$100k", "€60K", "45000", … The two
    numbers are treated as (min, max); a single number yields (n, n).
    Returns None when nothing parseable is present.
    """
    if not raw:
        return None
    text = raw.replace("\u2013", "-").replace("\u2014", "-")
    currency = _CURRENCY_RE.search(text)
    currency_code = currency.group(1) if currency else "?"

    numbers: list[int] = []
    for match in _NUMBER_RE.finditer(text):
        whole, suffix, bare = match.group(1), match.group(2), match.group(3)
        value_str = whole if whole else bare
        value = float(value_str.replace(",", ""))
        if whole and suffix:
            value *= _THOUSANDS_SUFFIX[suffix.lower()]
        numbers.append(int(value))
    if not numbers:
        return None
    if len(numbers) >= 2:
        return (min(numbers), max(numbers), currency_code)
    return (numbers[0], numbers[0], currency_code)


def _median_salary_midpoint(jobs: list[dict[str, Any]]) -> float | None:
    """Median of per-job salary midpoints across parseable jobs."""
    mids = []
    for job in jobs:
        parsed = _parse_salary(job.get("salary"))
        if parsed is not None:
            low, high, _currency = parsed
            mids.append((low + high) / 2.0)
    return _median(mids)


def _skill_search_terms(skill: str) -> list[str]:
    """Word-boundary search terms for a skill (canonical name + aliases)."""
    entry = _SKILL_CATALOG.get(skill, {})
    return [skill] + list(entry.get("aliases", []))


def _matches_description(description: str, terms: list[str]) -> bool:
    lowered = description.lower()
    return any(
        re.search(rf"\b{re.escape(term.lower())}\b", lowered) is not None
        for term in terms
        if len(term) >= 2
    )


def compute_skill_roi(
    jobs: list[dict[str, Any]],
    profile_skills: list[dict[str, Any]],
    requested_skills: list[str] | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """Score skills over the saved job pool. Pure function; returns (rows, note).

    Auto-detected skills (no ``requested_skills``) are the profile's own
    skills plus catalog skills mentioned in at least one job description
    that are missing from the profile. Profile skills are always included
    (even with no matching job yet) so the user sees ROI for what they know.
    """
    pool = [job for job in jobs if job.get("description")]
    if not pool:
        return [], "No saved job descriptions yet. Save scraped jobs to power the ROI engine."

    profile_names = {skill.get("name", "").lower() for skill in profile_skills}
    proficiency = {
        skill.get("name", "").lower(): skill.get("proficiency") or 0 for skill in profile_skills
    }

    if requested_skills:
        candidates = [name.strip() for name in requested_skills if name.strip()]
    else:
        candidates = []
        seen: set[str] = set()
        # Profile skills first — the user wants ROI for what they already know.
        for skill in profile_skills:
            name = str(skill.get("name", "")).strip()
            key = name.lower()
            if name and key not in seen:
                candidates.append(name)
                seen.add(key)
        # Then catalog skills missing from the profile that appear in jobs.
        for name in _SKILL_CATALOG:
            if (
                name.lower() not in seen
                and name.lower() not in profile_names
                and any(
                    _matches_description(job["description"], _skill_search_terms(name))
                    for job in pool
                )
            ):
                candidates.append(name)
                seen.add(name.lower())

    pool_median = _median_salary_midpoint(pool)
    rows: list[dict[str, Any]] = []
    for skill in candidates:
        terms = _skill_search_terms(skill)
        matching = [job for job in pool if _matches_description(job["description"], terms)]
        if not matching and requested_skills is not None:
            continue

        jobs_unlocked_pct = round(len(matching) / len(pool) * 100.0, 1)

        salary_impact: float | None = None
        if pool_median and len(matching) >= 3:
            match_median = _median_salary_midpoint(matching)
            if match_median is not None:
                salary_impact = round((match_median - pool_median) / pool_median * 100.0, 1)

        effort = _SKILL_CATALOG.get(skill, {}).get("effort", "medium")
        existing_knowledge = int(
            min(proficiency.get(skill.lower(), 0), 5) / 5.0 * 100.0
        )

        # Weighted ROI: 35% demand, 25% salary, 20% learning ease, 20% existing.
        salary_term = (
            50.0 if salary_impact is None
            else min(max(salary_impact, -50.0), 100.0) / 150.0 * 100.0
        )
        effort_ease = {"low": 1.0, "medium": 0.6, "high": 0.3}.get(effort, 0.6)
        roi = round(
            0.35 * min(jobs_unlocked_pct, 100.0)
            + 0.25 * salary_term
            + 0.20 * effort_ease * 100.0
            + 0.20 * existing_knowledge
        )
        roi = min(max(roi, 0), 100)

        rows.append(
            {
                "skill": skill,
                "jobs_unlocked_pct": jobs_unlocked_pct,
                "matching_jobs": len(matching),
                "salary_impact_pct": salary_impact,
                "learning_effort": effort,
                "existing_knowledge": existing_knowledge,
                "roi_score": roi,
            }
        )

    rows.sort(key=lambda row: row["roi_score"], reverse=True)
    return rows[:_MAX_ROI_ROWS], None


def _roi_table_markdown(rows: list[dict[str, Any]]) -> str:
    lines = [
        "| Skill | Jobs unlocked | Salary impact | Learning effort | Existing knowledge | ROI |",
        "|---|---|---|---|---|---|",
    ]
    for row in rows:
        salary = f"{row['salary_impact_pct']:+.0f}%" if row["salary_impact_pct"] is not None else "n/a"
        lines.append(
            f"| {row['skill']} | {row['jobs_unlocked_pct']:.0f}% | {salary} | "
            f"{row['learning_effort']} | {row['existing_knowledge']} | {row['roi_score']} |"
        )
    return "\n".join(lines)


_SUGGESTION_MAX = 20

# Career-goal templates per content language; role titles are filled in.
_GOAL_TEMPLATES: dict[str, tuple[str, str]] = {
    "en": ("Advance to {role}", "Become a {role}"),
    "fr": ("Évoluer vers {role}", "Devenir {role}"),
    "es": ("Avanzar hacia {role}", "Convertirse en {role}"),
    "pt": ("Avançar para {role}", "Tornar-se {role}"),
    "de": ("Aufstieg zum {role}", "Werden Sie {role}"),
    "zh": ("晋升为{role}", "成为{role}"),
    "ja": ("{role}へ昇進する", "{role}になる"),
    "ko": ("{role}(으)로 승진하기", "{role}이(가) 되기"),
}


def _dedupe_case_insensitive(items: list[str]) -> list[str]:
    """Strip, drop empties and dedupe case-insensitively, preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        stripped = item.strip()
        key = stripped.lower()
        if stripped and key not in seen:
            seen.add(key)
            result.append(stripped)
    return result


def build_profile_suggestions(
    field: str,
    jobs: list[dict[str, Any]],
    profile: dict[str, Any] | None,
) -> list[str]:
    """Suggestions for profile tag fields, derived from scraped jobs and the
    career profile's own work experience (roles/locations). Pure function.

    ``field`` is one of ``career_goals``, ``target_roles`` or
    ``target_locations``. Career goals are role-derived templates localized to
    the configured content language. Never raises for empty data.
    """
    roles: list[str] = []
    locations: list[str] = []
    for job in jobs:
        if job.get("title"):
            roles.append(str(job["title"]))
        if job.get("location"):
            locations.append(str(job["location"]))

    work = (profile or {}).get("work_experience") or []
    for entry in work:
        if entry.get("role"):
            roles.append(str(entry["role"]))
        if entry.get("location"):
            locations.append(str(entry["location"]))

    if field == "target_roles":
        return _dedupe_case_insensitive(roles)[:_SUGGESTION_MAX]
    if field == "target_locations":
        return _dedupe_case_insensitive(locations)[:_SUGGESTION_MAX]

    templates = _GOAL_TEMPLATES.get(get_content_language(), _GOAL_TEMPLATES["en"])
    goals: list[str] = []
    for role in _dedupe_case_insensitive(roles)[:12]:
        goals.extend(template.format(role=role) for template in templates)
    return _dedupe_case_insensitive(goals)[:_SUGGESTION_MAX]


async def _github_repo_summaries() -> list[dict[str, Any]]:
    """Best-effort GitHub repo summaries for the memory bundle (never raises)."""
    try:
        from app.routers.github import _cached_repos, _get_token, _github_api

        cached = _cached_repos()
        if cached is not None:
            return [
                {
                    "name": repo.name,
                    "description": (repo.description or "")[:300],
                    "language": repo.languages[0] if repo.languages else None,
                    "topics": repo.topics[:5],
                }
                for repo in cached.repos[: _MAX_GITHUB_REPOS]
            ]

        token = await _get_token()
        if not token:
            return []
        raw = await _github_api(
            "https://api.github.com/user/repos?per_page=20&sort=updated", token
        )
        if not isinstance(raw, list):
            return []
        return [
            {
                "name": repo.get("name", ""),
                "description": (repo.get("description") or "")[:300],
                "language": repo.get("language"),
                "topics": (repo.get("topics") or [])[:5],
            }
            for repo in raw[: _MAX_GITHUB_REPOS]
        ]
    except Exception:
        logger.debug("GitHub repo summaries unavailable for career memory", exc_info=True)
        return []


_career_memory_cache: dict[str, Any] | None = None
_career_memory_stamp: str | None = None

_insights_cache: tuple[str, dict[str, Any], str | None] | None = None


async def build_career_memory() -> dict[str, Any]:
    """Aggregate the career-memory bundle, cached until the data changes.

    The cache is keyed on the database fingerprint: any write to a table
    feeding the bundle (applications, scraped jobs, career profile/skills/
    certifications, contacts, resumes, API keys) changes the stamp and forces
    a rebuild, so chat/insights never serve stale data.
    """
    global _career_memory_cache, _career_memory_stamp
    stamp = await db.career_data_fingerprint()
    if _career_memory_stamp == stamp and _career_memory_cache is not None:
        return copy.deepcopy(_career_memory_cache)
    memory = await _build_career_memory_uncached()
    # The builder may materialize state (e.g. auto-create the profile row), so
    # re-key the cache on the post-build stamp — otherwise it would never hit.
    stamp = await db.career_data_fingerprint()
    _career_memory_stamp = stamp
    _career_memory_cache = copy.deepcopy(memory)
    return memory


async def _build_career_memory_uncached() -> dict[str, Any]:
    """Aggregate the full career-memory bundle (chat + insights + memory API)."""
    profile = await db.get_career_profile()
    if profile is None:
        profile = await db.create_career_profile()
    skills = await db.list_career_skills()
    certifications = await db.list_career_certifications()

    master: dict[str, Any] | None = None
    master_row = await db.get_master_resume()
    if master_row is not None:
        master = {
            "resume_id": master_row.get("resume_id"),
            "title": master_row.get("title"),
            "content": (master_row.get("content") or "")[:_MAX_MASTER_RESUME_CHARS],
            "processed_data": master_row.get("processed_data"),
        }

    applications = await db.list_applications()
    funnel = compute_funnel_stats(applications)
    rejected = [
        {
            "company": app.get("company"),
            "role": app.get("role"),
            "applied_at": app.get("applied_at"),
            "rejection_reason": app.get("rejection_reason"),
            "interview_rounds": app.get("interview_rounds"),
            "notes": (app.get("notes") or "")[:300],
        }
        for app in applications
        if app.get("status") == "rejected"
    ][:_MAX_REJECTED_APPS]

    contacts = [
        {
            "name": contact.get("name"),
            "company": contact.get("company"),
            "relationship": contact.get("relationship"),
            "status": contact.get("status"),
            "goal": contact.get("goal"),
            "follow_up_date": contact.get("follow_up_date"),
        }
        for contact in await db.list_contacts()
    ][:_MAX_CONTACTS_IN_MEMORY]

    jobs = [
        {
            "title": job.get("title"),
            "company": job.get("company"),
            "location": job.get("location"),
            "salary": job.get("salary"),
            "experience_level": job.get("experience_level"),
            "description": _sanitize_user_input(
                (job.get("description") or "")[:_MAX_JD_CHARS]
            ),
        }
        for job in await db.list_scraped_jobs_for_analysis()
    ][:_MAX_JOBS_IN_MEMORY]

    return {
        "profile": profile,
        "skills": skills,
        "certifications": certifications,
        "master_resume": master,
        "funnel": funnel,
        "rejected_applications": rejected,
        "contacts": contacts,
        "scraped_jobs": jobs,
        "github_repos": await _github_repo_summaries(),
    }


def _format_history(history: list[dict[str, str]]) -> str:
    """Compact chat history for the advisor prompt (role: content lines)."""
    if not history:
        return ""
    return "\n".join(f"{item['role']}: {item['content']}" for item in history)


def _output_language() -> str:
    """Full language name for the content language (prompt convention)."""
    return get_language_name(get_content_language())


async def answer_career_question(
    question: str, history: list[dict[str, str]]
) -> str:
    """Run the career advisor chat turn; returns the Markdown answer."""
    memory = await build_career_memory()
    prompt = CAREER_ADVISOR_PROMPT.format(
        career_memory=json.dumps(memory, ensure_ascii=False)[:35_000],
        question=_sanitize_user_input(question),
        output_language=_output_language(),
    )
    if history:
        prompt += f"\n\nPREVIOUS CONVERSATION:\n{_format_history(history)}\n"
    return await complete(
        prompt,
        system_prompt=CAREER_ADVISOR_SYSTEM_PROMPT,
        max_tokens=4096,
    )


async def generate_gap_analysis() -> str | None:
    """LLM rejection-learning narrative over the memory bundle (None if off)."""
    if not _llm_configured():
        return None
    memory = await build_career_memory()
    prompt = CAREER_GAP_ANALYSIS_PROMPT.format(
        career_memory=json.dumps(memory, ensure_ascii=False)[:35_000],
        funnel_stats=json.dumps(memory["funnel"], ensure_ascii=False),
        output_language=_output_language(),
    )
    return await complete(prompt, max_tokens=1024)


async def get_career_insights() -> dict[str, Any]:
    """Funnel stats + optional LLM narrative, cached per data snapshot.

    The narrative (an LLM call) is generated at most once per snapshot; repeat
    loads of the Overview tab are served from the cache until the underlying
    data changes. On LLM failure (or when no key is configured) the narrative
    degrades to ``None`` without breaking the stats.
    """
    global _insights_cache
    stamp = await db.career_data_fingerprint()
    if _insights_cache is not None and _insights_cache[0] == stamp:
        _, stats, narrative = _insights_cache
        return {"stats": copy.deepcopy(stats), "narrative": narrative}

    memory = await build_career_memory()
    # Same re-key as the memory builder: the bundle may have materialized
    # rows, so the stamp captured above would never match again.
    stamp = await db.career_data_fingerprint()
    narrative = None
    try:
        narrative = await generate_gap_analysis()
    except Exception as e:
        logger.error("Gap analysis failed: %s", e)
    _insights_cache = (stamp, copy.deepcopy(memory["funnel"]), narrative)
    return {"stats": copy.deepcopy(memory["funnel"]), "narrative": narrative}


async def generate_roi_advice(rows: list[dict[str, Any]]) -> str | None:
    """LLM 'learn next' recommendation over the ROI table (None if off)."""
    if not _llm_configured() or not rows:
        return None
    table = _roi_table_markdown(rows[:_MAX_ROI_TABLE_ROWS_FOR_ADVICE])
    prompt = CAREER_ROI_ADVICE_PROMPT.format(
        roi_table=table,
        output_language=_output_language(),
    )
    return await complete(prompt, max_tokens=512)
