"""Structured resume-summary rewriting (WHY → WHAT → HOW → IMPACT)."""

import json
import logging
from typing import Any

from app.llm import complete_json
from app.prompts import SUMMARY_REWRITE_PROMPT, get_language_name
from app.services.improver import _sanitize_user_input

logger = logging.getLogger(__name__)

_RESUME_DATA_PROMPT_CHAR_LIMIT = 12000


def _serialize_resume_data_for_prompt(resume_data: dict[str, Any]) -> str:
    """Bound the resume JSON while making omissions explicit."""
    resume_json = json.dumps(resume_data, ensure_ascii=False)
    if len(resume_json) <= _RESUME_DATA_PROMPT_CHAR_LIMIT:
        return resume_json
    omitted = len(resume_json) - _RESUME_DATA_PROMPT_CHAR_LIMIT
    return (
        f"{resume_json[:_RESUME_DATA_PROMPT_CHAR_LIMIT]}\n"
        f"\n[Note: {omitted} characters of resume data omitted — do not infer omitted details.]"
    )


async def rewrite_resume_summary(
    resume_data: dict[str, Any] | None,
    job_description: str = "",
    language: str = "en",
) -> str:
    """Rewrite the resume summary with a WHY → WHAT → HOW → IMPACT structure.

    Non-destructive: returns the original summary unchanged when the LLM call
    fails, so callers can always assign the result without a guard.
    """
    current = resume_data.get("summary") if isinstance(resume_data, dict) else None
    original = str(current).strip() if current else ""
    if not original:
        return original

    prompt = SUMMARY_REWRITE_PROMPT.format(
        resume_data=_serialize_resume_data_for_prompt(resume_data),
        job_description=(
            _sanitize_user_input(job_description[:4000])
            if job_description
            else "No job description provided — write from the resume facts alone."
        ),
        output_language=get_language_name(language),
    )
    try:
        result = await complete_json(
            prompt=prompt,
            system_prompt="You are a resume editor. Output only valid JSON.",
            max_tokens=400,
            schema_type="keywords",
        )
        summary = result.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary.strip()
        logger.warning("Summary rewrite returned unusable output; keeping original.")
    except Exception as exc:
        logger.warning("Summary rewrite failed; keeping original: %s", exc)
    return original