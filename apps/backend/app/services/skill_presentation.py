"""Deterministic skill presentation for the tailored resume.

The tailoring pipeline runs this step last so the final ``technicalSkills``
list (LLM reorder + verified adds + refiner keyword injection) is turned
into a professional, ATS-friendly Skills section:

- **Trim**: only skills that are JD-relevant (match a required/preferred/
  keyword term) or evidenced (appear in the resume's own text) are kept in
  ``technicalSkills`` — a skill proven nowhere and wanted by nobody is
  removed.
- **Group**: the survivors are grouped into categories (Languages,
  Frontend, Backend, Databases, Cloud & DevOps, Architecture, AI/LLM,
  Tools) and written to ``additional.skillGroups``. ATS scoring still
  works from the trimmed flat list (all JD skills survive by definition).

Fully deterministic and no-op safe: without JD terms, without skills, or
when nothing survives the trim, the resume is returned unchanged.
"""

from typing import Any

import re

from app.schemas.models import _split_list_entries

# Ordered (category name, [alias, ...]) pairs. Unknown skills fall into Tools.
_SKILL_CATEGORIES: list[tuple[str, list[str]]] = [
    ("Languages", ["Python", "JavaScript", "TypeScript", "Java", "C", "C++", "C#", "Go", "Golang", "Rust", "Ruby", "PHP", "Swift", "Kotlin", "Dart", "Scala", "SQL"]),
    ("Frontend", ["React", "React.js", "ReactJS", "Next.js", "NextJS", "Vue", "Vue.js", "Angular", "Svelte", "Flutter", "React Native", "Tailwind CSS", "Tailwind", "CSS", "CSS3", "HTML", "HTML5", "Redux", "Zustand", "jQuery", "Bootstrap", "Webpack", "Vite", "Framer Motion", "RxJS"]),
    ("Backend", ["Node.js", "NodeJS", "Express", "Express.js", "NestJS", "Django", "FastAPI", "Flask", "Spring Boot", "Spring", ".NET", ".NET Framework", ".NET / ASP.NET Core", "ASP.NET Core", "ASP.NET", "Ruby on Rails", "Laravel", "Symfony", "GraphQL", "REST", "REST API", "REST APIs", "RESTful API", "gRPC"]),
    ("Databases", ["PostgreSQL", "Postgres", "MySQL", "SQLite", "SQL Server", "MongoDB", "Redis", "Elasticsearch", "DynamoDB", "Firebase", "Supabase", "Prisma", "TypeORM", "SQLAlchemy", "Cassandra"]),
    ("Cloud & DevOps", ["AWS", "AWS Lambda", "Azure", "Google Cloud", "GCP", "Cloud Computing", "Docker", "Kubernetes", "K8s", "Terraform", "GitHub Actions", "CI/CD", "Jenkins", "Ansible", "Nginx", "Serverless", "Vercel", "Netlify", "Helm"]),
    ("Architecture", ["Microservices", "Clean Architecture", "Design Patterns", "SOLID", "Event-Driven", "Message Queues", "Kafka", "RabbitMQ", "System Design", "Monorepo", "API Design", "Domain-Driven Design", "DDD", "CQRS", "MVC"]),
    ("AI/LLM", ["Machine Learning", "ML", "Deep Learning", "LLM", "LangChain", "LangGraph", "RAG", "OpenAI", "PyTorch", "TensorFlow", "Hugging Face", "Fine-Tuning", "Prompt Engineering", "Vector Databases", "Agents", "Data Science"]),
    ("Tools", ["Git", "GitHub", "GitLab", "Bitbucket", "Linux", "Bash", "Postman", "Jira", "Figma", "VS Code", "WebStorm", "npm", "Yarn", "pnpm", "Docker Compose", "Playwright", "Jest", "Cypress", "Pytest", "ESLint", "Prettier", "Agile", "Scrum", "Testing"]),
]

_TOOLS_FALLBACK = "Tools"

_MAX_KEPT_SKILLS = 24

_NORM_RE = re.compile(r"[^a-z0-9]")

# Variant-tolerant matching: an alias also matches when it appears inside a
# longer skill name (e.g. "REST API" in "RESTful APIs"), provided neither side
# is too short to be meaningful (short aliases like "C" must never swallow
# unrelated skills like "Clean Code").
_CONTAINMENT_MIN_LEN = 4


def _norm(value: str) -> str:
    """Lowercase alphanumerics only — 'Next.js', 'NextJS' and 'next js' unify."""
    return _NORM_RE.sub("", value.casefold())


def _keyword_terms(job_keywords: dict[str, Any]) -> list[str]:
    """Casefolded, de-duplicated JD keyword terms (mirrors matched_projects)."""
    terms: list[str] = []
    for key in ("required_skills", "preferred_skills", "keywords"):
        for item in (job_keywords.get(key) or []):
            if isinstance(item, str) and len(item.strip()) >= 2:
                terms.append(item.strip().casefold())
    return list(dict.fromkeys(terms))


def _jd_relevant(skill: str, terms: list[str]) -> bool:
    """Whether a skill matches a JD term (either direction, normalized)."""
    skill_norm = _norm(skill)
    if not skill_norm:
        return False
    for term in terms:
        term_norm = _norm(term)
        if term_norm and (term_norm in skill_norm or skill_norm in term_norm):
            return True
    return False


