"""Job Intelligence: Red Flags detection, Job DNA extraction, Career DNA, and Should I Apply analysis."""

import hashlib
import logging
import re
from typing import Any

from app.config_cache import get_content_language
from app.database import db
from app.llm import complete_json, get_llm_config
from app.prompts import get_language_name
from app.prompts.templates import JOB_DNA_PROMPT, SHOULD_APPLY_PROMPT
from app.services.career_profile import _parse_salary
_VALID_COMPANY_TAGS = ("remote", "startup", "fast_growth", "international", "enterprise", "established")

# Content-hash → extracted job DNA (process-local; covers scraped drafts that
# have no metadata_json to persist into). Single-worker assumption applies.
_DNA_PROCESS_CACHE: dict[str, dict[str, Any]] = {}


def _normalize_company_tags(tags: list[str]) -> list[str]:
    """Normalize company tags — split combined strings, validate against known set."""
    result: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        raw = tag.lower().strip()
        # First try splitting on delimiters
        import re
        parts = re.split(r"[,\s/]+", raw)
        found_any = False
        for part in parts:
            part = part.strip().replace(" ", "_")
            if part in _VALID_COMPANY_TAGS and part not in seen:
                result.append(part)
                seen.add(part)
                found_any = True
        # If no delimiters worked, try matching known tags as substrings
        if not found_any:
            for known in _VALID_COMPANY_TAGS:
                if known in raw and known not in seen:
                    result.append(known)
                    seen.add(known)
    return result




def _llm_configured() -> bool:
    """Whether an LLM is available for job intelligence generation."""
    try:
        config = get_llm_config()
        return bool(config.api_key) or config.provider in ("ollama", "openai_compatible")
    except Exception:
        return False


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def detect_red_flags(job_content: str, job_keywords: dict[str, Any]) -> dict[str, Any]:
    """Detect red flags in a job description using deterministic phrase matching.

    Returns a dict with ``red_flags`` (list of {flag, severity, concern}) and
    ``ghost_risk_percent`` (0-100).
    """
    content_lower = job_content.lower()
    red_flags: list[dict[str, str]] = []

    # Phrase patterns: (regex, flag, severity, concern)
    _phrase_patterns: list[tuple[str, str, str, str]] = [
        (
            r"rockstar|wizard|ninja",
            "Rockstar/wizard/ninja language",
            "warning",
            "May indicate unrealistic expectations or informal culture",
        ),
        (
            r"wear many hats|do it all|jack of all trades|all-in",
            "Extremely broad responsibilities",
            "warning",
            "Role may lack clear boundaries",
        ),
        (
            r"fast-paced|dynamic environment|high-pressure|thrives under pressure|juggle multiple",
            "High-pressure environment",
            "info",
            "May indicate heavy workload or tight deadlines",
        ),
        (
            r"competitive salary|salary commensurate|salary based on experience|DOE|negotiable salary",
            "Salary not disclosed",
            "warning",
            "Salary range not transparent",
        ),
        (
            r"unpaid|trial period|probation.*unpaid|no compensation",
            "Unpaid trial detected",
            "danger",
            "May violate labor laws",
        ),
        (
            r"available 24/7|on-call|anytime|nights and weekends|irregular hours",
            "Availability expectations",
            "warning",
            "May require extensive availability",
        ),
        (
            r"must work.*office|no remote|no telecommute|on-site only",
            "No remote work",
            "info",
            "Remote work not available",
        ),
        (
            r"fast-growing|rapidly growing|hypergrowth",
            "Hypergrowth culture",
            "info",
            "Rapid growth may mean changing priorities",
        ),
        (
            r"wear multiple|many roles|multiple hats",
            "Broad role scope",
            "warning",
            "Role may span multiple functions",
        ),
    ]

    for pattern, flag, severity, concern in _phrase_patterns:
        if re.search(pattern, content_lower):
            red_flags.append({"flag": flag, "severity": severity, "concern": concern})

    # Structural checks
    salary_keywords = [
        "salary", "compensation", "pay", "wage", "remuneration", "$", "€", "£", "usd", "eur"
    ]
    no_salary = not any(kw in content_lower for kw in salary_keywords)
    if no_salary:
        red_flags.append({
            "flag": "Salary not disclosed",
            "severity": "warning",
            "concern": "Salary range not transparent",
        })

    employment_type_keywords = [
        "full-time", "full time", "part-time", "part time",
        "contract", "freelance", "temp", "temporary", "internship",
    ]
    has_employment_type = any(kw in content_lower for kw in employment_type_keywords)
    if not has_employment_type:
        red_flags.append({
            "flag": "Employment type unclear",
            "severity": "info",
            "concern": "Employment type not specified",
        })

    # Senior title with junior experience expectation
    senior_titles = [
        "senior", "lead", "principal", "staff", "head", "director", "vp", "chief",
    ]
    has_senior_title = any(t in content_lower for t in senior_titles)
    experience_years = 0
    years_match = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", content_lower)
    if years_match:
        experience_years = int(years_match.group(1))
    if has_senior_title and experience_years < 3 and experience_years > 0:
        red_flags.append({
            "flag": "Senior title with junior experience expectation",
            "severity": "warning",
            "concern": "Title suggests senior role but experience requirement is low",
        })

    # Ghost risk calculation
    ghost_risk = 20
    if no_salary:
        ghost_risk += 25
    if any(r["severity"] == "danger" for r in red_flags):
        ghost_risk += 40
    if any(r["flag"] == "Rockstar/wizard/ninja language" for r in red_flags):
        ghost_risk += 10
    if any(
        r["flag"] in ("Extremely broad responsibilities", "Broad role scope")
        for r in red_flags
    ):
        ghost_risk += 10
    if any(r["flag"] == "High-pressure environment" for r in red_flags):
        ghost_risk += 5
    if has_senior_title and experience_years < 3 and experience_years > 0:
        ghost_risk += 15
    ghost_risk = min(ghost_risk, 100)

    return {"red_flags": red_flags, "ghost_risk_percent": ghost_risk}


