"""JD-matched career projects for the tailored resume.

The tailoring pipeline can replace the resume's Projects section with
career-graph projects that match the job description. Two entry points:

- ``suggest_matched_projects``: top-N candidate matches with scores, shown to
  the user in the tailor UI so they can choose before tailoring.
- ``merge_matched_projects``: applies the replacement — either the user's
  explicit selection (``selected_names``) or the auto top-2 fallback.

Matching is deterministic (keyword scoring over name, role, description,
languages, README and linked skills); only the description writing is
delegated to the LLM — one batched call producing a single
"Problem -> Solution -> Result" phrase per project (action-verb led,
work-experience style) grounded strictly in each project's evidence. Every
entry point is no-op-safe: without a key, without matches, or on any LLM
failure, the improved resume is returned unchanged.
"""

import copy
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.config_cache import get_content_language
from app.llm import complete_json, get_llm_config
from app.prompts import MATCHED_PROJECTS_PROMPT, get_language_name

logger = logging.getLogger(__name__)

_MAX_SUGGESTED_PROJECTS = 2
_MAX_SUGGESTIONS = 5
_MAX_USER_SELECTED_PROJECTS = 4
_MAX_README_CHARS = 2000
_MAX_BULLET_CHARS = 300
_MIN_BULLETS = 1
_MAX_BULLETS = 1
_MAX_DESC_BULLETS_IN_EVIDENCE = 6

# Same metric pattern the diff verifier uses: percentages, multipliers, money.
_METRIC_RE = re.compile(r"\d+%|\d+x|\$\d+")


@dataclass
class MatchedProject:
    """A career project selected for the tailored resume."""

    project: dict[str, Any]
    already_in_resume: bool


def _llm_configured() -> bool:
    """Whether an LLM is available for bullet generation."""
    try:
        config = get_llm_config()
        return bool(config.api_key) or config.provider in ("ollama", "openai_compatible")
    except Exception:
        return False


def _output_language() -> str:
    """Full language name for the content language (prompt convention)."""
    return get_language_name(get_content_language())


def _keyword_terms(job_keywords: dict[str, Any]) -> list[str]:
    """Casefolded, de-duplicated keyword terms from the job description."""
    terms: list[str] = []
    for key in ("required_skills", "preferred_skills", "keywords"):
        for item in job_keywords.get(key) or []:
            if isinstance(item, str) and len(item.strip()) >= 2:
                terms.append(item.strip().casefold())
    return list(dict.fromkeys(terms))


def score_project(project: dict[str, Any], terms: list[str]) -> int:
    """Score a career project against keyword terms (0 when no terms hit).

    Weights: name x3, role/description/skills x2, languages/readme x1.
    """
    if not terms or not isinstance(project, dict):
        return 0
    name = str(project.get("name") or "").casefold()
    role = str(project.get("role") or "").casefold()
    desc_text = " ".join(
        str(b) for b in (project.get("description") or []) if str(b).strip()
    ).casefold()
    lang_text = " ".join(
        str(l) for l in (project.get("languages") or []) if str(l).strip()
    ).casefold()
    readme = str(project.get("readme") or "")[:_MAX_README_CHARS].casefold()
    skills_text = " ".join(
        str(s) for s in (project.get("skills") or []) if str(s).strip()
    ).casefold()

    score = 0
    for term in terms:
        if term in name:
            score += 3
        if term in role:
            score += 2
        if term in desc_text:
            score += 2
        if term in skills_text:
            score += 2
        if term in lang_text:
            score += 1
        if term in readme:
            score += 1
    return score


def suggest_matched_projects(
    career_projects: list[dict[str, Any]],
    resume_projects: list[dict[str, Any]],
    job_keywords: dict[str, Any],
    limit: int = _MAX_SUGGESTIONS,
) -> list[tuple[MatchedProject, int]]:
    """Top ``limit`` career projects matching the job, with their scores.

    Deterministic only — the LLM never picks projects. Projects already
    present in the resume (matched case-insensitively by name) are flagged
    with ``already_in_resume`` so the UI and merge can distinguish "replace
    the bullets" from "add a brand-new entry".
    """
    terms = _keyword_terms(job_keywords)
    if not terms:
        return []
    existing_names = _existing_resume_names(resume_projects)
    scored = [
        (project, score_project(project, terms))
        for project in career_projects
        if isinstance(project, dict)
    ]
    scored = [(project, s) for project, s in scored if s > 0]
    scored.sort(key=lambda item: item[1], reverse=True)
    suggestions: list[tuple[MatchedProject, int]] = []
    seen_names: set[str] = set()
    for project, score in scored:
        name_cf = str(project.get("name") or "").casefold()
        if not name_cf or name_cf in seen_names:
            continue
        seen_names.add(name_cf)
        suggestions.append(
            (
                MatchedProject(
                    project=project,
                    already_in_resume=name_cf in existing_names,
                ),
                score,
            )
        )
        if len(suggestions) >= limit:
            break
    return suggestions


