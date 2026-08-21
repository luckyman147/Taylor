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


async def generate_cover_letter(
    resume_data: dict[str, Any],
    job_description: str,
    language: str = "en",
    instruction: str | None = None,
) -> str:
    """Generate a cover letter based on resume and job description.

    Args:
        resume_data: Structured resume data (ResumeData format)
        job_description: Target job description text
        language: Output language code (en, es, zh, ja)
        instruction: Optional user-supplied guidance appended to the prompt

    Returns:
        Generated cover letter as plain text
    """
    output_language = get_language_name(language)

    template, is_custom = _resolve_feature_prompt(
        "cover_letter_prompt", COVER_LETTER_PROMPT
    )
    try:
        prompt = template.format(
            job_description=job_description,
            resume_data=json.dumps(resume_data),
            output_language=output_language,
        )
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
        prompt = COVER_LETTER_PROMPT.format(
            job_description=job_description,
            resume_data=json.dumps(resume_data),
            output_language=output_language,
        )

    if instruction and instruction.strip():
        prompt = (
            f"{prompt}\n\n"
            f"User's additional instructions for this generation "
            f"(follow them precisely):\n{instruction.strip()}"
        )

    result = await complete(
        prompt=prompt,
        system_prompt="You are a professional career coach and resume writer. Write compelling, personalized cover letters.",
        max_tokens=2048,
    )

    return strip_ats_analysis(result)


async def generate_outreach_message(
    resume_data: dict[str, Any],
    job_description: str,
    language: str = "en",
    instruction: str | None = None,
) -> str:
    """Generate a cold outreach message for networking.

    Args:
        resume_data: Structured resume data (ResumeData format)
        job_description: Target job description text
        language: Output language code (en, es, zh, ja)
        instruction: Optional user-supplied guidance appended to the prompt

    Returns:
        Generated outreach message as plain text
    """
    output_language = get_language_name(language)

    template, is_custom = _resolve_feature_prompt(
        "outreach_message_prompt", OUTREACH_MESSAGE_PROMPT
    )
    try:
        prompt = template.format(
            job_description=job_description,
            resume_data=json.dumps(resume_data),
            output_language=output_language,
        )
    except (KeyError, IndexError, ValueError) as e:
        # See generate_cover_letter for rationale on the exception set.
        if not is_custom:
            raise
        logging.warning(
            "Custom outreach message prompt failed to format (%s); falling back to default",
            e,
        )
        prompt = OUTREACH_MESSAGE_PROMPT.format(
            job_description=job_description,
            resume_data=json.dumps(resume_data),
            output_language=output_language,
        )

    if instruction and instruction.strip():
        prompt = (
            f"{prompt}\n\n"
            f"User's additional instructions for this generation "
            f"(follow them precisely):\n{instruction.strip()}"
        )

    result = await complete(
        prompt=prompt,
        system_prompt="You are a professional networking coach. Write genuine, engaging cold outreach messages.",
        max_tokens=1024,
    )

    return result.strip()


async def generate_resume_title(
    job_description: str,
    language: str = "en",
) -> str:
    """Generate a short descriptive title from a job description.

    Args:
        job_description: Target job description text
        language: Output language code (en, es, zh, ja)

    Returns:
        Generated title like "Senior Frontend Engineer @ Stripe"
    """
    output_language = get_language_name(language)

    prompt = GENERATE_TITLE_PROMPT.format(
        job_description=job_description,
        output_language=output_language,
    )

    result = await complete(
        prompt=prompt,
        system_prompt="You extract job titles and company names from job descriptions.",
        max_tokens=60,
        temperature=0.3,
    )

    # Strip quotes and whitespace, truncate to 80 chars
    title = result.strip().strip("\"'")
    return title[:80]
