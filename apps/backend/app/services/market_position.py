"""Market Position Score: deterministic percentile model of the user's
market standing, built entirely from local profile data.

No external data and no LLM: each tracked skill is scored from the evidence
the user entered (proficiency, years, last-used date, matching
certifications) and the composite score is mapped through a modeled
candidate distribution into a percentile. Skills are aggregated into job
domains (Backend, Frontend, Cloud & DevOps, Data & ML, System Design) whose
percentiles blend skill strength with matched work-experience years and
matched projects. The model also names the user's exact current role
(seniority + domain + specialization) and recommends the best-fit roles to
pick from the profile's own evidence. A verdict sentence summarizes the
position, where the user is strong, where senior roles are out of reach and
the best next picks. Everything is a pure function, so the model is fully
unit-testable and works with the LLM switched off.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

# ---------------------------------------------------------------------------
# Model constants (the "market" baseline)
# ---------------------------------------------------------------------------

# Composite score -> market-percentile curve (piecewise linear). A score of
# 50 (a typical mid-level candidate) maps to the 50th percentile; the curve
# is deliberately conservative at the top so only genuinely strong evidence
# clears the 80th percentile.
_SCORE_PERCENTILE_CURVE: list[tuple[float, float]] = [
    (0, 5),
    (20, 15),
    (40, 30),
    (50, 50),
    (60, 65),
    (70, 78),
    (80, 88),
    (90, 95),
    (100, 99),
]

# Years of experience -> evidence score (piecewise linear, input capped).
_YEARS_CURVE: list[tuple[float, float]] = [
    (0, 5),
    (1, 25),
    (2, 45),
    (3, 60),
    (5, 75),
    (8, 88),
    (12, 100),
]

# Number of matched projects -> evidence score (piecewise linear, capped).
# Projects are secondary evidence: a handful is a strong signal, but they
# never substitute for tracked skills or role-title years.
_PROJECTS_CURVE: list[tuple[float, float]] = [
    (0, 0),
    (1, 30),
    (2, 50),
    (3, 65),
    (5, 80),
    (8, 90),
    (12, 100),
]

# Years since last use -> recency score (piecewise linear).
_RECENCY_CURVE: list[tuple[float, float]] = [
    (0, 100),
    (1, 100),
    (2, 80),
    (3, 60),
    (4, 40),
    (5, 25),
    (6, 10),
    (10, 5),
]

_YEARS_CAP = 20
_PROJECTS_CAP = 12

# Readme preview length considered when matching a project to a domain.
_README_PREVIEW_CHARS = 2000

# Weights of the per-skill evidence fields; weights of missing fields are
# dropped and the remaining ones renormalized (missing data is never scored
# as weakness). Certifications are always evaluated (0 or 100).
_SKILL_WEIGHTS: dict[str, float] = {
    "proficiency": 0.40,
    "years": 0.30,
    "recency": 0.20,
    "certs": 0.10,
}

# Word-boundary keywords used to group skills and role titles into domains.
_DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "Backend": [
        "backend",
        "server",
        "api",
        "microservice",
        "database",
        "node",
        "python",
        "java",
        "go",
        "rust",
        "c#",
        "dotnet",
        "fastapi",
        "nestjs",
        "spring",
        "sql",
        "postgresql",
        "mysql",
        "mongodb",
        "redis",
        "kafka",
        "graphql",
        "elasticsearch",
    ],
    "Frontend": [
        "frontend",
        "ui",
        "react",
        "vue",
        "css",
        "html",
        "angular",
        "svelte",
        "next",
        "typescript",
        "javascript",
    ],
    "Cloud & DevOps": [
        "devops",
        "infrastructure",
        "ci/cd",
        "kubernetes",
        "docker",
        "aws",
        "gcp",
        "azure",
        "terraform",
        "prometheus",
        "grafana",
        "linux",
        "git",
        "ansible",
        "jenkins",
    ],
    "Data & ML": [
        "data",
        "ml",
        "machine learning",
        "ai",
        "analytics",
        "spark",
        "hadoop",
        "airflow",
        "dbt",
        "snowflake",
        "bigquery",
        "databricks",
        "tensorflow",
        "pytorch",
        "pandas",
        "scikit-learn",
        "langchain",
        "tableau",
        "power bi",
    ],
    "System Design": [
        "architecture",
        "architect",
        "system",
        "design",
        "distributed",
        "scalability",
        "microservice",
        "kafka",
        "kubernetes",
        "load balancing",
        "caching",
        "lead",
        "senior",
        "principal",
        "staff",
    ],
}

# Senior-level requirements per domain: (display phrase, matching keywords).
# A gate is "missing" when no tracked skill with a >=50th percentile covers
# its keywords — the honest reading of "no senior evidence in the profile".
_SENIOR_GATES: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "Backend": [
        ("distributed systems", ("kafka", "microservice", "distributed", "event-driven")),
        ("event-driven architectures", ("kafka", "rabbitmq", "event-driven", "streaming")),
    ],
    "Frontend": [
        ("performance optimization", ("performance", "web vitals", "bundling")),
        ("testing at scale", ("cypress", "jest", "testing")),
    ],
    "Cloud & DevOps": [
        ("Kubernetes", ("kubernetes", "k8s")),
        ("infrastructure as code", ("terraform", "ansible", "infrastructure as code")),
    ],
    "Data & ML": [
        ("ML at scale", ("spark", "databricks", "mlflow", "feature", "distributed")),
        ("production ML pipelines", ("airflow", "mlflow", "pipelines", "mlops")),
    ],
    "System Design": [
        ("distributed systems", ("distributed", "kafka", "microservice", "event-driven")),
        ("scalability patterns", ("scalability", "load balancing", "caching", "sharding")),
    ],
}

# Strong / adequate / underqualified verdict thresholds (domain percentiles).
_STRONG_PERCENTILE = 60
_WEAK_PERCENTILE = 40

# Cap on tracked skills surfaced in the response (ranked by percentile).
_MAX_SKILLS = 12

# Cap on recommended roles surfaced in the response (ranked by match).
_MAX_ROLE_PICKS = 5

# Domains below this percentile are too weak to suggest roles from.
_ROLE_MIN_DOMAIN_PERCENTILE = 20

# Cap on specialization skills named in the response.
_MAX_SPECIALIZATIONS = 3

# Skills below this percentile are not named as a specialization.
_SPECIALIZATION_MIN_PERCENTILE = 40

# Default role title used to name the current position per domain.
_DOMAIN_ROLE: dict[str, str] = {
    "Backend": "Backend Engineer",
    "Frontend": "Frontend Developer",
    "Cloud & DevOps": "DevOps Engineer",
    "Data & ML": "Data Engineer",
    "System Design": "Software Engineer",
}

# Role titles recommended per domain, with the keywords that mark a skill
# as evidence for that specific role (used for overlap scoring).
_ROLE_CATALOG: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "Backend": [
        ("Python Developer", ("python", "django", "flask", "fastapi")),
        ("Node.js Developer", ("node", "express", "nestjs")),
        ("Java Developer", ("java", "spring", "hibernate")),
        ("Go Developer", ("go", "golang")),
        ("Database Engineer", ("database", "sql", "postgresql", "mysql", "mongodb", "redis")),
        ("API Developer", ("api", "graphql", "rest")),
        ("Backend Engineer", ("backend", "api", "microservice", "server")),
    ],
    "Frontend": [
        ("React Developer", ("react", "next", "next.js", "redux")),
        ("Vue Developer", ("vue", "nuxt")),
        ("Angular Developer", ("angular", "rxjs")),
        ("TypeScript Developer", ("typescript", "javascript", "js", "ts")),
        ("Frontend Developer", ("frontend", "ui", "html", "css")),
    ],
    "Cloud & DevOps": [
        ("DevOps Engineer", ("devops", "ci/cd", "jenkins", "github actions")),
        ("Site Reliability Engineer", ("sre", "reliability", "observability", "prometheus", "grafana")),
        ("Cloud Engineer", ("aws", "gcp", "azure", "cloud")),
        ("Platform Engineer", ("kubernetes", "k8s", "docker", "terraform", "platform")),
    ],
    "Data & ML": [
        ("Data Engineer", ("data", "etl", "spark", "airflow", "dbt", "warehouse")),
        ("Data Scientist", ("ml", "machine learning", "tensorflow", "pytorch", "scikit-learn")),
        ("ML Engineer", ("ml", "machine learning", "mlops", "pipelines", "pytorch", "tensorflow")),
        ("Data Analyst", ("analytics", "tableau", "power bi", "dashboard")),
    ],
    "System Design": [
        ("System Architect", ("architect", "architecture", "design", "scalability")),
        ("Software Engineer", ("software", "system", "architecture", "distributed")),
    ],
}

_YEAR_RANGE_RE = re.compile(r"(\d{4})\s*[-–—]\s*(\d{4}|present|now)", re.IGNORECASE)
_DURATION_RE = re.compile(r"(\d{1,2})\s*(?:years?|yrs?|ans?)", re.IGNORECASE)
_LAST_USED_RE = re.compile(r"(\d{4})(?:-(\d{2}))?")


def _interpolate(curve: list[tuple[float, float]], value: float) -> float:
    """Piecewise-linear interpolation over (x, y) points, clamped at the ends."""
    if value <= curve[0][0]:
        return curve[0][1]
    if value >= curve[-1][0]:
        return curve[-1][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= value <= x1:
            span = x1 - x0 or 1.0
            return y0 + (y1 - y0) * (value - x0) / span
    return curve[-1][1]


def _word_matches(text: str, terms: list[str]) -> bool:
    """Word-boundary match of any term against the text (case-insensitive)."""
    lowered = text.lower()
    return any(
        re.search(rf"\b{re.escape(term.lower())}\b", lowered) is not None
        for term in terms
        if len(term) >= 2
    )


def _project_matches(project: dict[str, Any], terms: list[str]) -> bool:
    """Whether a project node matches domain terms (any of its text fields).

    Name, role, description lines, languages and a readme preview are all
    considered, so a project counts as domain evidence even when its title
    alone is ambiguous.
    """
    texts = [str(project.get("name") or ""), str(project.get("role") or "")]
    texts.extend(str(item) for item in (project.get("description") or []))
    texts.extend(str(item) for item in (project.get("languages") or []))
    readme = str(project.get("readme") or "")
    if readme:
        texts.append(readme[:_README_PREVIEW_CHARS])
    return any(_word_matches(text, terms) for text in texts if text)


def _recency_score(last_used: str, current_year: int) -> float | None:
    """Years since last use -> recency score (None when unparseable)."""
    match = _LAST_USED_RE.fullmatch(last_used.strip())
    if not match:
        return None
    year = int(match.group(1))
    if year < 1990 or year > current_year:
        return None
    return _interpolate(_RECENCY_CURVE, float(current_year - year))


def _cert_matches(skill_name: str, certification_names: list[str]) -> bool:
    """Whether any certification name mentions the skill (word boundary)."""
    needle = skill_name.lower().strip()
    if len(needle) < 2 or not certification_names:
        return False
    return any(
        re.search(rf"\b{re.escape(needle)}\b", cert.lower()) is not None
        for cert in certification_names
        if cert
    )


def _skill_composite(
    skill: dict[str, Any],
    certification_names: list[str],
    current_year: int,
) -> float | None:
    """0-100 evidence score for one tracked skill (None when no evidence)."""
    present: dict[str, float] = {}
    proficiency = skill.get("proficiency")
    if proficiency is not None:
        present["proficiency"] = min(max(float(proficiency), 0.0), 5.0) / 5.0 * 100.0
    years = skill.get("years_experience")
    if years is not None:
        present["years"] = _interpolate(_YEARS_CURVE, min(max(float(years), 0.0), _YEARS_CAP))
    last_used = skill.get("last_used")
    if last_used:
        recency = _recency_score(str(last_used), current_year)
        if recency is not None:
            present["recency"] = recency
    if not present:
        return None

    cert_score = 100.0 if _cert_matches(str(skill.get("name") or ""), certification_names) else 0.0
    numerator = sum(_SKILL_WEIGHTS[key] * value for key, value in present.items())
    denominator = sum(_SKILL_WEIGHTS[key] for key in present) + _SKILL_WEIGHTS["certs"]
    return (numerator + _SKILL_WEIGHTS["certs"] * cert_score) / denominator


def _score_to_percentile(score: float) -> float:
    """Map a 0-100 composite score through the modeled market distribution."""
    return _interpolate(_SCORE_PERCENTILE_CURVE, min(max(score, 0.0), 100.0))


def _percentile_level(percentile: float) -> str:
    if percentile < 30:
        return "beginner"
    if percentile < 60:
        return "intermediate"
    if percentile < 85:
        return "advanced"
    return "expert"


def _entry_years(entry: dict[str, Any], current_year: int) -> float:
    """Duration in years for one work-experience entry (1.0 when unparseable)."""
    raw = str(entry.get("years") or "").strip()
    if not raw:
        return 1.0
    duration = _DURATION_RE.search(raw)
    if duration:
        return min(float(duration.group(1)), _YEARS_CAP)
    span = _YEAR_RANGE_RE.search(raw)
    if span:
        start = int(span.group(1))
        end_text = span.group(2).lower()
        end = current_year if end_text in ("present", "now") else int(end_text)
        if 1950 <= start <= end <= current_year + 1:
            return min(max(float(end - start), 0.0), _YEARS_CAP)
    return 1.0


def _domain_evidence(
    domain: str,
    skills: list[dict[str, Any]],
    skill_positions: dict[str, float],
    work_experience: list[dict[str, Any]],
    projects: list[dict[str, Any]],
    current_year: int,
) -> tuple[float | None, float, bool]:
    """Evidence for one domain: (avg skill percentile, experience score, has any).

    The experience score blends matched role-title years with matched project
    count (projects weighted 35%). ``has_any`` is True when at least one work
    entry's role *or* one project matched the domain, so title/project-only
    evidence can never be confused with no evidence.
    """
    terms = _DOMAIN_KEYWORDS[domain]
    member_pcts = [
        skill_positions[skill["name"]]
        for skill in skills
        if skill["name"] in skill_positions
        and _word_matches(str(skill["name"]), terms)
    ]
    skill_avg = sum(member_pcts) / len(member_pcts) if member_pcts else None

    matched_entries = [
        entry for entry in work_experience if _word_matches(str(entry.get("role") or ""), terms)
    ]
    years = sum(_entry_years(entry, current_year) for entry in matched_entries)
    years_score = _interpolate(_YEARS_CURVE, min(years, _YEARS_CAP))

    matched_projects = [project for project in projects if _project_matches(project, terms)]
    projects_score = _interpolate(
        _PROJECTS_CURVE, min(float(len(matched_projects)), _PROJECTS_CAP)
    )
    experience_score = 0.65 * years_score + 0.35 * projects_score
    return skill_avg, experience_score, bool(matched_entries) or bool(matched_projects)


def _domain_percentile(
    skill_avg: float | None,
    experience_score: float,
    has_any: bool,
) -> int | None:
    """Aggregate a domain's percentile (None when the domain has no evidence)."""
    if skill_avg is not None:
        return round(0.7 * skill_avg + 0.3 * experience_score)
    if not has_any:
        return None
    # Titles and projects alone get partial credit — skills are the primary evidence.
    return round(experience_score * 0.7)


