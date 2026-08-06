"""ATS score computation utilities.

Calculates an ATS-style breakdown score from already-processed resume and job data:
  - keyword_match: final keyword match % from the refinement pipeline
  - skills_coverage: overlap between resume technical skills and JD required skills
  - section_completeness: presence of essential resume sections (local, no LLM)
  - quantification: percentage of bullet points backed by numbers/metrics
  - action_verbs: percentage of bullet points starting with strong action verbs

The overall_score is a weighted composite of the five sub-scores.
"""

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Weights must sum to 1.0
_WEIGHTS = {
    "keyword_match": 0.30,
    "skills_coverage": 0.20,
    "section_completeness": 0.15,
    "quantification": 0.20,
    "action_verbs": 0.15,
}

# Patterns to detect resume section headings
_SECTION_PATTERNS = {
    "summary": ["summary", "objective", "profile", "about"],
    "experience": ["experience", "work history", "employment"],
    "education": ["education", "academic", "degree"],
    "skills": ["skills", "technologies", "competencies", "technical"],
}

# Quantification patterns: numbers, percentages, currency, metrics
_QUANTIFICATION_PATTERNS = [
    r"\d+%",                          # percentages
    r"\$\s*\d+",                      # dollar amounts
    r"\d+\s*(?:years?|months?|hours?|days?|weeks?)",  # time periods
    r"\d+\s*(?:people|users|customers|members|clients|employees|team)",  # people
    r"\d+\s*(?:projects?|features?|endpoints?|APIs?|services?|modules?)",  # items
    r"\d+\s*(?:transactions?|orders?|tickets?|requests?|incidents?)",  # volume
    r"\d+\s*(?:percent|percentage|point|times|fold|x\b)",  # more metrics
    r"(?:reduced|increased|decreased|improved|grew|saved|cut|boosted|accelerated)\s.*\d+",  # impact verbs + numbers
    r"\d+[.,]\d+",                    # decimals
    r"\b(?:1st|2nd|3rd|\d+th)\b",     # ordinals
    r"\d+\+",                          # N+ pattern
]

# Comprehensive action verbs list (past tense + present tense)
_ACTION_VERBS = {
    # Leadership & Management
    "led", "managed", "directed", "supervised", "oversaw", "coordinated",
    "guided", "mentored", "trained", "coached", "facilitated", "chaired",
    "headed", "spearheaded", "orchestrated", "administered", "governed",
    # Achievement & Impact
    "achieved", "attained", "exceeded", "surpassed", "outperformed",
    "delivered", "accomplished", "secured", "earned", "won", "captured",
    # Creation & Building
    "built", "created", "developed", "designed", "architected", "engineered",
    "constructed", "established", "founded", "initiated", "launched",
    "implemented", "introduced", "pioneered", "devised", "formulated",
    # Improvement & Optimization
    "improved", "enhanced", "optimized", "streamlined", "refined",
    "modernized", "upgraded", "revamped", "transformed", "restructured",
    "simplified", "standardized", "automated", "accelerated", "boosted",
    # Reduction & Efficiency
    "reduced", "decreased", "lowered", "minimized", "eliminated",
    "cut", "trimmed", "consolidated", "rationalized", "trimmed",
    # Analysis & Research
    "analyzed", "evaluated", "assessed", "audited", "investigated",
    "researched", "surveyed", "reviewed", "examined", "diagnosed",
    "profiled", "benchmarked", "measured", "quantified", "mapped",
    # Communication & Collaboration
    "presented", "communicated", "collaborated", "partnered", "negotiated",
    "influenced", "persuaded", "advocated", "lobbied", "mediated",
    "reported", "documented", "authored", "published", "articulated",
    # Technical
    "integrated", "migrated", "deployed", "configured", "debugged",
    "troubleshot", "resolved", "patched", "refactored", "restructured",
    "programmed", "scripted", "coded", "compiled", "tested",
    "debugged", "profiled", "optimized", "tuned", "scaled",
    # Financial
    "budgeted", "forecasted", "projected", "priced", "valued",
    "allocated", "distributed", "managed", "handled", "processed",
    # Problem Solving
    "resolved", "solved", "addressed", "tackled", "approached",
    "mitigated", "remedied", "rectified", "corrected", "fixed",
}


