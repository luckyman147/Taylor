"""Unit tests for outreach email body structure helpers."""

from app.routers.enrichment import (
    _append_contact_footer,
    _looks_incomplete,
    _normalize_email_body,
    _recipient_greeting_name,
    _strip_template_scaffolding,
)
from app.services.cover_letter import _normalize_outreach_lines
from app.prompts.enrichment import GENERATE_OUTREACH_EMAIL_PROMPT
from app.prompts.correspondence import OUTREACH_MESSAGE_PROMPT


class TestRecipientGreetingName:
    def test_uses_first_name_when_provided(self) -> None:
        assert _recipient_greeting_name("Camille Dupont", "Hugging Face") == "Camille"

    def test_never_returns_not_provided(self) -> None:
        assert _recipient_greeting_name(None, "Hugging Face") == "Hugging Face team"
        assert (
            _recipient_greeting_name("not provided", "Hugging Face") == "Hugging Face team"
        )

    def test_falls_back_to_hiring_team(self) -> None:
        assert _recipient_greeting_name(None, "") == "Hiring Team"
        assert _recipient_greeting_name(None, "(Company)") == "Hiring Team"


class TestNormalizeEmailBody:
    def test_empty_body(self) -> None:
        assert _normalize_email_body("") == ""
        assert _normalize_email_body("   \n  ") == ""

    def test_strips_markdown_fences(self) -> None:
        body = "```\nHi team,\n\nHello there.\n```"
        out = _normalize_email_body(body)
        assert not out.startswith("```")
        assert out.startswith("Hi team,")

    def test_blank_line_after_greeting(self) -> None:
        out = _normalize_email_body("Hi Hugging Face team,\nI work on ML.")
        lines = out.split("\n")
        assert lines[0] == "Hi Hugging Face team,"
        assert lines[1] == ""
        assert lines[2].startswith("I work")

    def test_replaces_bad_greeting(self) -> None:
        out = _normalize_email_body("Dear not provided,\n\nHello.")
        assert "not provided" not in out.lower()
        assert out.startswith("Hi Hiring Team,")

    def test_single_wall_of_text_is_split_into_paragraphs(self) -> None:
        wall = (
            "Hi team, I have been building RAG systems with transformers for three years. "
            "Last year I shipped an eval harness that cut hallucination rates in half. "
            "I would love to chat about open roles on your applied team if that makes sense. "
            "Happy to share a short write-up of the work."
        )
        out = _normalize_email_body(wall)
        assert "\n\n" in out
        assert out.split("\n")[0].startswith("Hi team,")

    def test_collapses_triple_blank_lines(self) -> None:
        out = _normalize_email_body("Hi,\n\n\n\n\nBody line.")
        assert "\n\n\n" not in out
        assert "Body line." in out

    def test_preserves_existing_paragraph_breaks(self) -> None:
        body = "Hi,\n\nFirst paragraph.\n\nSecond paragraph."
        out = _normalize_email_body(body)
        assert out == body


class TestAppendContactFooter:
    def test_appends_when_missing(self) -> None:
        body = "Hi,\n\nBody.\n\nBest,\nJane"
        footer = "**Jane Doe** | [jane@example.com](mailto:jane@example.com)"
        out = _append_contact_footer(body, footer)
        assert out.endswith(footer)
        assert "\n\n" + footer in out

    def test_skips_when_already_present(self) -> None:
        footer = "**Jane Doe** | [jane@example.com](mailto:jane@example.com)"
        body = f"Hi,\n\nBody.\n\n{footer}"
        assert _append_contact_footer(body, footer) == body

    def test_empty_footer_noop(self) -> None:
        assert _append_contact_footer("Hi,\n\nBody.", "") == "Hi,\n\nBody."


