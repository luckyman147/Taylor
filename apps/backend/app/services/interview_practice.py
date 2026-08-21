"""Interview practice feedback service.

Evaluates a candidate's practice answer against a scenario and (optionally)
their resume, returning structured coaching feedback via the LLM.
"""

from typing import Any

from app.llm import (
    complete_json,
    get_llm_config,
    get_model_name,
    get_safe_max_tokens,
)
from app.prompts import INTERVIEW_PRACTICE_FEEDBACK_PROMPT, get_language_name
from app.schemas import PracticeFeedback
from app.services.interview_prep import (
    _serialize_resume_data_for_prompt,
    _truncate_text_for_prompt,
)

_ANSWER_PROMPT_CHAR_LIMIT = 20_000
_SCENARIO_DESCRIPTION_PROMPT_CHAR_LIMIT = 4_000


async def generate_practice_feedback(
    scenario_title: str,
    scenario_description: str | None,
    answer: str,
    resume_data: dict[str, Any] | None,
    language: str = "en",
) -> PracticeFeedback:
    """Score a practice answer and produce structured coaching feedback.

    ``resume_data`` may be None (no resume context available); the prompt then
    coaches on structure and delivery instead of grounding on invented
    experience.
    """
    prompt = INTERVIEW_PRACTICE_FEEDBACK_PROMPT.format(
        scenario_title=_truncate_text_for_prompt(scenario_title, 300),
        scenario_description=_truncate_text_for_prompt(
            scenario_description or "",
            _SCENARIO_DESCRIPTION_PROMPT_CHAR_LIMIT,
        ),
        answer=_truncate_text_for_prompt(answer, _ANSWER_PROMPT_CHAR_LIMIT),
        resume_data=(
            _serialize_resume_data_for_prompt(resume_data)
            if resume_data
            else "{}"
        ),
        output_language=get_language_name(language),
    )
    config = get_llm_config()
    max_tokens = get_safe_max_tokens(get_model_name(config), requested=2048)

    result = await complete_json(
        prompt=prompt,
        system_prompt=(
            "You are a supportive, honest interview coach. Output truthful, "
            "resume-grounded coaching feedback as JSON only."
        ),
        max_tokens=max_tokens,
        schema_type="interview_practice",
    )

    return PracticeFeedback.model_validate(result)