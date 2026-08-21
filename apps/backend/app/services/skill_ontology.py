"""Skill ontology and profile-driven matching core for job discovery.

Pure, deterministic functions — no database, no LLM, no network. Everything
the TAYLOR matching engine needs is built from a *profile snapshot* (skills,
experience roles, seniority band, targets) and a job description text:

- ``match_skills`` — tiered skill matching (EXACT / RELATED / ECOSYSTEM /
  UNRELATED) using the canonical skill ontology + relationship map.
- ``match_title`` — job-title matching against the role-family taxonomy.
- ``seniority_score`` — band-gap seniority scoring.
- ``classify_context`` / ``context_weight`` — required vs preferred vs
  familiarity requirement context.
- ``negative_penalty`` — profile-scoped negative-term rules (a penalty, never
  a deletion).
- ``build_search_queries`` — generates the actual search queries that fan out
  to the job sources (profile-driven, skills + experience).
- ``extract_requirements`` — deterministic requirement extraction from a JD
  (the cheap pass; an LLM upgrade runs on demand elsewhere).

Keeping this module dependency-free makes the whole engine unit-testable
without a database and keeps discovery fast (no token cost).
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Canonical skill ontology
#
# Each entry: aliases (extra surface forms found in JDs), category (used for
# ecosystem grouping), weight (importance of the skill in match scoring) and
# related (canonical skill -> RELATED tier score when that skill is present
# in the JD while the user's skill is not).
# ---------------------------------------------------------------------------

_ONTOLOGY: dict[str, dict[str, Any]] = {
    "React": {
        "aliases": ["react.js", "reactjs", "react js"],
        "category": "frontend",
        "weight": 0.9,
        "related": {"React Native": 0.55, "Next.js": 0.75},
    },
    "Next.js": {
        "aliases": ["nextjs", "next js"],
        "category": "frontend",
        "weight": 0.85,
        "related": {"React": 0.8},
    },
    "TypeScript": {
        "aliases": ["typescript", "ts"],
        "category": "frontend",
        "weight": 0.85,
        "related": {"JavaScript": 0.85, "NestJS": 0.7},
    },
    "JavaScript": {
        "aliases": ["javascript", "js", "es6"],
        "category": "frontend",
        "weight": 0.85,
        "related": {"TypeScript": 0.85, "Node.js": 0.8},
    },
    "Vue": {
        "aliases": ["vue.js", "vuejs"],
        "category": "frontend",
        "weight": 0.8,
        "related": {"JavaScript": 0.8},
    },
    "Angular": {
        "aliases": ["angularjs", "angular 2"],
        "category": "frontend",
        "weight": 0.8,
        "related": {"TypeScript": 0.8},
    },
    "Tailwind CSS": {
        "aliases": ["tailwind"],
        "category": "frontend",
        "weight": 0.7,
        "related": {"CSS": 0.85},
    },
    "CSS": {
        "aliases": ["css3"],
        "category": "frontend",
        "weight": 0.7,
        "related": {"SCSS": 0.9, "HTML": 0.85},
    },
    "SCSS": {
        "aliases": ["sass"],
        "category": "frontend",
        "weight": 0.7,
        "related": {"CSS": 0.9},
    },
    "HTML": {
        "aliases": ["html5"],
        "category": "frontend",
        "weight": 0.6,
        "related": {"CSS": 0.85},
    },
    "Node.js": {
        "aliases": ["node", "nodejs", "node js"],
        "category": "backend",
        "weight": 0.9,
        "related": {"Express.js": 0.85, "NestJS": 0.85, "TypeScript": 0.7, "JavaScript": 0.8},
    },
    "NestJS": {
        "aliases": ["nestjs", "nest js"],
        "category": "backend",
        "weight": 0.9,
        "related": {"Node.js": 0.85, "TypeScript": 0.7, "JavaScript": 0.6},
    },
    "Express.js": {
        "aliases": ["express", "expressjs"],
        "category": "backend",
        "weight": 0.8,
        "related": {"Node.js": 0.85, "TypeScript": 0.6},
    },
    "Django": {
        "aliases": ["django rest framework", "drf"],
        "category": "backend",
        "weight": 0.85,
        "related": {"Python": 0.85, "FastAPI": 0.7, "Flask": 0.75},
    },
    "Flask": {
        "aliases": [],
        "category": "backend",
        "weight": 0.75,
        "related": {"Python": 0.85, "Django": 0.75},
    },
    "FastAPI": {
        "aliases": [],
        "category": "backend",
        "weight": 0.9,
        "related": {"Python": 0.85, "Flask": 0.65, "Django": 0.7},
    },
    "Spring Boot": {
        "aliases": ["spring"],
        "category": "backend",
        "weight": 0.85,
        "related": {"Java": 0.85},
    },
    "Python": {
        "aliases": [],
        "category": "backend",
        "weight": 0.9,
        "related": {"FastAPI": 0.7, "Django": 0.7, "Flask": 0.65, "Node.js": 0.5},
    },
    "Java": {
        "aliases": [],
        "category": "backend",
        "weight": 0.85,
        "related": {"Spring Boot": 0.85, "Kotlin": 0.7},
    },
    "Go": {
        "aliases": ["golang"],
        "category": "backend",
        "weight": 0.85,
        "related": {"Node.js": 0.6},
    },
    "Rust": {
        "aliases": [],
        "category": "backend",
        "weight": 0.85,
        "related": {"Go": 0.6, "C++": 0.7},
    },
    "C#": {
        "aliases": ["csharp", ".net core", "dotnet"],
        "category": "backend",
        "weight": 0.85,
        "related": {".NET": 0.9},
    },
    ".NET": {
        "aliases": [".net framework", "asp.net", "asp.net core", "dotnet"],
        "category": "backend",
        "weight": 0.85,
        "related": {"C#": 0.9},
    },
    "C++": {
        "aliases": ["cpp"],
        "category": "backend",
        "weight": 0.85,
        "related": {"C#": 0.7, "Rust": 0.7},
    },
    "Ruby": {
        "aliases": [],
        "category": "backend",
        "weight": 0.7,
        "related": {"Python": 0.7},
    },
    "PHP": {
        "aliases": [],
        "category": "backend",
        "weight": 0.7,
        "related": {"JavaScript": 0.6},
    },
    "GraphQL": {
        "aliases": [],
        "category": "backend",
        "weight": 0.75,
        "related": {"REST API": 0.5},
    },
    "REST API": {
        "aliases": ["restful api", "rest api", "rest"],
        "category": "backend",
        "weight": 0.8,
        "related": {"GraphQL": 0.5, "FastAPI": 0.6, "Node.js": 0.6},
    },
    "gRPC": {
        "aliases": ["grpc"],
        "category": "backend",
        "weight": 0.7,
        "related": {"REST API": 0.5},
    },
    "Microservices": {
        "aliases": ["micro service", "micro-services"],
        "category": "architecture",
        "weight": 0.8,
        "related": {"Docker": 0.6, "Kubernetes": 0.6},
    },
    "SQL": {
        "aliases": ["sql server", "t-sql"],
        "category": "database",
        "weight": 0.85,
        "related": {"PostgreSQL": 0.75, "MySQL": 0.75},
    },
    "PostgreSQL": {
        "aliases": ["postgres", "pgsql"],
        "category": "database",
        "weight": 0.9,
        "related": {"SQL": 0.75, "MySQL": 0.6},
    },
    "MySQL": {
        "aliases": [],
        "category": "database",
        "weight": 0.8,
        "related": {"SQL": 0.75, "PostgreSQL": 0.6},
    },
    "MongoDB": {
        "aliases": ["mongo"],
        "category": "database",
        "weight": 0.85,
        "related": {"Node.js": 0.6, "Express.js": 0.6},
    },
    "Redis": {
        "aliases": ["redis cache"],
        "category": "database",
        "weight": 0.85,
        "related": {"Node.js": 0.55, "Docker": 0.5},
    },
    "Elasticsearch": {
        "aliases": ["elastic"],
        "category": "database",
        "weight": 0.8,
        "related": {"Kibana": 0.8},
    },
    "RabbitMQ": {
        "aliases": [],
        "category": "backend",
        "weight": 0.8,
        "related": {"Kafka": 0.75},
    },
    "Kafka": {
        "aliases": ["apache kafka"],
        "category": "backend",
        "weight": 0.85,
        "related": {"RabbitMQ": 0.75},
    },
    "Docker": {
        "aliases": ["docker compose", "containerization", "container"],
        "category": "devops",
        "weight": 0.9,
        "related": {"Kubernetes": 0.85, "CI/CD": 0.7},
    },
    "Kubernetes": {
        "aliases": ["k8s"],
        "category": "devops",
        "weight": 0.9,
        "related": {"Docker": 0.85, "Terraform": 0.6},
    },
    "AWS": {
        "aliases": ["amazon web services", "amazon aws", "aws lambda", "ec2", "s3"],
        "category": "devops",
        "weight": 0.9,
        "related": {"Azure": 0.55, "GCP": 0.55},
    },
    "Azure": {
        "aliases": ["microsoft azure"],
        "category": "devops",
        "weight": 0.85,
        "related": {"AWS": 0.55, "GCP": 0.55},
    },
    "GCP": {
        "aliases": ["google cloud"],
        "category": "devops",
        "weight": 0.85,
        "related": {"AWS": 0.55, "Azure": 0.55},
    },
    "Terraform": {
        "aliases": [],
        "category": "devops",
        "weight": 0.8,
        "related": {"AWS": 0.6, "Kubernetes": 0.6},
    },
    "Ansible": {
        "aliases": [],
        "category": "devops",
        "weight": 0.75,
        "related": {"Terraform": 0.7},
    },
    "GitHub Actions": {
        "aliases": ["gh actions", "github action"],
        "category": "devops",
        "weight": 0.8,
        "related": {"CI/CD": 0.85, "Git": 0.7},
    },
    "CI/CD": {
        "aliases": ["ci cd", "cicd"],
        "category": "devops",
        "weight": 0.8,
        "related": {"GitHub Actions": 0.85, "Docker": 0.6},
    },
    "Git": {
        "aliases": [],
        "category": "tools",
        "weight": 0.7,
        "related": {"GitHub": 0.85, "GitLab": 0.8},
    },
    "GitHub": {
        "aliases": [],
        "category": "tools",
        "weight": 0.7,
        "related": {"Git": 0.85, "GitHub Actions": 0.75},
    },
    "GitLab": {
        "aliases": [],
        "category": "tools",
        "weight": 0.7,
        "related": {"Git": 0.8},
    },
    "Linux": {
        "aliases": ["ubuntu", "unix"],
        "category": "tools",
        "weight": 0.7,
        "related": {"Shell Scripting": 0.8},
    },
    "Shell Scripting": {
        "aliases": ["bash", "shell script", "shell"],
        "category": "tools",
        "weight": 0.7,
        "related": {"Linux": 0.8, "PowerShell": 0.7},
    },
    "PowerShell": {
        "aliases": ["powershell"],
        "category": "tools",
        "weight": 0.7,
        "related": {"Shell Scripting": 0.7},
    },
    "Jest": {
        "aliases": [],
        "category": "tools",
        "weight": 0.75,
        "related": {"TypeScript": 0.6, "React": 0.6},
    },
    "Pytest": {
        "aliases": ["pytest"],
        "category": "tools",
        "weight": 0.75,
        "related": {"Python": 0.7},
    },
    "Cypress": {
        "aliases": [],
        "category": "tools",
        "weight": 0.75,
        "related": {"Jest": 0.7},
    },
    "Flutter": {
        "aliases": ["flutter sdk"],
        "category": "mobile",
        "weight": 0.9,
        "related": {"Dart": 0.95, "React Native": 0.4},
    },
    "Dart": {
        "aliases": [],
        "category": "mobile",
        "weight": 0.9,
        "related": {"Flutter": 0.95},
    },
    "React Native": {
        "aliases": ["rn", "react-native"],
        "category": "mobile",
        "weight": 0.85,
        "related": {"React": 0.55, "Flutter": 0.4},
    },
    "Expo": {
        "aliases": [],
        "category": "mobile",
        "weight": 0.7,
        "related": {"React Native": 0.85},
    },
    "Swift": {
        "aliases": [],
        "category": "mobile",
        "weight": 0.85,
        "related": {"iOS": 0.85},
    },
    "Kotlin": {
        "aliases": [],
        "category": "mobile",
        "weight": 0.85,
        "related": {"Android": 0.85, "Java": 0.7},
    },
    "Firebase": {
        "aliases": [],
        "category": "mobile",
        "weight": 0.75,
        "related": {"React Native": 0.6, "Flutter": 0.6, "Node.js": 0.5},
    },
    "PyTorch": {
        "aliases": [],
        "category": "ai",
        "weight": 0.85,
        "related": {"Python": 0.7, "TensorFlow": 0.8},
    },
    "TensorFlow": {
        "aliases": ["tf"],
        "category": "ai",
        "weight": 0.85,
        "related": {"Python": 0.7, "PyTorch": 0.8},
    },
    "scikit-learn": {
        "aliases": ["sklearn"],
        "category": "ai",
        "weight": 0.8,
        "related": {"Python": 0.7, "pandas": 0.7},
    },
    "pandas": {
        "aliases": [],
        "category": "ai",
        "weight": 0.75,
        "related": {"Python": 0.75, "scikit-learn": 0.7},
    },
    "LangChain": {
        "aliases": ["langchain"],
        "category": "ai",
        "weight": 0.8,
        "related": {"LLM": 0.8, "Python": 0.6},
    },
    "LLM": {
        "aliases": ["large language model", "llms", "gpt"],
        "category": "ai",
        "weight": 0.8,
        "related": {"LangChain": 0.8, "Python": 0.5},
    },
    "Spark": {
        "aliases": ["apache spark", "pyspark"],
        "category": "data",
        "weight": 0.85,
        "related": {"Python": 0.6, "Hadoop": 0.7},
    },
    "Hadoop": {
        "aliases": [],
        "category": "data",
        "weight": 0.8,
        "related": {"Spark": 0.7},
    },
    "Airflow": {
        "aliases": ["apache airflow"],
        "category": "data",
        "weight": 0.8,
        "related": {"Python": 0.6, "Spark": 0.6},
    },
    "dbt": {
        "aliases": [],
        "category": "data",
        "weight": 0.8,
        "related": {"SQL": 0.7},
    },
    "Snowflake": {
        "aliases": [],
        "category": "data",
        "weight": 0.85,
        "related": {"BigQuery": 0.7},
    },
    "BigQuery": {
        "aliases": [],
        "category": "data",
        "weight": 0.85,
        "related": {"Snowflake": 0.7, "SQL": 0.7},
    },
    "Databricks": {
        "aliases": [],
        "category": "data",
        "weight": 0.85,
        "related": {"Spark": 0.8},
    },
    "Tableau": {
        "aliases": [],
        "category": "data",
        "weight": 0.75,
        "related": {"Power BI": 0.8},
    },
    "Power BI": {
        "aliases": ["powerbi"],
        "category": "data",
        "weight": 0.75,
        "related": {"Tableau": 0.8},
    },
    "Kibana": {
        "aliases": [],
        "category": "data",
        "weight": 0.7,
        "related": {"Elasticsearch": 0.8},
    },
    "Prometheus": {
        "aliases": [],
        "category": "devops",
        "weight": 0.75,
        "related": {"Grafana": 0.85},
    },
    "Grafana": {
        "aliases": [],
        "category": "devops",
        "weight": 0.75,
        "related": {"Prometheus": 0.85},
    },
    "OpenTelemetry": {
        "aliases": ["otel"],
        "category": "devops",
        "weight": 0.7,
        "related": {"Prometheus": 0.6},
    },
}

# Skills that exist on user profiles but are not in the ontology get a
# neutral entry (own name + basic aliases, "other" category, no relations).
_NEUTRAL_WEIGHT = 0.7

# ---------------------------------------------------------------------------
# Title taxonomy: family -> display titles + keyword evidence.
# ---------------------------------------------------------------------------

TITLE_TAXONOMY: dict[str, dict[str, Any]] = {
    "Software Engineer": {
        "keywords": ["software engineer", "software developer", "software development engineer", "application developer", "full stack engineer", "full stack developer"],
    },
    "Backend Engineer": {
        "keywords": ["backend engineer", "backend developer", "back-end engineer", "back-end developer", "server-side engineer", "api engineer", "server engineer"],
    },
    "Frontend Engineer": {
        "keywords": ["frontend engineer", "frontend developer", "front-end engineer", "front-end developer", "ui developer", "web developer", "react developer", "angular developer", "vue developer"],
    },
    "Mobile Developer": {
        "keywords": ["mobile developer", "mobile engineer", "flutter developer", "react native developer", "android developer", "ios developer", "mobile app developer"],
    },
    "DevOps Engineer": {
        "keywords": ["devops engineer", "devops developer", "site reliability engineer", "platform engineer", "cloud engineer", "infrastructure engineer", "sre"],
    },
    "Data Engineer": {
        "keywords": ["data engineer", "data scientist", "ml engineer", "machine learning engineer", "data analyst", "analytics engineer", "data developer"],
    },
    "Full Stack Developer": {
        "keywords": ["full stack developer", "fullstack developer", "full-stack developer", "full stack engineer", "fullstack engineer"],
    },
}

# Family-name mapping used to derive display titles from taxonomy keys.
_FAMILY_DISPLAY: dict[str, str] = {
    "Software Engineer": "Software Engineer",
    "Backend Engineer": "Backend Developer",
    "Frontend Engineer": "Frontend Developer",
    "Mobile Developer": "Mobile Developer",
    "DevOps Engineer": "DevOps Engineer",
    "Data Engineer": "Data Engineer",
    "Full Stack Developer": "Full-Stack Developer",
}

# ---------------------------------------------------------------------------
# Seniority bands (index = experience level).
# ---------------------------------------------------------------------------

SENIORITY_BANDS: list[tuple[str, tuple[str, ...]]] = [
    ("intern", ("intern", "internship", "graduate", "entry-level", "entry level", "junior", "associate", "trainee")),
    ("mid", ("mid", "intermediate", "mid-level", "mid level", "ii", "level 2")),
    ("senior", ("senior", "lead", "staff", "principal", "architect", "manager", "director", "expert", "head of")),
]
_BAND_INDEX: dict[str, int] = {"intern": 0, "mid": 1, "senior": 2}

# ---------------------------------------------------------------------------
# Requirement context markers (sentences around a skill mention).
# ---------------------------------------------------------------------------

_REQUIRED_RE = re.compile(
    r"\b(must|required|mandatory|minimum|need|essential|require)\b", re.IGNORECASE
)
_PREFERRED_RE = re.compile(
    r"\b(preferred|plus|nice to have|bonus|advantage|desirable|a plus)\b",
    re.IGNORECASE,
)
_FAMILIARITY_RE = re.compile(
    r"\b(exposure to|familiarity with|knowledge of|understanding of|basic knowledge)\b",
    re.IGNORECASE,
)

_CONTEXT_WEIGHTS: dict[str, float] = {
    "required": 1.0,
    "preferred": 0.7,
    "familiarity": 0.4,
    "neutral": 0.85,
}

# ---------------------------------------------------------------------------
# Profile-scoped negative terms. Keyed by target family; a negative term only
# penalizes when the user's target family matches the mapping below. Never a
# deletion — always a score penalty.
# ---------------------------------------------------------------------------

_NEGATIVE_TERMS: dict[str, tuple[str, ...]] = {
    "Software Engineer": (
        "sales engineer",
        "technical sales",
        "solutions engineer",
        "support engineer",
        "field engineer",
        "account executive",
        "customer success",
        "implementation consultant",
    ),
    "Backend Engineer": (
        "sales engineer",
        "technical sales",
        "support engineer",
        "field engineer",
    ),
    "Frontend Engineer": (
        "sales engineer",
        "technical sales",
        "support engineer",
        "web designer",
    ),
    "Mobile Developer": (
        "sales engineer",
        "technical sales",
        "support engineer",
        "game developer",
    ),
    "DevOps Engineer": ("sales engineer", "technical sales", "support engineer"),
    "Data Engineer": (
        "sales analyst",
        "support engineer",
        "customer success",
        "data entry",
    ),
    "Full Stack Developer": (
        "sales engineer",
        "technical sales",
        "solutions engineer",
        "support engineer",
        "field engineer",
    ),
}

_SENTENCE_CHARS = 90
_TERM_MIN_LEN = 2

# Match any term with non-alphanumeric boundaries (handles "C++", ".NET", "Go").
_BOUNDARY_RE_TEMPLATE = r"(?<![a-z0-9_]){}(?![a-z0-9_])"


def _find_term(text_lower: str, term: str) -> bool:
    """Word-boundary match of a term inside lowercased text."""
    if len(term) < _TERM_MIN_LEN:
        return False
    try:
        pattern = _BOUNDARY_RE_TEMPLATE.format(re.escape(term))
        return re.search(pattern, text_lower, re.IGNORECASE) is not None
    except re.error:
        return term in text_lower


def _skill_terms(skill_name: str) -> list[str]:
    """All surface terms for a skill: canonical name + aliases."""
    entry = _ONTOLOGY.get(skill_name)
    if entry is None:
        return [skill_name]
    return [skill_name, *entry["aliases"]]


def _profile_skill_names(skills: list[dict[str, Any]]) -> list[str]:
    """Tracked skill names, deduped case-insensitively (order preserved)."""
    seen: set[str] = set()
    result: list[str] = []
    for skill in skills:
        name = str(skill.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key not in seen:
            seen.add(key)
            result.append(name)
    return result


def _parse_years_range(years: Any) -> float:
    """Parse a work-experience ``years`` string into an approximate count."""
    if years is None:
        return 0.0
    text = str(years)
    m = re.search(r"(\d{4})\s*[-–—]\s*(\d{4}|present|now)", text, re.IGNORECASE)
    if m:
        end = 2026 if m.group(2).lower() in ("present", "now") else int(m.group(2))
        return max(0.0, float(end - int(m.group(1))))
    m = re.search(r"(\d{1,2})\s*(?:years?|yrs?)", text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return 0.0


def _experience_years(work_experience: list[dict[str, Any]]) -> float:
    """Sum of approximate years across work-experience entries."""
    return sum(_parse_years_range(entry.get("years")) for entry in work_experience)


def _family_from_text(text: str) -> str | None:
    """Return the taxonomy family whose keywords best match ``text``.

    Token-set matching: a keyword matches when every one of its words appears
    as a whole word in the text, so "Full Stack Software Engineer" matches
    the "full stack engineer" keyword regardless of word order. Ties are
    broken by keyword specificity (longest matched keyword wins).
    """
    tokens = set(re.findall(r"[a-z0-9+#]+", text.lower()))
    best_family: str | None = None
    best_count = 0
    best_longest = 0
    for family, data in TITLE_TAXONOMY.items():
        count = 0
        longest = 0
        for kw in data["keywords"]:
            kw_tokens = set(re.findall(r"[a-z0-9+#]+", kw.lower()))
            if kw_tokens and kw_tokens.issubset(tokens):
                count += 1
                longest = max(longest, len(kw_tokens))
        if (count, longest) > (best_count, best_longest):
            best_family = family
            best_count = count
            best_longest = longest
    return best_family


def _derive_role_families(
    work_experience: list[dict[str, Any]],
    target_roles: list[str] | None,
    recommended_roles: list[dict[str, Any]] | None,
) -> list[str]:
    """Role families from actual roles + targets + market-position picks."""
    families: list[str] = []
    for entry in work_experience:
        role = str(entry.get("role") or "").strip()
        family = _family_from_text(role) if role else None
        if family and family not in families:
            families.append(family)
    for role in target_roles or []:
        family = _family_from_text(str(role)) if role else None
        if family and family not in families:
            families.append(family)
    for pick in recommended_roles or []:
        role = str(pick.get("role") or "").strip()
        family = _family_from_text(role) if role else None
        if family and family not in families:
            families.append(family)
    return families


def _seniority_band_from_role(current_role: str | None) -> str | None:
    """Extract the seniority band from market-position's current role."""
    if not current_role:
        return None
    lowered = current_role.lower()
    for band, keywords in SENIORITY_BANDS:
        if any(_find_term(lowered, kw) for kw in keywords):
            return band
    return "mid"