def _extract_all_text(data: dict[str, Any]) -> str:
    """Flatten all string values from a resume dict into a single text block."""
    parts: list[str] = []

    def _walk(obj: Any) -> None:
        if isinstance(obj, str):
            parts.append(obj)
        elif isinstance(obj, list):
            for item in obj:
                _walk(item)
        elif isinstance(obj, dict):
            for v in obj.values():
                _walk(v)

    _walk(data)
    return " ".join(parts)


def _extract_all_bullets(resume: dict[str, Any]) -> list[str]:
    """Extract all bullet point texts from resume work experience and projects."""
    bullets: list[str] = []

    for exp in resume.get("workExperience") or []:
        for desc in exp.get("description") or []:
            if isinstance(desc, str) and desc.strip():
                bullets.append(desc.strip())

    for proj in resume.get("personalProjects") or []:
        for desc in proj.get("description") or []:
            if isinstance(desc, str) and desc.strip():
                bullets.append(desc.strip())

    # Custom sections with itemList type
    for section in (resume.get("customSections") or {}).values():
        if isinstance(section, dict):
            for item in section.get("items") or []:
                if isinstance(item, dict):
                    for desc in item.get("description") or []:
                        if isinstance(desc, str) and desc.strip():
                            bullets.append(desc.strip())

    return bullets


def _keyword_in_text(keyword: str, text_lower: str) -> bool:
    """Whole-word match against pre-lowercased text to avoid false positives.

    Args:
        keyword: The keyword to search for (will be lowercased internally).
        text_lower: Full text that has already been lowercased by the caller.
    """
    escaped = re.escape(keyword.strip().lower())
    if not escaped:
        return False
    return bool(re.search(rf"(?<!\w){escaped}(?!\w)", text_lower))


def _compute_skills_coverage(
    resume: dict[str, Any],
    job_keywords: dict[str, Any],
) -> float:
    """Return skills coverage score (0–100).

    Checks how many required_skills / preferred_skills from the JD appear
    in the resume's technicalSkills list (falls back to full-text search).
    """
    jd_skills: list[str] = []
    jd_skills.extend(job_keywords.get("required_skills", []))
    jd_skills.extend(job_keywords.get("preferred_skills", []))

    if not jd_skills:
        return 0.0

    resume_skills: list[str] = (
        resume.get("additional", {}).get("technicalSkills", []) or []
    )
    resume_text = _extract_all_text(resume).lower()
    resume_skills_lower = {s.lower() for s in resume_skills if isinstance(s, str)}

    matched = 0
    for skill in jd_skills:
        if not isinstance(skill, str):
            continue
        skill_lower = skill.lower()
        # Direct skill list match or whole-word text match (resume_text is pre-lowercased)
        if skill_lower in resume_skills_lower or _keyword_in_text(skill, resume_text):
            matched += 1

    return min(100.0, (matched / len(jd_skills)) * 100)


def _compute_section_completeness(resume: dict[str, Any]) -> float:
    """Return section completeness score (0–100).

    Checks the structured resume dict for the presence of key sections.
    If no structured sections are detected, falls back to scanning all
    extracted text for common section heading keywords.
    """
    found = 0

    # Structured-data fast path
    if resume.get("summary"):
        found += 1
    if resume.get("workExperience"):
        found += 1
    if resume.get("education"):
        found += 1
    skills = resume.get("additional", {}).get("technicalSkills", [])
    if skills:
        found += 1

    # If none of the structured checks fired, fall back to text scanning
    if found == 0:
        text = _extract_all_text(resume).lower()
        for patterns in _SECTION_PATTERNS.values():
            if any(p in text for p in patterns):
                found += 1

    total = len(_SECTION_PATTERNS)  # 4
    return (found / total) * 100


def _compute_quantification(resume: dict[str, Any]) -> float:
    """Return quantification score (0–100).

    Checks what percentage of bullet points contain quantified achievements
    (numbers, percentages, currency, metrics, etc.).
    """
    bullets = _extract_all_bullets(resume)
    if not bullets:
        return 0.0

    quantified = 0
    for bullet in bullets:
        bullet_lower = bullet.lower()
        if any(re.search(pat, bullet_lower) for pat in _QUANTIFICATION_PATTERNS):
            quantified += 1

    return min(100.0, (quantified / len(bullets)) * 100)