def select_matched_projects(
    career_projects: list[dict[str, Any]],
    resume_projects: list[dict[str, Any]],
    job_keywords: dict[str, Any],
    max_suggested: int = _MAX_SUGGESTED_PROJECTS,
) -> list[MatchedProject]:
    """Top ``max_suggested`` career projects matching the job, highest score first.

    Projects already present in the resume (matched case-insensitively by
    name) are flagged with ``already_in_resume`` so the merge can keep their
    entry identity while replacing the description bullets.
    """
    return [
        match
        for match, _score in suggest_matched_projects(
            career_projects, resume_projects, job_keywords, max_suggested
        )
    ]


def _existing_resume_names(resume_projects: list[dict[str, Any]]) -> set[str]:
    return {
        str(project.get("name") or "").casefold()
        for project in resume_projects
        if isinstance(project, dict)
    }


def select_by_name(
    career_projects: list[dict[str, Any]],
    resume_projects: list[dict[str, Any]],
    selected_names: list[str],
    cap: int = _MAX_USER_SELECTED_PROJECTS,
) -> list[MatchedProject]:
    """The user's chosen career projects, in selection order (capped).

    Unknown names are skipped; duplicates are de-duplicated. Empty result
    means none of the requested projects exist in the career graph.
    """
    if not selected_names:
        return []
    existing_names = _existing_resume_names(resume_projects)
    by_name: dict[str, dict[str, Any]] = {}
    for project in career_projects:
        if not isinstance(project, dict):
            continue
        name_cf = str(project.get("name") or "").casefold()
        if name_cf:
            by_name[name_cf] = project
    selected: list[MatchedProject] = []
    seen: set[str] = set()
    for name in selected_names:
        name_cf = str(name).strip().casefold()
        if not name_cf or name_cf in seen:
            continue
        project = by_name.get(name_cf)
        if project is None:
            continue
        seen.add(name_cf)
        selected.append(
            MatchedProject(project=project, already_in_resume=name_cf in existing_names)
        )
        if len(selected) >= cap:
            break
    return selected


def _project_payload(project: dict[str, Any]) -> dict[str, Any]:
    """Shrink a career project to the evidence the LLM may use."""
    return {
        "name": str(project.get("name") or ""),
        "role": str(project.get("role") or ""),
        "years": str(project.get("years") or ""),
        "github": str(project.get("github") or ""),
        "website": str(project.get("website") or ""),
        "languages": [str(l) for l in (project.get("languages") or [])],
        "description": [
            str(b)
            for b in (project.get("description") or [])
            if str(b).strip()
        ][:_MAX_DESC_BULLETS_IN_EVIDENCE],
        "readme": str(project.get("readme") or "")[:_MAX_README_CHARS],
    }


def _job_context(job_keywords: dict[str, Any]) -> str:
    """Compact JD keyword summary for the bullet-generation prompt."""
    sections: list[str] = []
    for key, label in (
        ("required_skills", "Required skills"),
        ("preferred_skills", "Preferred skills"),
        ("keywords", "Keywords"),
    ):
        values = [
            str(v)
            for v in (job_keywords.get(key) or [])
            if isinstance(v, str) and v.strip()
        ]
        if values:
            sections.append(f"{label}: " + ", ".join(values[:15]))
    return "\n".join(sections) or "No keyword context available."


def _normalize_bullets_response(
    raw: dict[str, Any] | None,
) -> dict[str, list[str]]:
    """Defensively normalize the LLM bullets JSON to {name: [bullets]}.

    Bullets are trimmed to single-spaced, de-duplicated rows of at most
    ``_MAX_BULLET_CHARS`` characters (overlong rows are truncated at the
    last word boundary, never dropped — a lost phrase would silently remove
    a project the user picked). Projects are only kept when they carry
    ``_MIN_BULLETS``..``_MAX_BULLETS`` usable rows so an empty or bloated
    response cannot reach the resume. Keys are casefolded names.
    """
    result: dict[str, list[str]] = {}
    if not isinstance(raw, dict):
        return result
    entries = raw.get("projects")
    if not isinstance(entries, list):
        return result
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        raw_bullets = entry.get("description")
        if not name or not isinstance(raw_bullets, list):
            continue
        bullets: list[str] = []
        for bullet in raw_bullets:
            if not isinstance(bullet, str):
                continue
            cleaned = " ".join(bullet.split())
            if not cleaned:
                continue
            if len(cleaned) > _MAX_BULLET_CHARS:
                cleaned = _truncate_bullet(cleaned, _MAX_BULLET_CHARS)
            if cleaned not in bullets:
                bullets.append(cleaned)
        if _MIN_BULLETS <= len(bullets) <= _MAX_BULLETS:
            result[name.casefold()] = bullets
    return result