def build_profile_snapshot(
    profile: dict[str, Any] | None,
    skills: list[dict[str, Any]],
    market_position: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build the profile snapshot the matching engine scores against.

    Deterministic: skills (name/category/proficiency/years), work experience
    roles, market-position seniority + recommended roles, and targets.
    """
    work_experience = (profile or {}).get("work_experience") or []
    target_roles = (profile or {}).get("target_roles") or []
    target_locations = (profile or {}).get("target_locations") or []

    skill_names = _profile_skill_names(skills)
    current_role = (market_position or {}).get("current_role")
    recommended_roles = (market_position or {}).get("recommended_roles") or []
    families = _derive_role_families(work_experience, target_roles, recommended_roles)

    # Category-grouped skill terms (profile category wins; ontology fallback).
    skill_terms: dict[str, list[str]] = {}
    for skill in skills:
        name = str(skill.get("name") or "").strip()
        if not name:
            continue
        category = str(skill.get("category") or "").strip()
        if not category:
            category = str(_ONTOLOGY.get(name, {}).get("category") or "other")
        skill_terms.setdefault(category.lower(), []).append(name)

    return {
        "skill_names": skill_names,
        "skill_terms": skill_terms,
        "role_families": families,
        "seniority_band": _seniority_band_from_role(current_role),
        "experience_years": _experience_years(work_experience),
        "target_locations": [str(loc) for loc in target_locations],
        "has_profile": bool(skill_names or families or work_experience),
    }


# ---------------------------------------------------------------------------
# Tiered skill matching
# ---------------------------------------------------------------------------

TIER_EXACT = "exact"
TIER_RELATED = "related"
TIER_ECOSYSTEM = "ecosystem"
TIER_UNRELATED = "unrelated"

_TIER_SCORES: dict[str, float] = {
    TIER_EXACT: 1.0,
    TIER_RELATED: 0.85,
    TIER_ECOSYSTEM: 0.7,
    TIER_UNRELATED: 0.2,
}


def match_skills(jd_text: str, snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Tiered skill match between a JD and the profile's tracked skills.

    Returns ``{skill_name: {"score", "tier"}}`` for every tracked skill.
    EXACT = the skill or an alias appears in the JD; RELATED = a related skill
    appears (per the relationship map); ECOSYSTEM = another skill in the same
    category appears; otherwise UNRELATED.
    """
    lowered = jd_text.lower()
    result: dict[str, dict[str, Any]] = {}
    for skill in snapshot.get("skill_names", []):
        entry = _ONTOLOGY.get(skill)
        if entry is None:
            if any(_find_term(lowered, t) for t in _skill_terms(skill)):
                result[skill] = {"score": _TIER_SCORES[TIER_EXACT], "tier": TIER_EXACT}
            else:
                result[skill] = {"score": _TIER_SCORES[TIER_UNRELATED], "tier": TIER_UNRELATED}
            continue

        if any(_find_term(lowered, t) for t in _skill_terms(skill)):
            result[skill] = {"score": _TIER_SCORES[TIER_EXACT], "tier": TIER_EXACT}
            continue

        # RELATED / ECOSYSTEM: a related skill is exactly present in the JD.
        # Design doc: relationship strengths >= 0.8 map to the RELATED tier
        # (0.85), weaker relationships map to ECOSYSTEM (0.70).
        related = entry.get("related") or {}
        related_score = max(
            (score for other, score in related.items() if any(_find_term(lowered, t) for t in _skill_terms(other))),
            default=None,
        )
        if related_score is not None:
            if related_score >= 0.8:
                result[skill] = {"score": _TIER_SCORES[TIER_RELATED], "tier": TIER_RELATED}
            else:
                result[skill] = {"score": _TIER_SCORES[TIER_ECOSYSTEM], "tier": TIER_ECOSYSTEM}
            continue

        # ECOSYSTEM: same-category skill present (exact), no direct relation.
        category = entry.get("category", "other")
        if category != "other" and any(
            other != skill and _ONTOLOGY.get(other, {}).get("category") == category
            and any(_find_term(lowered, t) for t in _skill_terms(other))
            for other in _ONTOLOGY
        ):
            result[skill] = {"score": _TIER_SCORES[TIER_ECOSYSTEM], "tier": TIER_ECOSYSTEM}
            continue

        result[skill] = {"score": _TIER_SCORES[TIER_UNRELATED], "tier": TIER_UNRELATED}
    return result


# ---------------------------------------------------------------------------
# Title matching
# ---------------------------------------------------------------------------


def match_title(job_title: str, role_families: list[str]) -> tuple[str | None, float]:
    """Match a job title against the profile's role families.

    Returns ``(family, score)`` where score is the fraction of the family's
    keyword list present in the title (0 when no family matches).
    """
    tokens = set(re.findall(r"[a-z0-9+#]+", job_title.lower()))
    best_family: str | None = None
    best_score = 0.0
    best_longest = 0
    for family in role_families:
        keywords = TITLE_TAXONOMY.get(family, {}).get("keywords", [])
        if not keywords:
            continue
        hits = 0
        longest = 0
        for kw in keywords:
            kw_tokens = set(re.findall(r"[a-z0-9+#]+", kw.lower()))
            if kw_tokens and kw_tokens.issubset(tokens):
                hits += 1
                longest = max(longest, len(kw_tokens))
        score = hits / len(keywords)
        if (score, longest) > (best_score, best_longest):
            best_family = family
            best_score = score
            best_longest = longest
    return best_family, best_score


# ---------------------------------------------------------------------------
# Seniority scoring
# ---------------------------------------------------------------------------


def _normalize_band(band: str | None) -> str | None:
    """Map a band alias ("junior", "entry-level") to its canonical name."""
    if not band:
        return None
    lowered = band.lower()
    for name, keywords in SENIORITY_BANDS:
        if lowered == name or any(lowered in kw for kw in keywords):
            return name
    return "mid"


def _job_seniority_index(job_title: str) -> int:
    lowered = job_title.lower()
    for index, (_, keywords) in enumerate(SENIORITY_BANDS):
        if any(_find_term(lowered, kw) for kw in keywords):
            return index
    return 1  # default mid


def seniority_score(job_title: str, profile_band: str | None) -> float:
    """Band-gap seniority score (0..1).

    Equal band = 1.0; each band the job demands *above* the profile costs 0.35;
    a job demanding *less* than the profile costs 0.15 per band (mildly
    under-levelled jobs are still relevant).
    """
    band = _normalize_band(profile_band)
    if not band:
        return 0.8  # unknown profile band -> neutral
    profile_index = _BAND_INDEX[band]
    job_index = _job_seniority_index(job_title)
    gap = job_index - profile_index
    if gap <= 0:
        return max(0.0, 1.0 - 0.15 * abs(gap))
    return max(0.0, 1.0 - 0.35 * gap)


# ---------------------------------------------------------------------------
# Context classification
# ---------------------------------------------------------------------------


def classify_context(sentence: str) -> str:
    """Classify a requirement sentence: required / familiarity / preferred.

    Familiarity markers ("exposure to", "knowledge of") dominate over
    preference markers when both appear ("Exposure to React is a plus").
    """
    if _REQUIRED_RE.search(sentence):
        return "required"
    if _FAMILIARITY_RE.search(sentence):
        return "familiarity"
    if _PREFERRED_RE.search(sentence):
        return "preferred"
    return "neutral"


def context_weight(context: str) -> float:
    """Weight for a requirement context tier."""
    return _CONTEXT_WEIGHTS.get(context, _CONTEXT_WEIGHTS["neutral"])


# ---------------------------------------------------------------------------
# Negative terms
# ---------------------------------------------------------------------------


def negative_penalty(job_title: str, role_families: list[str]) -> float:
    """Profile-scoped negative-term penalty (0 when not applicable).

    A title is only penalized when one of the user's target families is mapped
    to the matching negative term — never a global blacklist.
    """
    lowered = job_title.lower()
    penalty = 0.0
    for family in role_families:
        terms = _NEGATIVE_TERMS.get(family)
        if not terms:
            continue
        if any(_find_term(lowered, term) for term in terms):
            penalty = max(penalty, 0.3)
    return penalty


# ---------------------------------------------------------------------------
# Query generation (what to fetch)
# ---------------------------------------------------------------------------


def _ranked_skills(snapshot: dict[str, Any], skills: list[dict[str, Any]]) -> list[str]:
    """Tracked skills ranked by proficiency then years (stable)."""
    ranked = sorted(
        skills,
        key=lambda s: (
            -(s.get("proficiency") or 0),
            -(s.get("years_experience") or 0),
            str(s.get("name") or "").lower(),
        ),
    )
    return [str(s["name"]) for s in ranked if str(s.get("name") or "").strip()]


def build_search_queries(
    snapshot: dict[str, Any],
    skills: list[dict[str, Any]],
) -> list[str]:
    """Generate the search queries used to fan out to the job sources.

    Deterministic and profile-driven: title-first queries from the role
    families (experience + targets), category-grouped skill queries, and a
    plain top-skills query. Capped at 5.
    """
    queries: list[str] = []
    ranked = _ranked_skills(snapshot, skills)
    families = snapshot.get("role_families", [])

    # Q1/Q2: primary + secondary role family, each with its top skills.
    for family in families[:2]:
        display = _FAMILY_DISPLAY.get(family, family)
        query_parts = [f'"{display}"']
        query_parts.extend(ranked[:2])
        queries.append(" ".join(query_parts))

    # Q3: top skills across the profile.
    if ranked:
        queries.append(" ".join(ranked[:5]))

    # Q4: most populated skill category as a plain keyword query.
    category_groups = sorted(
        snapshot.get("skill_terms", {}).items(),
        key=lambda kv: (-len(kv[1]), kv[0]),
    )
    for _category, names in category_groups[:1]:
        query = " ".join(names[:5])
        if query and query not in queries:
            queries.append(query)

    # Dedupe case-insensitively, drop empties, cap at 5.
    seen: set[str] = set()
    result: list[str] = []
    for query in queries:
        cleaned = " ".join(query.split())
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result[:5]


# ---------------------------------------------------------------------------
# Deterministic requirement extraction (the cheap pass)
# ---------------------------------------------------------------------------


def extract_requirements(jd_text: str) -> dict[str, Any]:
    """Deterministic requirement extraction from a JD.

    Returns required / preferred / contextual skills (context-classified via
    the surrounding sentence), the inferred seniority band and role.
    This is the cheap pass that runs at save time; an LLM upgrade can run
    on-demand via the existing job-intel endpoints.
    """
    lowered = jd_text.lower()
    sentences = re.split(r"(?<=[.!?])\s+", jd_text)

    def sentence_for(idx: int) -> str:
        """The sentence containing the character offset ``idx``."""
        offset = 0
        for sentence in sentences:
            if idx < offset + len(sentence):
                return sentence
            offset += len(sentence) + 1
        return jd_text

    required: list[str] = []
    preferred: list[str] = []
    contextual: list[str] = []
    seen: set[str] = set()

    for canonical, entry in _ONTOLOGY.items():
        for term in [canonical, *entry.get("aliases", [])]:
            if len(term) < _TERM_MIN_LEN:
                continue
            try:
                pattern = re.compile(
                    _BOUNDARY_RE_TEMPLATE.format(re.escape(term)),
                    re.IGNORECASE,
                )
            except re.error:
                continue
            for match in pattern.finditer(jd_text):
                if canonical in seen:
                    break
                context = classify_context(sentence_for(match.start()))
                if context == "required":
                    required.append(canonical)
                elif context == "preferred":
                    preferred.append(canonical)
                elif context == "familiarity":
                    contextual.append(canonical)
                seen.add(canonical)
                break

    first_line = jd_text.splitlines()[0] if jd_text.splitlines() else ""
    band = _job_seniority_index(f"{first_line} {jd_text[:400]}")
    role = _family_from_text(first_line)
    return {
        "role": role,
        "seniority_level": ["intern", "mid", "senior"][band],
        "required_skills": required,
        "preferred_skills": preferred,
        "contextual_skills": contextual,
        "experience_years": _extract_experience_years(jd_text),
    }


def _extract_experience_years(jd_text: str) -> int | None:
    """Best-effort years-of-experience from a JD ("5+ years", "3-5 years")."""
    m = re.search(
        r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp\.)?",
        jd_text,
        re.IGNORECASE,
    )
    if m:
        return int(m.group(1))
    m = re.search(r"(\d{1,2})\s*[-–—]\s*\d{1,2}\s*(?:years?|yrs?)", jd_text, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None
