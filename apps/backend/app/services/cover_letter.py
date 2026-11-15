"""Cover letter, outreach message, and resume title generation service."""

import json
import logging
import re
from typing import Any

# Matches a trailing "ATS Match Analysis"-style section some models append
# after the letter's signature (optionally preceded by a `---` separator
# and/or a markdown heading, possibly bold). Anchored to a line start so a
# mid-letter mention like "ATS-friendly" is never touched.
_ATS_SECTION_RE = re.compile(
    r"(?:^|\n)\s*(?:[-=–—_*]{2,}\s*)?(?:#{1,6}\s*)?\*{0,2}\s*"
    r"ats(?:\s*(?:match|score|compatibility|keyword|analysis)){1,2}"
    r"[\s\S]*?$",
    re.IGNORECASE,
)


def strip_ats_analysis(text: str) -> str:
    """Remove an appended 'ATS Match Analysis' section from cover letter text.

    Some LLM outputs add a meta-analysis section after the signature
    (estimated ATS score, matching/missing skills, selling points). This
    never belongs in a letter a candidate sends, so it is stripped at
    generation time and again at serve time for legacy stored letters.
    """
    return _ATS_SECTION_RE.sub("", text).strip()

from app.config import load_config_file
from app.llm import complete
from app.prompts.templates import (
    COVER_LETTER_PROMPT,
    GENERATE_TITLE_PROMPT,
    OUTREACH_MESSAGE_PROMPT,
)
from app.prompts import get_language_name


def _resolve_feature_prompt(
    custom_key: str,
    default_template: str,
) -> tuple[str, bool]:
    """Resolve a feature-prompt template at runtime.

    Returns ``(template, is_custom)``. If the stored custom prompt is
    empty or absent, returns the default template. The ``is_custom`` flag
    lets callers decide whether to fall back to the default on a format
    failure (defensive — save-time validation should have caught a
    malformed custom prompt).
    """
    stored = load_config_file()
    custom = (stored.get(custom_key) or "").strip()
    if not custom:
        return default_template, False
    return custom, True


def _clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _join_list(value: Any) -> str:
    if isinstance(value, list):
        parts = [_clean(item) for item in value]
        return ", ".join(part for part in parts if part)
    return _clean(value)


def _truncate(text: str, limit: int = 1200) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _build_job_context_block(
    company_name: str | None,
    job_title: str | None,
    job_keywords: dict[str, Any] | None,
) -> str:
    keywords = job_keywords or {}
    lines: list[str] = []
    company = _clean(company_name) or _clean(keywords.get("company"))
    if company:
        lines.append(f"Company (use exactly): {company}")
    else:
        lines.append(
            "Company: copy the employer name exactly from the job description; "
            "do not invent one"
        )
    role = _clean(job_title) or _clean(keywords.get("role"))
    if role:
        lines.append(f"Role: {role}")
    for label, key in (("Industry", "industry"), ("Seniority", "seniority_level")):
        value = _clean(keywords.get(key))
        if value:
            lines.append(f"{label}: {value}")
    for label, key in (
        ("Key responsibilities", "key_responsibilities"),
        ("Required skills", "required_skills"),
        ("Preferred skills", "preferred_skills"),
        ("ATS keywords", "keywords"),
    ):
        value = _join_list(keywords.get(key))
        if value:
            lines.append(f"{label}: {value}")

    return (
        "## Authoritative job context\n"
        + "\n".join(f"- {line}" for line in lines)
        + "\n\nRules for this context:\n"
        + '- "ATS" means Applicant Tracking System; it is never the employer\'s name.\n'
        + "- Address the hiring team at the company above; never address the candidate.\n"
        + "- Use the candidate's exact name from personalInfo.\n"
        + "- Every claim must come from the resume; never invent employers, dates, "
        "metrics, or credentials."
    )