class TestOutreachPromptStructure:
    def test_email_prompt_requires_greeting_and_blank_lines(self) -> None:
        assert "Required Email Structure" in GENERATE_OUTREACH_EMAIL_PROMPT
        assert "blank line" in GENERATE_OUTREACH_EMAIL_PROMPT.lower()
        assert "dear not provided" in GENERATE_OUTREACH_EMAIL_PROMPT.lower()
        assert "NEVER write" in GENERATE_OUTREACH_EMAIL_PROMPT
        assert "contact footer" in GENERATE_OUTREACH_EMAIL_PROMPT.lower()

    def test_builder_outreach_prompt_requires_multiline_structure(self) -> None:
        assert "Required structure" in OUTREACH_MESSAGE_PROMPT
        assert "greeting line" in OUTREACH_MESSAGE_PROMPT.lower()
        assert "blank line" in OUTREACH_MESSAGE_PROMPT.lower()
        assert "{job_description}" in OUTREACH_MESSAGE_PROMPT
        assert "{resume_data}" in OUTREACH_MESSAGE_PROMPT
        assert "{output_language}" in OUTREACH_MESSAGE_PROMPT


class TestNormalizeOutreachLines:
    def test_adds_blank_after_greeting(self) -> None:
        out = _normalize_outreach_lines("Hi Hiring Team,\nI saw your posting and...")
        assert out.split("\n")[1] == ""

    def test_strips_fences(self) -> None:
        out = _normalize_outreach_lines("```\nHi,\n\nBody.\n```")
        assert out.startswith("Hi,")
        assert not out.startswith("```")


class TestIncompleteDetection:
    def test_detects_ellipsis_and_template_tokens(self) -> None:
        bad = (
            "Hi team,\n\n"
            "I thought I'd reach out because...\n\n"
            "I've been building RAG systems with your models, most recently shipping X that did Y.\n\n"
            "Best,\nJane"
        )
        assert _looks_incomplete(bad) is True

    def test_complete_email_is_not_incomplete(self) -> None:
        good = (
            "Hi Kyros IT team,\n\n"
            "I came across your work on internal tooling for logistics and wanted to write "
            "about the full-stack opening on your site.\n\n"
            "I ship React and Node APIs in production and recently built an Expo app used "
            "by a local gym for class bookings.\n\n"
            "Worth a short chat next week?\n\n"
            "Best,\nMohamed Iyed Touati"
        )
        assert _looks_incomplete(good) is False

    def test_ignores_urls_with_ellipsis_like_paths(self) -> None:
        body2 = "Hi,\n\nDocs at https://example.com/a...b are useful.\n\nBest,\nJane"
        assert _looks_incomplete(body2) is False
        body3 = "Hi,\n\nSee [docs](https://example.com/x...y) for setup.\n\nBest,\nJane"
        assert _looks_incomplete(body3) is False

    def test_strip_removes_template_scaffolding(self) -> None:
        raw = (
            "Hi team,\n\n"
            "I thought I'd reach out because...\n\n"
            "I've been working on...\n\n"
            "Most recently shipping X that did Y.\n\n"
            "Best,\n"
            "Your Name"
        )
        out = _strip_template_scaffolding(raw)
        assert "because..." not in out
        assert "Your Name" not in out
        assert "I've been working on..." not in out
        assert "X that did Y" not in out
        assert _looks_incomplete(out) is False or "..." not in out


class TestOutreachPromptNoEllipsisExamples:
    def test_prompt_does_not_teach_trailing_ellipsis(self) -> None:
        # Old bug: "Prefer simple language" bullets ended with "..."
        prefer_idx = GENERATE_OUTREACH_EMAIL_PROMPT.find("Prefer simple language")
        assert prefer_idx != -1
        section = GENERATE_OUTREACH_EMAIL_PROMPT[prefer_idx : prefer_idx + 400]
        assert "because..." not in section
        assert "COMPLETE sentences" in GENERATE_OUTREACH_EMAIL_PROMPT
        assert "X that did Y" in GENERATE_OUTREACH_EMAIL_PROMPT  # listed as banned
        assert "Do NOT copy these words" in GENERATE_OUTREACH_EMAIL_PROMPT