def _truncate_bullet(bullet: str, max_chars: int) -> str:
    """Cut a bullet at the last word boundary within ``max_chars``."""
    if len(bullet) <= max_chars:
        return bullet
    cut = bullet[:max_chars]
    boundary = cut.rfind(" ")
    if boundary > 0:
        cut = cut[:boundary]
    return cut


async def generate_project_bullets(
    projects: list[dict[str, Any]],
    job_keywords: dict[str, Any],
    language: str | None = None,
) -> dict[str, list[str]]:
    """LLM single "Problem -> Solution -> Result" phrase per project ({} when off)."""
    if not projects or not _llm_configured():
        return {}
    prompt = MATCHED_PROJECTS_PROMPT.format(
        projects=json.dumps(
            [_project_payload(project) for project in projects],
            ensure_ascii=False,
        ),
        job_context=_job_context(job_keywords),
        output_language=get_language_name(language) if language else _output_language(),
    )
    raw = await complete_json(prompt, max_tokens=2048, schema_type="project_bullets")
    return _normalize_bullets_response(raw)


def _invented_metrics_warnings(
    matched: list[MatchedProject],
    used_bullets: dict[str, list[str]],
) -> list[str]:
    """Warn about metrics in generated bullets absent from the evidence."""
    warnings: list[str] = []
    for match in matched:
        project = match.project
        name_cf = str(project.get("name") or "").casefold()
        bullets = used_bullets.get(name_cf)
        if not bullets:
            continue
        evidence = " ".join(
            str(b) for b in (project.get("description") or [])
        ) + " " + str(project.get("readme") or "")
        for bullet in bullets:
            invented = set(_METRIC_RE.findall(bullet)) - set(_METRIC_RE.findall(evidence))
            if invented:
                warnings.append(
                    "Possible invented metric in project "
                    f"'{project.get('name')}': {', '.join(sorted(invented))}"
                )
    return warnings


async def merge_matched_projects(
    original_data: dict[str, Any] | None,
    improved_data: dict[str, Any],
    career_projects: list[dict[str, Any]],
    job_keywords: dict[str, Any],
    language: str | None = None,
    max_suggested: int = _MAX_SUGGESTED_PROJECTS,
    selected_names: list[str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Replace the tailored resume's Projects section with JD-matched projects.

    When ``selected_names`` is provided (non-empty), exactly those career
    projects are used, in the given order (capped by ``_MAX_USER_SELECTED_PROJECTS``);
    otherwise the top ``max_suggested`` auto-matches are used.

    Returns (improved_data, warnings). No-op safe: without matches, without
    career projects, or on any failure, the input data is returned unchanged.
    """
    warnings: list[str] = []
    if not isinstance(improved_data, dict):
        return improved_data, warnings
    original_projects = (original_data or {}).get("personalProjects") or []
    if not isinstance(original_projects, list):
        original_projects = []
    if not career_projects:
        return improved_data, warnings

    if selected_names:
        matched = select_by_name(career_projects, original_projects, selected_names)
    else:
        matched = select_matched_projects(
            career_projects, original_projects, job_keywords, max_suggested
        )
    if not matched:
        return improved_data, warnings

    try:
        bullets = await generate_project_bullets(
            [match.project for match in matched], job_keywords, language
        )
    except Exception as e:
        logger.warning("Matched-project bullet generation failed: %s", e)
        bullets = {}

    new_projects: list[dict[str, Any]] = []
    used_bullets: dict[str, list[str]] = {}
    for match in matched:
        project = match.project
        name = str(project.get("name") or "").strip()
        if not name:
            continue
        entry_bullets = bullets.get(name.casefold())
        if entry_bullets is None:
            # No LLM output (off, failed, or malformed): keep the existing
            # bullets when the project already ships in the resume, otherwise
            # skip it — an entry with no description would weaken the resume.
            if match.already_in_resume:
                entry_bullets = [
                    str(b)
                    for b in (project.get("description") or [])
                    if str(b).strip()
                ]
            else:
                continue
        if not entry_bullets:
            continue
        new_projects.append(
            {
                "id": 0,
                "name": name,
                "role": str(project.get("role") or ""),
                "years": str(project.get("years") or ""),
                "github": project.get("github"),
                "website": project.get("website"),
                "description": entry_bullets,
                "descriptionStyles": ["bullet"] * len(entry_bullets),
            }
        )
        used_bullets[name.casefold()] = entry_bullets

    if not new_projects:
        return improved_data, warnings

    result = copy.deepcopy(improved_data)
    result["personalProjects"] = new_projects
    warnings.extend(_invented_metrics_warnings(matched, used_bullets))
    warnings.append(
        f"Projects section replaced with {len(new_projects)} job-matched "
        "project(s) from your career profile"
    )
    return result, warnings