def _build_candidate_context_block(resume_data: dict[str, Any]) -> str:
    additional = resume_data.get("additional") or {}
    lines: list[str] = []
    for label, key in (
        ("Technical skills", "technicalSkills"),
        ("Languages", "languages"),
        ("Certifications/training", "certificationsTraining"),
        ("Awards", "awards"),
    ):
        value = _join_list(additional.get(key))
        if value:
            lines.append(f"- {label}: {value}")

    groups: list[str] = []
    raw_groups = additional.get("skillGroups")
    if isinstance(raw_groups, list):
        for group in raw_groups:
            if not isinstance(group, dict):
                continue
            name = _clean(group.get("name"))
            skills = _join_list(group.get("skills"))
            if skills:
                groups.append(f"{name}: {skills}" if name else skills)
    if groups:
        lines.append(f"- Skill groups: {'; '.join(groups)}")

    custom_sections = resume_data.get("customSections")
    if custom_sections:
        try:
            custom_text = json.dumps(custom_sections, ensure_ascii=False)
        except (TypeError, ValueError):
            custom_text = _clean(custom_sections)
        if custom_text:
            lines.append(f"- Custom sections (JSON): {_truncate(custom_text)}")

    if not lines:
        return ""
    return (
        "## Authoritative candidate additional information\n"
        "These are real resume sections, not optional extras. Use them when they "
        "match the job requirements.\n"
        + "\n".join(lines)
    )


def _build_instruction_block(instruction: str | None, content_kind: str) -> str:
    if not instruction or not instruction.strip():
        return ""
    return (
        "## HIGHEST PRIORITY - User instructions for this generation\n"
        f"The user entered the instructions below for this {content_kind}. They take "
        "precedence over every conflicting requirement above, including length, tone, "
        "structure, emphasis, formatting, and output language. Follow them exactly:\n"
        f"{instruction.strip()}"
    )


_COVER_LETTER_OUTPUT_CONTRACT = (
    "## Output contract (final)\n"
    "- Return only the cover letter text: greeting, body, sign-off, and the "
    "candidate's name.\n"
    "- Use plain text only. No headings, labels, markdown bold, or meta commentary.\n"
    "- Respect the length and structure requested above; do not shorten the letter "
    "to make room for analysis.\n"
    "- Do not include an ATS score, match analysis, keyword list, or similar meta "
    "section, even if an instruction above asks for one; those sections are removed "
    "automatically."
)

_OUTREACH_OUTPUT_CONTRACT = (
    "## Output contract (final)\n"
    "- Return only the outreach message: greeting, body paragraphs, sign-off, and "
    "sender name.\n"
    "- Use plain text only. No headings, labels, markdown bold, or meta commentary."
)


async def generate_cover_letter(
    resume_data: dict[str, Any],
    job_description: str,
    language: str = "en",
    instruction: str | None = None,
    *,
    company_name: str | None = None,
    job_title: str | None = None,
    job_keywords: dict[str, Any] | None = None,
) -> str:
    """Generate a cover letter based on resume and job description.

    Args:
        resume_data: Structured resume data (ResumeData format)
        job_description: Target job description text
        language: Output language code (en, es, fr, zh, ja, pt, ko)
        instruction: Optional user-supplied guidance appended to the prompt
        company_name: Known employer name from job metadata
        job_title: Known role title from job metadata
        job_keywords: Extracted job signals (industry, skills, ATS keywords)

    Returns:
        Generated cover letter as plain text
    """
    output_language = get_language_name(language)

    template, is_custom = _resolve_feature_prompt(
        "cover_letter_prompt", COVER_LETTER_PROMPT
    )
    format_kwargs = {
        "job_description": job_description,
        "resume_data": json.dumps(resume_data),
        "output_language": output_language,
        "company_name": company_name or "",
        "job_title": job_title or "",
    }
    try:
        prompt = template.format(**format_kwargs)
    except (KeyError, IndexError, ValueError) as e:
        # str.format() raises KeyError for unknown placeholders, IndexError for
        # positional out-of-range, and ValueError for unmatched/invalid braces
        # (e.g., ``{foo``). If the failing template is the built-in default,
        # something is broken upstream and the caller should see it — re-raise.
        # If it's a user-supplied custom prompt, fall back to the default with a
        # warning so generation doesn't crash on out-of-band disk edits.
        if not is_custom:
            raise
        logging.warning(
            "Custom cover letter prompt failed to format (%s); falling back to default",
            e,
        )
        prompt = COVER_LETTER_PROMPT.format(**format_kwargs)

    context_blocks = [
        _build_job_context_block(company_name, job_title, job_keywords),
        _build_candidate_context_block(resume_data),
    ]
    prompt = "\n\n".join(block for block in [*context_blocks, prompt] if block)

    prompt = "\n\n".join(
        block
        for block in (
            prompt,
            _build_instruction_block(instruction, "cover letter"),
            _COVER_LETTER_OUTPUT_CONTRACT,
        )
        if block
    )

    result = await complete(
        prompt=prompt,
        system_prompt=(
            "You are a professional career coach and resume writer. Write "
            "compelling, personalized cover letters. Follow the authoritative "
            "job context exactly and never invent facts."
        ),
        max_tokens=2048,
        metadata={"trace_name": "cover_letter", "tags": ["email"]},
    )

    return strip_ats_analysis(result)