def _compute_action_verbs(resume: dict[str, Any]) -> float:
    """Return action verb score (0–100).

    Checks what percentage of bullet points start with a strong action verb.
    """
    bullets = _extract_all_bullets(resume)
    if not bullets:
        return 0.0

    with_verbs = 0
    for bullet in bullets:
        # Get the first word (strip leading whitespace and bullet markers)
        cleaned = re.sub(r"^[\s•\-\*→▸▹◦○►▸︎]+", "", bullet).strip()
        first_word = cleaned.split()[0].lower().rstrip(".,;:") if cleaned.split() else ""
        if first_word in _ACTION_VERBS:
            with_verbs += 1

    return min(100.0, (with_verbs / len(bullets)) * 100)


def _generate_recommendations(
    keyword_score: float,
    skills_score: float,
    section_score: float,
    quantification_score: float,
    action_verb_score: float,
    missing_keywords: list[str],
    injectable_keywords: list[str],
) -> list[str]:
    tips: list[str] = []

    if keyword_score < 60 and missing_keywords:
        top = ", ".join(missing_keywords[:5])
        tips.append(f"Add these high-priority missing keywords: {top}.")

    if injectable_keywords:
        top_injectable = ", ".join(injectable_keywords[:5])
        tips.append(
            f"The following skills are in your master resume but not in this tailored version — consider adding them: {top_injectable}."
        )

    if skills_score < 60:
        tips.append(
            "Expand your Skills section to include more of the tools and technologies listed in the job description."
        )

    if section_score < 75:
        tips.append(
            "Make sure your resume includes all key sections: Summary, Work Experience, Education, and Skills."
        )

    if quantification_score < 50:
        tips.append(
            "Add numbers and metrics to your achievements. Use percentages, dollar amounts, team sizes, or time saved to quantify impact."
        )

    if action_verb_score < 50:
        tips.append(
            "Start each bullet point with a strong action verb (e.g., Built, Led, Reduced, Increased, Designed)."
        )

    if keyword_score >= 80 and skills_score >= 80:
        tips.append(
            "Strong keyword and skills alignment. Consider quantifying your achievements with metrics and numbers."
        )

    if not tips:
        tips.append(
            "Your resume is well-aligned with the job description. Review for any niche certifications or tools to add."
        )

    return tips


def compute_ats_score(
    refined_resume: dict[str, Any],
    job_keywords: dict[str, Any],
    keyword_match_percentage: float,
    missing_keywords: list[str],
    injectable_keywords: list[str],
) -> dict[str, Any]:
    """Compute the ATS score breakdown dict.

    Args:
        refined_resume: The fully refined resume data dict.
        job_keywords: Extracted JD keywords dict (required_skills, preferred_skills, …).
        keyword_match_percentage: Final keyword match % from refiner.calculate_keyword_match.
        missing_keywords: Keywords absent from the tailored resume (non-injectable).
        injectable_keywords: Keywords absent but present in the master resume.

    Returns:
        Dict with overall_score, sub_scores, missing_keywords,
        injectable_keywords, and recommendations.
    """
    kw_score = min(100.0, max(0.0, keyword_match_percentage))
    sk_score = _compute_skills_coverage(refined_resume, job_keywords)
    sec_score = _compute_section_completeness(refined_resume)
    quant_score = _compute_quantification(refined_resume)
    verb_score = _compute_action_verbs(refined_resume)

    overall = (
        kw_score * _WEIGHTS["keyword_match"]
        + sk_score * _WEIGHTS["skills_coverage"]
        + sec_score * _WEIGHTS["section_completeness"]
        + quant_score * _WEIGHTS["quantification"]
        + verb_score * _WEIGHTS["action_verbs"]
    )

    return {
        "overall_score": round(overall, 1),
        "sub_scores": {
            "keyword_match": round(kw_score, 1),
            "skills_coverage": round(sk_score, 1),
            "section_completeness": round(sec_score, 1),
            "quantification": round(quant_score, 1),
            "action_verbs": round(verb_score, 1),
        },
        "missing_keywords": missing_keywords[:10],
        "injectable_keywords": injectable_keywords[:10],
        "recommendations": _generate_recommendations(
            kw_score,
            sk_score,
            sec_score,
            quant_score,
            verb_score,
            missing_keywords,
            injectable_keywords,
        ),
    }