async def extract_job_dna(
    job: dict[str, Any],
    job_keywords: dict[str, Any],
) -> dict[str, Any]:
    """Extract the job's technical and experience requirements into a structured DNA profile.

    Uses LLM when available; falls back to deterministic extraction from job_keywords.
    Result is cached in ``job.metadata_json`` keyed by content hash.
    """
    job_id = job["job_id"]
    meta = job.get("metadata_json") or {}
    content = job.get("content", "")
    ch = _content_hash(content)

# Return cached if hash matches
    cached_dna = meta.get("job_dna")
    cached_hash = meta.get("job_dna_hash")
    if cached_dna and cached_hash == ch:
        return cached_dna

    # Process-level cache — covers jobs without metadata (e.g. scraped drafts)
    # so repeated calls within the process skip LLM re-extraction.
    in_process = _DNA_PROCESS_CACHE.get(ch)
    if in_process is not None:
        return in_process

    # Try LLM extraction
    if _llm_configured():
        output_language = get_language_name(get_content_language())
        prompt = JOB_DNA_PROMPT.format(
            job_description=content[:6000],
            output_language=output_language,
        )

        try:
            llm_config = get_llm_config()
            result = await complete_json(
                prompt,
                config=llm_config,
                max_tokens=4096,
                schema_type="keywords",
            )
            # Validate minimal structure
            if isinstance(result, dict) and "technical" in result:
                # Normalize company tags from LLM output
                result["company"] = _normalize_company_tags(result.get("company", []))
                _DNA_PROCESS_CACHE[ch] = result
                await db.update_job(
                    job_id,
                    {"job_dna": result, "job_dna_hash": ch},
                )
                return result
        except Exception as e:
            logger.warning("Job DNA LLM extraction failed, using fallback: %s", e)

    # Deterministic fallback
    technical: list[dict[str, Any]] = []
    for skill in job_keywords.get("required_skills", []):
        technical.append({"skill": skill, "weight": 10})
    for skill in job_keywords.get("preferred_skills", []):
        if skill not in [t["skill"] for t in technical]:
            technical.append({"skill": skill, "weight": 7})
    for kw in job_keywords.get("keywords", []):
        if kw not in [t["skill"] for t in technical]:
            technical.append({"skill": kw, "weight": 5})

    seniority = (job_keywords.get("seniority_level") or "").lower()
    if "senior" in seniority:
        experience = [
            {"domain": "backend", "level": "high"},
            {"domain": "architecture", "level": "medium"},
        ]
    elif "junior" in seniority or "entry" in seniority:
        experience = [{"domain": "backend", "level": "low"}]
    else:
        experience = [{"domain": "backend", "level": "medium"}]

    company: list[str] = []
    content_lower = content.lower()
    if any(w in content_lower for w in ["remote", "work from home", "telecommute", "distributed"]):
        company.append("remote")
    if any(w in content_lower for w in ["startup", "early-stage", "seed"]):
        company.append("startup")
    if any(w in content_lower for w in ["fast-growing", "rapidly growing", "hypergrowth"]):
        company.append("fast_growth")
    if any(w in content_lower for w in ["global", "international", "worldwide"]):
        company.append("international")

    result = {
        "technical": technical,
        "experience": experience,
        "company": _normalize_company_tags(company),
    }

    _DNA_PROCESS_CACHE[ch] = result
    await db.update_job(
        job_id,
        {"job_dna": result, "job_dna_hash": ch},
    )
    return result