async def generate_outreach_message(
    resume_data: dict[str, Any],
    job_description: str,
    language: str = "en",
    instruction: str | None = None,
    *,
    company_name: str | None = None,
    job_title: str | None = None,
    job_keywords: dict[str, Any] | None = None,
) -> str:
    """Generate a cold outreach message for networking.

    Args:
        resume_data: Structured resume data (ResumeData format)
        job_description: Target job description text
        language: Output language code (en, es, fr, zh, ja, pt, ko)
        instruction: Optional user-supplied guidance appended to the prompt
        company_name: Known employer name from job metadata
        job_title: Known role title from job metadata
        job_keywords: Extracted job signals (industry, skills, ATS keywords)

    Returns:
        Generated outreach message as plain text
    """
    output_language = get_language_name(language)

    template, is_custom = _resolve_feature_prompt(
        "outreach_message_prompt", OUTREACH_MESSAGE_PROMPT
    )
    format_kwargs = {
        "job_description": job_description,
        "resume_data": json.dumps(resume_data),
        "output_language": output_language,
        "company_name": company_name or "",
        "job_title": job_title or "",
    }
    try:
        prompt = template.format(**format_kwargs)
    except (KeyError, IndexError, ValueError) as e:
        # See generate_cover_letter for rationale on the exception set.
        if not is_custom:
            raise
        logging.warning(
            "Custom outreach message prompt failed to format (%s); falling back to default",
            e,
        )
        prompt = OUTREACH_MESSAGE_PROMPT.format(**format_kwargs)

    context_blocks = [
        _build_job_context_block(company_name, job_title, job_keywords),
        _build_candidate_context_block(resume_data),
    ]
    prompt = "\n\n".join(block for block in [*context_blocks, prompt] if block)

    prompt = "\n\n".join(
        block
        for block in (
            prompt,
            _build_instruction_block(instruction, "outreach message"),
            _OUTREACH_OUTPUT_CONTRACT,
        )
        if block
    )

    result = await complete(
        prompt=prompt,
        system_prompt=(
            "You are a professional networking coach. Write genuine, engaging "
            "cold outreach messages with a real email structure: greeting line, "
            "blank line, body paragraphs separated by blank lines, sign-off, and "
            "name. Follow the authoritative job context exactly and never address "
            "the candidate."
        ),
        max_tokens=1024,
        metadata={"trace_name": "outreach_message", "tags": ["email"]},
    )

    return _normalize_outreach_lines(result)


def _normalize_outreach_lines(text: str) -> str:
    """Ensure a generated outreach message has a greeting + paragraph blank lines."""
    body = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not body:
        return ""
    if body.startswith("```"):
        lines = body.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        body = "\n".join(lines).strip()
    lines = [ln.rstrip() for ln in body.split("\n")]
    if lines and lines[0].strip():
        rest = lines[1:]
        while rest and not rest[0].strip():
            rest.pop(0)
        lines = [lines[0], ""] + rest
    out: list[str] = []
    blank = False
    for ln in lines:
        if not ln.strip():
            blank = True
            continue
        if blank and out:
            out.append("")
        out.append(ln)
        blank = False
    return "\n".join(out).strip()