def _seniority_band(percentile: float) -> str:
    if percentile < _WEAK_PERCENTILE:
        return "junior"
    if percentile < 70:
        return "mid"
    return "senior"


def _readiness(percentile: float) -> str:
    if percentile >= 70:
        return "strong"
    if percentile >= _WEAK_PERCENTILE:
        return "adequate"
    return "underqualified"


def _current_role(domains: list[dict[str, Any]]) -> str | None:
    """Exact role title for the strongest domain ("Mid Backend Engineer").

    ``domains`` must be sorted by percentile descending; None when the
    profile has no domain evidence at all.
    """
    if not domains:
        return None
    best = domains[0]
    band = _seniority_band(best["percentile"])
    return f"{band.capitalize()} {_DOMAIN_ROLE[best['domain']]}"


def _specialization(
    primary_domain: str,
    skill_positions: dict[str, float],
) -> list[str]:
    """Top tracked skills of the primary domain, ranked by percentile.

    Only skills at or above the specialization floor are named, so a weak
    skill is never claimed as the user's specialization.
    """
    terms = _DOMAIN_KEYWORDS[primary_domain]
    candidates = [
        name
        for name, percentile in skill_positions.items()
        if _word_matches(name, terms) and percentile >= _SPECIALIZATION_MIN_PERCENTILE
    ]
    candidates.sort(key=lambda name: (-skill_positions[name], name))
    return candidates[:_MAX_SPECIALIZATIONS]