def build_career_dna(career_data: dict[str, Any]) -> dict[str, Any]:
    """Build a career DNA profile from the user's career data bundle.

    Deterministic — no LLM needed.
    """
    technical: list[dict[str, str]] = []
    for skill in career_data.get("skills", []):
        prof = skill.get("proficiency") or 3
        level = "high" if prof >= 4 else "medium" if prof >= 2 else "low"
        technical.append({"skill": skill.get("name", ""), "level": level})

    # Experience domains from work experience titles AND skills
    domain_keywords: dict[str, list[str]] = {
        "backend": ["backend", "server", "api", "microservice", "database", "node", "python", "java", "go", "rust", "c#", "dotnet", "fastapi", "nestjs", "spring"],
        "frontend": ["frontend", "ui", "react", "vue", "css", "html", "angular", "svelte", "next"],
        "mobile": ["mobile", "ios", "android", "flutter", "react native"],
        "devops": ["devops", "infrastructure", "ci/cd", "kubernetes", "docker", "aws", "gcp", "azure"],
        "architecture": ["architect", "system", "design", "platform"],
        "leadership": ["lead", "manager", "director", "head", "senior"],
        "data": ["data", "ml", "machine learning", "ai", "analytics"],
    }

    domains: dict[str, int] = {}
    # Infer from work experience titles
    for exp in career_data.get("work_experience", []):
        title = (exp.get("title") or "").lower()
        for domain, keywords in domain_keywords.items():
            if any(k in title for k in keywords):
                domains[domain] = domains.get(domain, 0) + 1
    # Also infer from skills (skills with proficiency >= 3 count as evidence)
    for skill in career_data.get("skills", []):
        skill_name = (skill.get("name") or "").lower()
        prof = skill.get("proficiency") or 3
        if prof < 3:
            continue
        for domain, keywords in domain_keywords.items():
            if any(k in skill_name for k in keywords):
                domains[domain] = domains.get(domain, 0) + 1

    experience = [
        {
            "domain": d,
            "level": "high" if c >= 2 else "medium" if c >= 1 else "low",
        }
        for d, c in sorted(domains.items(), key=lambda x: -x[1])
    ]

    company: list[str] = []
    for exp in career_data.get("work_experience", []):
        loc = (exp.get("location") or "").lower()
        if "remote" in loc:
            company.append("remote")
            break

    return {
        "technical": technical,
        "experience": experience,
        "company": company,
    }