async def generate_resume_title(
    job_description: str,
    language: str = "en",
    candidate_name: str | None = None,
) -> str:
    """Generate a short descriptive title from a job description.

    Args:
        job_description: Target job description text
        language: Output language code (en, es, zh, ja)
        candidate_name: Optional candidate's name to include in the title

    Returns:
        Generated title like "John Doe - Senior Frontend Engineer @ Stripe"

    Raises:
        ValueError: If the model output is unusable after sanitization
            (e.g. reasoning text, truncated garbage) — callers fall back to
            a deterministic identity-based title.
    """
    output_language = get_language_name(language)

    prompt = GENERATE_TITLE_PROMPT.format(
        job_description=job_description,
        output_language=output_language,
        candidate_name=candidate_name or "",
    )

    result = await complete(
        prompt=prompt,
        system_prompt="You extract job titles and company names from job descriptions.",
        max_tokens=200,
        temperature=0.3,
        metadata={"trace_name": "resume_title", "tags": ["resume"]},
        allow_reasoning_fallback=False,
    )

    title = sanitize_resume_title(result)
    if not title:
        raise ValueError("Title generation returned unusable output")
    return title[:100]


# Leading conversational/reasoning preambles that sometimes leak into a
# title when a model ignores the "output the title only" instruction.
_TITLE_PREAMBLE_RE = re.compile(
    r"^(?:okay|ok|sure|certainly|of course|here'?s|here is|"
    r"i'?ll|i will|let me|as an ai|as requested|got it|absolutely|"
    r"sure,|sure!)\b",
    re.IGNORECASE,
)
# Markdown emphasis/wrapping characters that may wrap the title.
_TITLE_MARKDOWN_RE = re.compile(r"[*_`#]+")


def sanitize_resume_title(raw: str | None) -> str | None:
    """Normalize an LLM-generated resume title.

    Takes the first non-empty line, collapses whitespace, strips markdown
    emphasis and surrounding quotes. Returns ``None`` when the result is
    unusable (empty, too short, conversational preamble, markdown/JSON
    leftovers) so callers can apply a deterministic fallback instead of
    storing garbage.
    """
    if not raw:
        return None

    # Titles must be a single line — anything after the first non-empty line
    # is preamble/rambling/markdown noise and is dropped.
    line = ""
    for candidate_line in raw.splitlines():
        stripped = candidate_line.strip()
        if stripped:
            line = stripped
            break
    if not line:
        return None

    line = _TITLE_MARKDOWN_RE.sub("", line).strip()
    line = line.strip("\"'“”‘’").strip()
    # Cut dangling separators left by truncation ("Software Engineer @").
    line = re.sub(r"[\s@:\-–—]+$", "", line).strip()
    if len(line) < 5:
        return None
    if _TITLE_PREAMBLE_RE.match(line):
        return None
    # Leftover structured-output markers mean the model ignored the format.
    if "{" in line or "```" in line:
        return None
    # Cap at 100 chars on a word boundary so a title never ends mid-word.
    if len(line) > 100:
        cut = line[:100]
        if " " in cut:
            cut = cut.rsplit(" ", 1)[0]
        line = cut.strip()
        if len(line) < 5:
            return None
    return line


def build_fallback_resume_title(
    candidate_name: str | None = None,
    job_title: str | None = None,
    company_name: str | None = None,
) -> str | None:
    """Build a deterministic title when LLM title generation fails.

    Format mirrors the prompt: "Candidate Name - Role @ Company", degrading
    gracefully to whichever parts are known.
    """
    identity_parts = [
        part.strip()
        for part in (job_title, company_name)
        if isinstance(part, str) and part.strip()
    ]
    if len(identity_parts) == 2:
        identity = " @ ".join(identity_parts)
    else:
        identity = identity_parts[0] if identity_parts else ""
    name = candidate_name.strip() if isinstance(candidate_name, str) else ""
    if name and identity:
        return f"{name} - {identity}"[:100]
    return name or identity or None