def _evidence_text(data: dict[str, Any]) -> str:
    """The resume's own free text — the evidence base for skills."""
    parts: list[str] = []
    summary = data.get("summary")
    if isinstance(summary, str):
        parts.append(summary)
    for key in ("workExperience", "personalProjects", "education", "customSections"):
        entries = data.get(key)
        if isinstance(entries, list):
            for entry in entries:
                parts.append(_flatten_entry(entry))
        elif isinstance(entries, dict):
            for entry in entries.values():
                parts.append(_flatten_entry(entry))
    return " ".join(parts)


def _flatten_entry(entry: Any) -> str:
    """Join one structured entry's free-text fields."""
    if not isinstance(entry, dict):
        return ""
    parts: list[str] = []
    for field in ("title", "company", "degree", "institution", "description"):
        value = entry.get(field)
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            parts.extend(str(item) for item in value if isinstance(item, str))
    return " ".join(parts)


def _evidenced(skill: str, text_norm: str) -> bool:
    """Whether a skill appears in the resume's own text (normalized)."""
    skill_norm = _norm(skill)
    return bool(skill_norm) and skill_norm in text_norm


def _category_for(skill: str) -> str:
    """The category name for a skill (Tools fallback for unknown ones).

    Exact alias match first, then a variant-tolerant containment pass
    (alias inside skill or skill inside alias) so real-world variants like
    "RESTful APIs" or ".NET / ASP.NET Core" still land in the right category.
    """
    skill_norm = _norm(skill)
    if not skill_norm:
        return _TOOLS_FALLBACK
    for category, aliases in _SKILL_CATEGORIES:
        for alias in aliases:
            alias_norm = _norm(alias)
            if alias_norm and alias_norm == skill_norm:
                return category
    for category, aliases in _SKILL_CATEGORIES:
        for alias in aliases:
            alias_norm = _norm(alias)
            if not alias_norm:
                continue
            if min(len(alias_norm), len(skill_norm)) < _CONTAINMENT_MIN_LEN:
                continue
            if alias_norm in skill_norm or skill_norm in alias_norm:
                return category
    return _TOOLS_FALLBACK


def trim_and_group_skills(
    improved_data: dict[str, Any] | None,
    job_keywords: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Trim the tailored resume's skills to JD-relevant, evidenced ones and
    group them into ``additional.skillGroups``.

    Returns (improved_data, warnings). No-op safe: without a dict, without
    skills, without JD terms, or when nothing survives, the input data is
    returned unchanged.
    """
    warnings: list[str] = []
    if not isinstance(improved_data, dict):
        return improved_data, warnings
    additional = improved_data.get("additional")
    if not isinstance(additional, dict):
        return improved_data, warnings
    skills = additional.get("technicalSkills")
    if not isinstance(skills, list) or not skills:
        return improved_data, warnings

    # Some sources (legacy parses) store comma-joined strings as single list
    # items (e.g. "React, Next.js"); split them so every entry is one skill
    # before trimming (same splitter the AdditionalInfo validator uses).
    raw_skills: list[str] = []
    for skill in skills:
        if isinstance(skill, str):
            raw_skills.extend(_split_list_entries(skill))

    if not raw_skills:
        return improved_data, warnings

    terms = _keyword_terms(job_keywords)
    if not terms:
        return improved_data, warnings

    text_norm = _norm(_evidence_text(improved_data))

    jd_kept: list[str] = []
    evidence_kept: list[str] = []
    dropped: list[str] = []
    seen: set[str] = set()
    for skill in raw_skills:
        if not isinstance(skill, str) or not skill.strip():
            continue
        key = skill.strip().casefold()
        if key in seen:
            continue
        seen.add(key)
        skill = skill.strip()
        if _jd_relevant(skill, terms):
            jd_kept.append(skill)
        elif _evidenced(skill, text_norm):
            evidence_kept.append(skill)
        else:
            dropped.append(skill)

    if not jd_kept and not evidence_kept:
        warnings.append("Skills not trimmed: every skill would be removed")
        return improved_data, warnings

    kept = (jd_kept + evidence_kept)[:_MAX_KEPT_SKILLS]

    # Group in catalog order (first appearance of a category in _SKILL_CATEGORIES),
    # skills within a group keep their kept-list (JD-first) order.
    by_category: dict[str, list[str]] = {}
    for category, _aliases in _SKILL_CATEGORIES:
        for skill in kept:
            if _category_for(skill) == category:
                by_category.setdefault(category, []).append(skill)
    for skill in kept:
        category = _category_for(skill)
        if category not in by_category:
            by_category.setdefault(category, []).append(skill)
    skill_groups = [
        {"name": name, "skills": group_skills}
        for name, group_skills in by_category.items()
    ]

    result = dict(improved_data)
    result_additional = dict(additional)
    result_additional["technicalSkills"] = kept
    result_additional["skillGroups"] = skill_groups
    result["additional"] = result_additional

    if dropped:
        listed = ", ".join(dropped[:_MAX_KEPT_SKILLS])
        extra = f" (+{len(dropped) - _MAX_KEPT_SKILLS} more)" if len(dropped) > _MAX_KEPT_SKILLS else ""
        warnings.append(
            f"Removed {len(dropped)} skill(s) not relevant to this job: {listed}{extra}"
        )
    return result, warnings
