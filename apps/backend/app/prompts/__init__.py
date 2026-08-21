"""LLM prompt templates."""

from app.prompts.templates import (
    CRITICAL_TRUTHFULNESS_RULES,
    DEFAULT_IMPROVE_PROMPT_ID,
    DIFF_IMPROVE_PROMPT,
    DIFF_STRATEGY_INSTRUCTIONS,
    EXTRACT_KEYWORDS_PROMPT,
    GENERATE_TITLE_PROMPT,
    IMPROVE_PROMPT_OPTIONS,
    IMPROVE_RESUME_PROMPT,
    IMPROVE_RESUME_PROMPT_RECRUITER,
    IMPROVE_RESUME_PROMPTS,
    INTERVIEW_PREP_PROMPT,
    INTERVIEW_PRACTICE_FEEDBACK_PROMPT,
    MATCHED_PROJECTS_PROMPT,
    PARSE_RESUME_PROMPT,
    SKILL_TARGET_PLAN_PROMPT,
    CHAT_PLANNER_SYSTEM_PROMPTS,
    CHAT_PLANNER_PROMPT,
    CHAT_ANSWER_PROMPT,
    CHAT_MODE_CONFIGS,
    CHAT_AUDIT_PROMPT,
    get_language_name,
)

# Placeholders every user-supplied cover-letter / outreach message prompt must
# contain. These correspond to the ``.format()`` keys used by the services in
# ``app/services/cover_letter.py``. Validated at save time so a 422 surfaces
# immediately instead of a ``KeyError`` during generation.
REQUIRED_FEATURE_PROMPT_PLACEHOLDERS: tuple[str, ...] = (
    "{job_description}",
    "{resume_data}",
    "{output_language}",
)

# Placeholders every user-supplied composer outreach-email prompt must contain.
# These correspond to the ``.format()`` keys used by
# ``app/routers/enrichment.py::generate_outreach_email``. A smaller core set is
# required because fields like website/LinkedIn may legitimately be empty.
REQUIRED_OUTREACH_EMAIL_PLACEHOLDERS: tuple[str, ...] = (
    "{output_language}",
    "{company_name}",
    "{sender_info}",
    "{purpose}",
)


def validate_prompt_placeholders(
    prompt: str,
    required: tuple[str, ...] = REQUIRED_FEATURE_PROMPT_PLACEHOLDERS,
) -> list[str]:
    """Return required placeholders missing from ``prompt``.

    Empty or whitespace-only prompts are treated as "use default" and return
    an empty list (valid — the router treats them as clearing the override).
    Non-empty prompts must include every entry from ``required``.
    """
    if not prompt or not prompt.strip():
        return []
    return [p for p in required if p not in prompt]


__all__ = [
    "PARSE_RESUME_PROMPT",
    "EXTRACT_KEYWORDS_PROMPT",
    "IMPROVE_RESUME_PROMPT",
    "IMPROVE_RESUME_PROMPT_RECRUITER",
    "IMPROVE_RESUME_PROMPTS",
    "IMPROVE_PROMPT_OPTIONS",
    "DEFAULT_IMPROVE_PROMPT_ID",
    "CRITICAL_TRUTHFULNESS_RULES",
    "DIFF_IMPROVE_PROMPT",
    "DIFF_STRATEGY_INSTRUCTIONS",
    "SKILL_TARGET_PLAN_PROMPT",
    "GENERATE_TITLE_PROMPT",
    "INTERVIEW_PREP_PROMPT",
    "INTERVIEW_PRACTICE_FEEDBACK_PROMPT",
    "MATCHED_PROJECTS_PROMPT",
    "CHAT_PLANNER_SYSTEM_PROMPTS",
    "CHAT_PLANNER_PROMPT",
    "CHAT_ANSWER_PROMPT",
    "CHAT_MODE_CONFIGS",
    "CHAT_AUDIT_PROMPT",
    "REQUIRED_FEATURE_PROMPT_PLACEHOLDERS",
    "REQUIRED_OUTREACH_EMAIL_PLACEHOLDERS",
    "validate_prompt_placeholders",
    "get_language_name",
]
