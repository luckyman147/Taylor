"""Service tests for cover-letter/outreach prompt construction."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.prompts.language import resolve_correspondence_language
from app.services.cover_letter import (
    generate_cover_letter,
    generate_outreach_message,
    strip_ats_analysis,
)

FRENCH_JD = (
    "Nous recherchons un stagiaire pour développer des composants d'IA avec "
    "notre équipe sur une plateforme de jeu compétitif."
)

SAMPLE_RESUME = {
    "personalInfo": {"name": "Mohamed Iyed Touati"},
    "summary": "Full-stack engineer.",
    "workExperience": [],
    "education": [],
    "personalProjects": [],
    "additional": {
        "technicalSkills": ["FastAPI", "React"],
        "languages": ["French (Professional)", "English (Professional)"],
        "certificationsTraining": ["AWS Certified"],
        "awards": ["Best Growth 2024"],
        "skillGroups": [{"name": "Backend", "skills": ["FastAPI", "Python"]}],
    },
    "customSections": {"Volunteering": ["Mentored students"]},
}

JOB_KEYWORDS = {
    "company": "Nugget Finder",
    "role": "Stage PIE",
    "industry": "Gaming",
    "seniority_level": "intern",
    "key_responsibilities": ["Génération intelligente des défis"],
    "required_skills": ["LLM", "REST API"],
    "preferred_skills": [],
    "keywords": ["IA", "LLM"],
}


async def _capture_cover_letter_prompt(
    custom_prompt: str,
    instruction: str | None = None,
) -> tuple[str, str]:
    captured: dict[str, str] = {}

    async def fake_complete(*, prompt: str, **_: object) -> str:
        captured["prompt"] = prompt
        return "Dear Hiring Team at Nugget Finder,\n\nBody\n\nSincerely,\nMohamed Iyed Touati"

    with (
        patch(
            "app.services.cover_letter.load_config_file",
            return_value={"cover_letter_prompt": custom_prompt},
        ),
        patch("app.services.cover_letter.complete", side_effect=fake_complete),
    ):
        result = await generate_cover_letter(
            SAMPLE_RESUME,
            FRENCH_JD,
            "fr",
            instruction,
            company_name="Nugget Finder",
            job_title="Stage PIE",
            job_keywords=JOB_KEYWORDS,
        )
    return result, captured["prompt"]


@pytest.mark.asyncio
async def test_custom_prompt_is_kept_and_grounded():
    custom = (
        "CUSTOM COVER PROMPT\n"
        "Job: {job_description}\n"
        "Resume: {resume_data}\n"
        "Language: {output_language}"
    )
    result, prompt = await _capture_cover_letter_prompt(
        custom, "Mention my FastAPI work"
    )

    assert result.startswith("Dear Hiring Team")
    assert "CUSTOM COVER PROMPT" in prompt
    assert FRENCH_JD in prompt
    assert "Company (use exactly): Nugget Finder" in prompt
    assert "Role: Stage PIE" in prompt
    assert "Industry: Gaming" in prompt
    assert "## Authoritative candidate additional information" in prompt
    assert "Languages: French (Professional), English (Professional)" in prompt
    assert "Certifications/training: AWS Certified" in prompt
    assert "Awards: Best Growth 2024" in prompt
    assert "Skill groups: Backend: FastAPI, Python" in prompt
    assert "Volunteering" in prompt
    assert "## HIGHEST PRIORITY" in prompt
    assert "Mention my FastAPI work" in prompt
    assert "Do not include an ATS score" in prompt
    assert "No headings, labels, markdown bold" in prompt

    assert prompt.index("CUSTOM COVER PROMPT") < prompt.index("## HIGHEST PRIORITY")
    assert prompt.index("## HIGHEST PRIORITY") < prompt.index("## Output contract")


@pytest.mark.asyncio
async def test_empty_custom_prompt_uses_default_and_still_gets_context():
    _, prompt = await _capture_cover_letter_prompt("")

    assert "Write a brief cover letter for this job application." in prompt
    assert "Company (use exactly): Nugget Finder" in prompt
    assert "## Authoritative candidate additional information" in prompt


@pytest.mark.asyncio
async def test_outreach_gets_job_identity_and_instruction_priority():
    captured: dict[str, str] = {}

    async def fake_complete(*, prompt: str, **_: object) -> str:
        captured["prompt"] = prompt
        return "Hi Hiring Team,\n\nBody\n\nBest,\nMohamed"

    with (
        patch(
            "app.services.cover_letter.load_config_file",
            return_value={"outreach_message_prompt": "CUSTOM OUTREACH {job_description} {resume_data} {output_language}"},
        ),
        patch("app.services.cover_letter.complete", side_effect=fake_complete),
    ):
        await generate_outreach_message(
            SAMPLE_RESUME,
            FRENCH_JD,
            "fr",
            "Keep it short",
            company_name="Nugget Finder",
            job_title="Stage PIE",
            job_keywords=JOB_KEYWORDS,
        )

    prompt = captured["prompt"]
    assert "CUSTOM OUTREACH" in prompt
    assert "Company (use exactly): Nugget Finder" in prompt
    assert "never address the candidate" in prompt
    assert "## HIGHEST PRIORITY" in prompt
    assert "Keep it short" in prompt
    assert "## Output contract (final)" in prompt
    assert "Return only the outreach message" in prompt


def test_strip_ats_analysis_removes_trailing_section():
    text = "Dear Hiring Team,\n\nBody.\n\nSincerely,\nJane\n\nATS Match Analysis\nScore: 90"

    assert strip_ats_analysis(text) == "Dear Hiring Team,\n\nBody.\n\nSincerely,\nJane"


def test_resolve_correspondence_language_prefers_configured_setting():
    with patch("app.config_cache.load_config", return_value={"content_language": "es"}):
        assert resolve_correspondence_language(FRENCH_JD) == "es"


def test_resolve_correspondence_language_detects_french_jd_when_unset():
    with patch(
        "app.config_cache.load_config",
        return_value={"content_language": None, "language": "en"},
    ):
        assert resolve_correspondence_language(FRENCH_JD) == "fr"


def test_resolve_correspondence_language_falls_back_to_english():
    with patch("app.config_cache.load_config", return_value={}):
        assert resolve_correspondence_language("Need FastAPI") == "en"