def _normalize_skill(name: str) -> list[str]:
    """Normalize a skill name into fuzzy-match keys (alias list).

    Returns multiple candidate keys so aliases ("TFS / Azure DevOps",
    "Microsoft SQL Server" vs "SQL Server", "ASP.NET" vs "ASP.NET Core")
    still match. Keys are lowercased and separator-free.
    """
    raw = name.lower().strip()
    if not raw:
        return []

    # Split explicit aliases: "tfs / azure devops" → both count
    if " / " in raw:
        keys: list[str] = []
        for part in raw.split(" / "):
            keys.extend(_normalize_skill(part))
        return _dedupe_keys(keys)

    n = raw

    # Strip vendor prefixes: "microsoft sql server" → "sql server"
    for prefix in ("microsoft ", "apache ", "google ", "amazon "):
        if n.startswith(prefix):
            n = n[len(prefix):]
            break

    # Strip "legacy " qualifier: "legacy asp.net" → "asp.net"
    if n.startswith("legacy "):
        n = n[len("legacy "):]

    # Strip common suffixes: .js, .ts, .css, .html
    for suffix in (".js", ".ts", ".css", ".html"):
        if n.endswith(suffix):
            n = n[: -len(suffix)]
            break

    keys: list[str] = []

    # Remove separators for fuzzy matching
    key = n.replace(" ", "").replace("-", "").replace("_", "").replace(".", "")
    if key:
        keys.append(key)

    # Alias without trailing descriptors: ".net framework" → also "net"
    for desc in (" api", " framework", " library", " server"):
        if n.endswith(desc):
            bare = n[: -len(desc)].replace(" ", "").replace("-", "").replace("_", "").replace(".", "")
            if len(bare) >= 3 and bare not in keys:
                keys.append(bare)
            break

    return keys