def _recommend_roles(
    domains: list[dict[str, Any]],
    skills: list[dict[str, Any]],
    skill_positions: dict[str, float],
) -> list[dict[str, Any]]:
    """Best-fit role titles across the profile's domains, ranked by match.

    A role's match score blends the domain percentile (75%) with how much of
    the domain's tracked skills evidence that specific role (25%). Roles are
    only suggested from domains with enough standing to be worth picking.
    """
    recommendations: list[dict[str, Any]] = []
    for domain_row in domains:
        domain = domain_row["domain"]
        percentile = domain_row["percentile"]
        if percentile < _ROLE_MIN_DOMAIN_PERCENTILE:
            continue
        member_skills = [
            skill["name"]
            for skill in skills
            if skill["name"] in skill_positions
            and _word_matches(str(skill["name"]), _DOMAIN_KEYWORDS[domain])
        ]
        for role, keywords in _ROLE_CATALOG.get(domain, []):
            keyword_list = list(keywords)
            matching = [name for name in member_skills if _word_matches(name, keyword_list)]
            overlap = (len(matching) / len(member_skills)) * 100.0 if member_skills else 0.0
            match_score = 0.75 * percentile + 0.25 * overlap
            reason_skills = sorted(matching, key=lambda name: (-skill_positions[name], name))[:2]
            reason = (
                f"Matches your {_join_phrases(reason_skills)}"
                if reason_skills
                else f"Fits your {domain} profile"
            )
            recommendations.append(
                {
                    "role": role,
                    "domain": domain,
                    "seniority": _seniority_band(percentile),
                    "match_score": round(match_score),
                    "reason": reason,
                }
            )
    recommendations.sort(key=lambda row: (-row["match_score"], row["role"]))
    return recommendations[:_MAX_ROLE_PICKS]


