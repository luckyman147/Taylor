"""Content guards on the tailoring prompts.

Two invariants this locks:
1. JD-keyword incorporation is the DEFAULT across sections (the maintainer goal).
2. The anti-fabrication clauses stay present. Per the truthfulness audit,
   invented bullet *narrative* (e.g. "led 12 engineers") is NOT caught by
   verify_diff_result (its metric regex misses bare counts) or verify_alignment
   (which only checks skills/certs/companies) — so these prompt clauses are the
   ONLY guard. If a future edit drops them, this test fails loudly.
"""

from app.prompts.templates import (
    COVER_LETTER_PROMPT,
    DIFF_IMPROVE_PROMPT,
    DIFF_PROJECT_BULLETS_PROMPT,
    INTERVIEW_PREP_PROMPT,
)
from app.prompts.refinement import (
    KEYWORD_INJECTION_PROMPT,
    VALIDATION_POLISH_PROMPT,
)


class TestJdIncorporationIsDefault:
    def test_diff_prompt_reframes_by_default(self):
        assert "By DEFAULT" in DIFF_IMPROVE_PROMPT
        assert "reframe" in DIFF_IMPROVE_PROMPT.lower()

    def test_keyword_injection_targets_every_section_by_default(self):
        assert "EVERY section" in KEYWORD_INJECTION_PROMPT
        assert "DEFAULT" in KEYWORD_INJECTION_PROMPT

    def test_cover_letter_reframes_in_jd_terminology(self):
        assert "terminology" in COVER_LETTER_PROMPT.lower()


class TestAntiFabricationClausesPresent:
    def test_diff_prompt_keeps_no_invented_work_clauses(self):
        # rule 11's reframe permission must ship WITH its anti-fabrication clause
        assert "Do NOT add new work, metrics, or responsibilities" in DIFF_IMPROVE_PROMPT
        # rule 2 must remain
        assert "Do not invent metrics or achievements not supported by the original resume" in DIFF_IMPROVE_PROMPT

    def test_keyword_injection_keeps_no_invent_clauses(self):
        assert "do not invent new content, metrics, or work history" in KEYWORD_INJECTION_PROMPT
        assert "Do NOT add skills, technologies, or certifications not in the master resume" in KEYWORD_INJECTION_PROMPT

    def test_diff_prompt_bullet_craft_rules_present(self):
        assert "BULLET CRAFT" in DIFF_IMPROVE_PROMPT
        assert "RESULT → ACTION → TECHNOLOGY/METHOD → PURPOSE" in DIFF_IMPROVE_PROMPT
        assert "ACTION → TECHNICAL WORK → PURPOSE" in DIFF_IMPROVE_PROMPT
        assert "Never leave a bare action" in DIFF_IMPROVE_PROMPT

    def test_diff_prompt_skills_never_removed(self):
        assert "Never remove an existing skill" in DIFF_IMPROVE_PROMPT
        assert "safety net" in DIFF_IMPROVE_PROMPT

    def test_project_prompt_is_purpose_led(self):
        assert "why it exists" in DIFF_PROJECT_BULLETS_PROMPT
        assert "purpose explicitly" in DIFF_PROJECT_BULLETS_PROMPT

    def test_refiner_prompts_keep_bullet_guardrails(self):
        for prompt in (KEYWORD_INJECTION_PROMPT, VALIDATION_POLISH_PROMPT):
            assert "Worked on" in prompt
            assert "Responsible for" in prompt
            assert "scope or purpose" in prompt

    def test_cover_letter_keeps_no_invent_clauses(self):
        assert "Do NOT invent information not in the resume" in COVER_LETTER_PROMPT
        assert "proven experience supports it" in COVER_LETTER_PROMPT

    def test_interview_prep_keeps_no_fabrication_guardrails(self):
        assert "Do NOT invent experience" in INTERVIEW_PREP_PROMPT
        assert "tools, employers, metrics, certifications, skills" in INTERVIEW_PREP_PROMPT
        assert "Skill gaps are preparation targets only" in INTERVIEW_PREP_PROMPT
        assert "Do NOT translate JSON property names" in INTERVIEW_PREP_PROMPT
        assert "role_fit_analysis" in INTERVIEW_PREP_PROMPT
        assert "talking_points" in INTERVIEW_PREP_PROMPT