def _dedupe_keys(keys: list[str]) -> list[str]:
    """Dedupe keys preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            result.append(k)
    return result


def _keys_overlap(a_keys: list[str], b_keys: list[str]) -> bool:
    """Whether two skill key lists overlap (exact or one contained in the other).

    Containment requires the contained side to be long enough to avoid
    false positives ("java" in "javascript", "c" in "c++").
    """
    for a in a_keys:
        for b in b_keys:
            if a == b:
                return True
            if len(a) >= 6 and len(b) >= 6 and (a in b or b in a):
                return True
    return False


def compare_dna(
    job_dna: dict[str, Any],
    career_dna: dict[str, Any],
) -> dict[str, Any]:
    """Compare a job's DNA against the user's career DNA.

    Returns per-category scores (0-100) and a weighted overall dna_match.
    """
    skill_level_map = {"high": 5, "medium": 3, "low": 1}
    level_name = {v: k for k, v in skill_level_map.items()}

    # Technical overlap: weighted Jaccard-like score (fuzzy-matched)
    job_skills: list[tuple[str, list[str], int]] = []  # (display, keys, weight)
    for t in job_dna.get("technical", []):
        if t.get("skill"):
            job_skills.append((t["skill"], _normalize_skill(t["skill"]), t.get("weight", 5)))

    career_skills: list[tuple[str, list[str], int]] = []  # (display, keys, level_weight)
    for t in career_dna.get("technical", []):
        if t.get("skill"):
            career_skills.append(
                (t["skill"], _normalize_skill(t["skill"]),
                 skill_level_map.get(t.get("level", "low"), 1))
            )

    if not job_skills:
        tech_score = 50.0
        matched_items: list[dict[str, Any]] = []
        missing_items: list[dict[str, Any]] = []
        extra_items: list[dict[str, Any]] = [
            {"skill": display, "level": level_name.get(weight, "low")}
            for display, _, weight in career_skills
        ]
    else:
        matched_career: set[int] = set()
        matched_items = []
        missing_items = []
        matched_weight = 0.0
        total_weight = sum(weight for _, _, weight in job_skills)
        for display, keys, weight in job_skills:
            best = max(
                (
                    (ci, cw)
                    for ci, (_, ckeys, cw) in enumerate(career_skills)
                    if _keys_overlap(keys, ckeys)
                ),
                key=lambda x: x[1],
                default=None,
            )
            if best is not None:
                ci, cw = best
                matched_career.add(ci)
                matched_weight += min(weight, cw)
                matched_items.append({
                    "skill": display,
                    "jobWeight": weight,
                    "careerLevel": level_name.get(cw, "low"),
                })
            else:
                missing_items.append({"skill": display, "weight": weight})
        tech_score = round(matched_weight / total_weight * 100 if total_weight else 0, 1)
        extra_items = [
            {"skill": display, "level": level_name.get(weight, "low")}
            for ci, (display, _, weight) in enumerate(career_skills)
            if ci not in matched_career
        ]

    # Experience overlap: domain-level
    job_domains = {e["domain"]: e["level"] for e in job_dna.get("experience", [])}
    career_domains = {
        e["domain"]: e["level"] for e in career_dna.get("experience", [])
    }
    if not job_domains:
        exp_score = 50.0
    else:
        matched = sum(1 for d in job_domains if d in career_domains)
        exp_score = round(
            matched / len(job_domains) * 100 if job_domains else 0, 1
        )

    # Company overlap
    job_company = set(job_dna.get("company", []))
    career_company = set(career_dna.get("company", []))
    if not job_company:
        comp_score = 50.0
    else:
        comp_score = round(
            len(job_company & career_company) / len(job_company) * 100, 1
        )

    dna_match = round(0.5 * tech_score + 0.3 * exp_score + 0.2 * comp_score, 1)

    return {
        "technical": {
            "score": tech_score,
            "matched": matched_items,
            "missing": missing_items,
            "extra": extra_items,
        },
        "experience": {
            "score": exp_score,
            "matched": [d for d in job_domains if d in career_domains],
            "missing": [d for d in job_domains if d not in career_domains],
        },
        "company": {
            "score": comp_score,
            "matched": list(job_company & career_company),
            "missing": list(job_company - career_company),
        },
        "dna_match": dna_match,
    }


_SENIORITY_WORDS = [
    ("intern", 0),
    ("junior", 1),
    ("mid", 2),
    ("senior", 3),
    ("lead", 4),
    ("principal", 5),
    ("staff", 5),
    ("director", 6),
    ("head", 6),
    ("vp", 7),
    ("chief", 8),
    ("cto", 8),
    ("cfo", 8),
    ("ceo", 8),
]


def _seniority_level(raw: str) -> int:
    """Numeric seniority level from a title/role string (0=intern .. 8=chief)."""
    raw_lower = (raw or "").lower()
    for word, level in _SENIORITY_WORDS:
        if word in raw_lower:
            return level
    return 2


def _role_seniority(role: str) -> int:
    """Seniority level of a specific role title (e.g. 'Senior React Developer')."""
    return _seniority_level(role)


def _years_from_entries(entries: list[dict[str, Any]]) -> float:
    """Total years of experience across work entries (best effort)."""
    total = 0.0
    for entry in entries:
        raw = str(entry.get("years") or "")
        match = re.search(r"(\d+(?:\.\d+)?)", raw)
        if match:
            total += float(match.group(1))
    return total


def _career_seniority(career_data: dict[str, Any]) -> tuple[int, float]:
    """Career seniority: (level, total_years) from work experience titles."""
    entries = career_data.get("work_experience", [])
    titles = [str(e.get("title") or e.get("role") or "") for e in entries]
    level = max((_role_seniority(t) for t in titles), default=2)
    years = _years_from_entries(entries)
    return level, years


def _job_seniority(job_keywords: dict[str, Any], content: str) -> tuple[int, float]:
    """Job seniority: (level, required_years) from keywords + description."""
    raw = str(job_keywords.get("seniority_level") or "")
    level = _seniority_level(raw)
    years = 0
    years_match = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", content.lower())
    if years_match:
        years = int(years_match.group(1))
    if level == 2 and years:
        level = 4 if years >= 7 else 3 if years >= 4 else 2
    return level, years


def _seniority_score(job_level: int, career_level: int) -> float:
    """0-100 score: exact level = 100, each level gap below costs 15."""
    if career_level >= job_level:
        return 100.0
    gap = job_level - career_level
    return round(max(0.0, 100.0 - gap * 15), 1)


def assess_hiring_probability(
    job_dna: dict[str, Any],
    career_dna: dict[str, Any],
    comparison: dict[str, Any],
    job_keywords: dict[str, Any],
    content: str,
    career_data: dict[str, Any],
) -> dict[str, Any]:
    """Hiring probability: skills, experience, seniority → overall chance.

    Unlike ATS keyword matching, this estimates whether the candidate can
    realistically get the job based on skills overlap, experience domains,
    and seniority alignment.
    """
    skills = comparison["technical"]["score"]
    experience = comparison["experience"]["score"]

    job_level, job_years = _job_seniority(job_keywords, content)
    career_level, career_years = _career_seniority(career_data)
    seniority = _seniority_score(job_level, career_level)

    overall = round(0.45 * skills + 0.35 * experience + 0.20 * seniority, 1)

    if overall >= 80:
        assessment = "Excellent target"
        summary = "Strong alignment across skills, experience, and seniority — apply with confidence."
    elif overall >= 65:
        assessment = "Good target"
        summary = "Good alignment — worth applying, but address the gaps below."
    elif overall >= 50:
        assessment = "Reach"
        summary = "Moderate alignment — applying is reasonable, expect competition."
    elif overall >= 35:
        assessment = "Stretch"
        summary = "Weak alignment — consider upskilling or targeting a different role."
    else:
        assessment = "Long shot"
        summary = "Very low alignment — unlikely to land this role as-is."

    gaps: list[str] = []
    if skills < 60:
        gaps.append("missing key skills")
    if experience < 60:
        gaps.append("experience in domains the role needs")
    if seniority < 60:
        gap = job_level - career_level
        if gap > 0:
            gaps.append(f"role expects {job_level} seniority level, profile is {career_level}")
        elif job_years and career_years < job_years:
            gaps.append(f"role wants ~{job_years}+ years, profile has {career_years:.0f}")
    if not gaps:
        gaps.append("no major gaps found")

    return {
        "skills": {
            "score": skills,
            "detail": f"Skills overlap ({_matched_skills_count(comparison)} of {_job_skills_count(job_dna)} required skills)",
        },
        "experience": {
            "score": experience,
            "detail": f"Experience domains ({len(comparison['experience']['matched'])} of {len(job_dna.get('experience', []))} matched)",
        },
        "seniority": {
            "score": seniority,
            "detail": f"Role seniority {job_level} vs profile {career_level}",
        },
        "hiring_probability": overall,
        "assessment": assessment,
        "summary": summary,
        "gaps": gaps,
    }


def _matched_skills_count(comparison: dict[str, Any]) -> int:
    return len(comparison["technical"]["matched"])


def _job_skills_count(job_dna: dict[str, Any]) -> int:
    return len(job_dna.get("technical", []))


async def analyze_job(
    job_id: str,
    master_resume_id: str,
) -> dict[str, Any]:
    """Full Should I Apply analysis.

    Loads the job and resume, computes match, DNA comparison, red flags, and
    produces a verdict with LLM-grounded prose.
    """
    # 1. Load job
    job = await db.get_job(job_id)
    if not job:
        raise ValueError(f"Job {job_id} not found")

    meta = job.get("metadata_json") or {}
    job_keywords = meta.get("job_keywords") or {}
    content = job.get("content", "")

    # Check for cached analysis
    ch = _content_hash(content)
    cached = meta.get("job_analysis")
    cached_hash = meta.get("job_analysis_hash")
    if cached and cached_hash == ch:
        return cached

    # 2. Load master resume
    master_resume = await db.get_resume(master_resume_id)
    if not master_resume:
        raise ValueError(f"Resume {master_resume_id} not found")

    resume_data = master_resume.get("processed_data") or {
        "content": master_resume.get("content", "")
    }

    # 3. Compute match percent
    from app.services.refiner import calculate_keyword_match

    match_pct = calculate_keyword_match(resume_data, job_keywords)

    # 4. Job DNA + Career DNA + comparison
    job_dna = await extract_job_dna(job, job_keywords)

    career_memory = await _get_career_bundle()
    career_dna = build_career_dna(career_memory)
    comparison = compare_dna(job_dna, career_dna)
    career_relevance = comparison["dna_match"]

    # 5. Salary potential
    salary_parsed = _parse_salary(content)
    salary_potential: float | None = None
    if salary_parsed:
        salary_potential = (salary_parsed[0] + salary_parsed[1]) / 2.0

    # 6. Competition heuristic
    competition = _estimate_competition(meta, master_resume)

    # 7. Company quality (no external data)
    company_quality: float | None = None

    # 8. Red flags
    red_flags_result = detect_red_flags(content, job_keywords)
    ghost_risk = red_flags_result["ghost_risk_percent"]

    # 9. Verdict (deterministic)
    if ghost_risk >= 60:
        verdict = "no"
        verdict_reason = "High ghost-job risk detected"
    elif match_pct < 40 and career_relevance < 50:
        verdict = "no"
        verdict_reason = "Low match with the role requirements"
    elif match_pct >= 70 and ghost_risk < 30:
        verdict = "yes"
        verdict_reason = "Strong match with manageable risk"
    elif match_pct >= 50:
        verdict = "conditional"
        verdict_reason = "Moderate match — worth applying but address gaps"
    else:
        verdict = "conditional"
        verdict_reason = "Below average match — consider upskilling first"

    # 10. LLM recommendation prose
    main_weakness = "N/A"
    recommendation = "N/A"

    if _llm_configured():
        output_language = get_language_name(get_content_language())
        red_flags_summary = "; ".join(
            rf["flag"] for rf in red_flags_result["red_flags"]
        ) or "None detected"

        try:
            # Extract role/company for the prompt
            role = meta.get("role") or job_keywords.get("role") or "the role"
            company_name = meta.get("company") or job_keywords.get("company") or "the company"
            prompt = SHOULD_APPLY_PROMPT.format(
                job_role=role,
                company=company_name,
                match_percent=round(match_pct, 1),
                career_relevance=round(career_relevance, 1),
                salary_potential=f"{salary_potential:,.0f}" if salary_potential else "Not disclosed",
                competition=competition,
                ghost_risk=ghost_risk,
                red_flags=red_flags_summary,
                output_language=output_language,
            )
            llm_config = get_llm_config()
            rec = await complete_json(
                prompt,
                config=llm_config,
                max_tokens=1024,
                schema_type="keywords",
            )
            if isinstance(rec, dict):
                main_weakness = rec.get("main_weakness", main_weakness)
                recommendation = rec.get("recommendation", recommendation)
        except Exception as e:
            logger.warning("Should I Apply LLM call failed: %s", e)

    result = {
        "match_percent": round(match_pct, 1),
        "career_relevance": round(career_relevance, 1),
        "salary_potential": salary_potential,
        "competition": competition,
        "company_quality": company_quality,
        "ghost_risk_percent": ghost_risk,
        "verdict": verdict,
        "verdict_reason": verdict_reason,
        "main_weakness": main_weakness,
        "recommendation": recommendation,
        "red_flags": red_flags_result["red_flags"],
        "job_dna": job_dna,
        "career_dna": career_dna,
        "comparison": comparison,
    }

    await db.update_job(
        job_id,
        {"job_analysis": result, "job_analysis_hash": ch},
    )
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_career_bundle() -> dict[str, Any]:
    """Load the career-memory bundle (skills, work_experience, etc.)."""
    from app.services.career_profile import build_career_memory

    memory = await build_career_memory()
    # Re-shape into the flat structure build_career_dna expects
    return {
        "skills": memory.get("skills", []),
        "work_experience": memory.get("profile", {}).get("work_experience", []),
        "education": memory.get("education", []),
    }


def _estimate_competition(
    job_meta: dict[str, Any],
    resume: dict[str, Any],
) -> str:
    """Heuristic competition estimate based on seniority vs resume experience."""
    seniority = (
        (job_meta.get("job_keywords") or {}).get("seniority_level") or ""
    ).lower()

    # Try to infer years from resume
    resume_text = str(resume.get("content") or "").lower()
    years_match = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", resume_text)
    years = int(years_match.group(1)) if years_match else 3

    if "senior" in seniority or "lead" in seniority or "principal" in seniority:
        if years < 5:
            return "High"
        return "Medium"
    if "junior" in seniority or "entry" in seniority:
        if years > 3:
            return "Low"
        return "Medium"
    return "Medium"