def _missing_senior_gates(domain: str, skill_positions: dict[str, float]) -> list[str]:
    """Display phrases for senior requirements with no >=50th-percentile skill."""
    missing: list[str] = []
    for phrase, keywords in _SENIOR_GATES.get(domain, []):
        covered = any(
            skill_positions[skill] >= 50 and _word_matches(skill, list(keywords))
            for skill in skill_positions
        )
        if not covered:
            missing.append(phrase)
    return missing


def _join_phrases(phrases: list[str]) -> str:
    """Oxford-comma join of gate phrases for the verdict sentence."""
    if len(phrases) <= 1:
        return phrases[0] if phrases else ""
    if len(phrases) == 2:
        return f"{phrases[0]} and {phrases[1]}"
    return f"{', '.join(phrases[:-1])}, and {phrases[-1]}"


def _build_verdict(
    domains: list[dict[str, Any]],
    skill_positions: dict[str, float],
    current_role: str | None,
    specialization: list[str],
    recommended_roles: list[dict[str, Any]],
) -> str:
    """Template sentences over the domain standings.

    ``domains`` must be sorted by percentile descending. The sentence names
    the exact current role first, then states where the user is strong (when
    strong), flags senior-level requirements the profile has no evidence for
    in the weak domains, and closes with the best next role picks.
    """
    if not domains:
        return (
            "Your profile is still developing — add skills and work experience "
            "to unlock your market position."
        )

    best = domains[0]
    parts: list[str] = []

    if current_role:
        position = f"You're a {current_role}"
        if specialization:
            position += f" specializing in {_join_phrases(specialization)}"
        parts.append(f"{position}.")

    if best["percentile"] >= _STRONG_PERCENTILE:
        bands = "Mid/Senior" if best["percentile"] >= 75 else "Junior/Mid"
        parts.append(f"You're strong for {bands} {best['domain']} roles.")

    weak_gates: list[str] = []
    for domain in domains:
        if domain["percentile"] >= _WEAK_PERCENTILE:
            continue
        for phrase in _missing_senior_gates(domain["domain"], skill_positions):
            if phrase not in weak_gates:
                weak_gates.append(phrase)
        if len(weak_gates) >= 3:
            break
    weak_gates = weak_gates[:3]

    if weak_gates:
        clause = f"underqualified for Senior roles requiring {_join_phrases(weak_gates)}"
        parts.append(f"You're {clause}.")

    if recommended_roles:
        picks = [role["role"] for role in recommended_roles[:3]]
        parts.append(f"Best next picks: {_join_phrases(picks)}.")

    return " ".join(parts)


def compute_market_position(
    skills: list[dict[str, Any]],
    certifications: list[dict[str, Any]],
    work_experience: list[dict[str, Any]],
    projects: list[dict[str, Any]] | None = None,
    current_year: int | None = None,
) -> dict[str, Any]:
    """Deterministic market-position model. Pure function.

    Returns a dict with ``skills`` (tracked skills that carry at least one
    evidence field, ranked by percentile), ``domains`` (job families
    aggregating skills, role-title years and projects), ``current_role`` (the
    exact role title of the strongest domain, e.g. "Mid Backend Engineer"),
    ``specialization`` (top skills of that domain), ``recommended_roles``
    (best-fit roles to pick, with match scores), ``verdict`` (template
    sentences) and ``note``. Every percentile is an integer 0-100.
    ``current_year`` is injectable so tests are date-independent.
    """
    now = current_year if current_year is not None else datetime.now().year
    projects = projects or []
    certification_names = [str(cert.get("name") or "") for cert in certifications]

    skill_positions: dict[str, float] = {}
    for skill in skills:
        name = str(skill.get("name") or "").strip()
        if not name:
            continue
        composite = _skill_composite(skill, certification_names, now)
        if composite is None:
            continue
        skill_positions[name] = _score_to_percentile(composite)

    skill_rows = [
        {
            "skill": name,
            "percentile": round(percentile),
            "level": _percentile_level(percentile),
        }
        for name, percentile in sorted(
            skill_positions.items(), key=lambda item: (-item[1], item[0])
        )
    ][:_MAX_SKILLS]

    domain_rows: list[dict[str, Any]] = []
    for domain in _DOMAIN_KEYWORDS:
        skill_avg, experience_score, has_any = _domain_evidence(
            domain, skills, skill_positions, work_experience, projects, now
        )
        percentile = _domain_percentile(skill_avg, experience_score, has_any)
        if percentile is None:
            continue
        member_skills = [
            skill["name"]
            for skill in skills
            if skill["name"] in skill_positions
            and _word_matches(str(skill["name"]), _DOMAIN_KEYWORDS[domain])
        ]
        domain_rows.append(
            {
                "domain": domain,
                "percentile": percentile,
                "seniority": _seniority_band(percentile),
                "readiness": _readiness(percentile),
                "_skills": len(member_skills),
                "_projects": sum(
                    1 for project in projects if _project_matches(project, _DOMAIN_KEYWORDS[domain])
                ),
                "_years": sum(
                    _entry_years(entry, now)
                    for entry in work_experience
                    if _word_matches(str(entry.get("role") or ""), _DOMAIN_KEYWORDS[domain])
                ),
            }
        )
    domain_rows.sort(
        key=lambda row: (
            -row["percentile"],
            -row["_skills"],
            -row["_projects"],
            -row["_years"],
            row["domain"],
        )
    )
    for row in domain_rows:
        row.pop("_skills")
        row.pop("_projects")
        row.pop("_years")

    current_role = _current_role(domain_rows)
    primary_domain = domain_rows[0]["domain"] if domain_rows else None
    specialization = (
        _specialization(primary_domain, skill_positions) if primary_domain else []
    )
    recommended_roles = _recommend_roles(domain_rows, skills, skill_positions)

    note = None
    if not skill_rows and not domain_rows:
        note = "Add skills and work experience to see your market position."

    return {
        "skills": skill_rows,
        "domains": domain_rows,
        "current_role": current_role,
        "specialization": specialization,
        "recommended_roles": recommended_roles,
        "verdict": _build_verdict(
            domain_rows, skill_positions, current_role, specialization, recommended_roles
        ),
        "note": note,
    }