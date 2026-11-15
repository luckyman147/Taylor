"""Sanitization/fallback for generated resume titles and tailored filenames.

Covers the three layers that produced messy/wrong CV names:
- ``sanitize_resume_title`` rejects reasoning/markdown/preamble garbage
- ``build_fallback_resume_title`` gives a deterministic identity-based name
- ``_tailored_filename`` never compounds the ``tailored_`` prefix
- ``_pdf_content_disposition`` names the PDF after the title
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.routers.resumes import _pdf_content_disposition, _tailored_filename
from app.services.cover_letter import (
    build_fallback_resume_title,
    generate_resume_title,
    sanitize_resume_title,
)


class TestSanitizeResumeTitle:
    def test_clean_title_passes_through(self) -> None:
        assert (
            sanitize_resume_title("John Doe - Senior Frontend Engineer @ Stripe")
            == "John Doe - Senior Frontend Engineer @ Stripe"
        )

    def test_strips_quotes_and_whitespace(self) -> None:
        assert sanitize_resume_title('  "Software Engineer @ Acme"  ') == (
            "Software Engineer @ Acme"
        )

    def test_takes_first_non_empty_line_only(self) -> None:
        raw = "Software Engineer @ Acme\n\n**Deconstructing the Info**\nmore rambling"
        assert sanitize_resume_title(raw) == "Software Engineer @ Acme"

    def test_strips_markdown_emphasis(self) -> None:
        assert sanitize_resume_title("**Senior Backend Engineer @ Acme**") == (
            "Senior Backend Engineer @ Acme"
        )

    def test_strips_trailing_dangling_at_sign(self) -> None:
        assert sanitize_resume_title("Software Engineer @") == "Software Engineer"

    def test_rejects_reasoning_preamble(self) -> None:
        assert (
            sanitize_resume_title(
                "Okay, here's my interpretation of that thought process, assuming I'm already wel"
            )
            is None
        )
        assert sanitize_resume_title("Sure! Let me extract the title...") is None
        assert sanitize_resume_title("Here's the title you asked for:") is None

    def test_rejects_too_short_output(self) -> None:
        assert sanitize_resume_title("Moh") is None
        assert sanitize_resume_title("a") is None

    def test_rejects_json_leftovers(self) -> None:
        assert sanitize_resume_title('{"title": "Engineer"}') is None

    def test_rejects_empty_and_none(self) -> None:
        assert sanitize_resume_title("") is None
        assert sanitize_resume_title(None) is None
        assert sanitize_resume_title("\n\n  \n") is None

    def test_truncates_to_100_chars(self) -> None:
        result = sanitize_resume_title("x" * 150)
        assert result is not None
        assert len(result) == 100


class TestBuildFallbackResumeTitle:
    def test_full_identity(self) -> None:
        assert (
            build_fallback_resume_title("John Doe", "Engineer", "Acme")
            == "John Doe - Engineer @ Acme"
        )

    def test_role_only(self) -> None:
        assert (
            build_fallback_resume_title("John Doe", "Engineer") == "John Doe - Engineer"
        )

    def test_company_only(self) -> None:
        assert (
            build_fallback_resume_title("John Doe", None, "Acme") == "John Doe - Acme"
        )

    def test_no_candidate_name(self) -> None:
        assert (
            build_fallback_resume_title(None, "Engineer", "Acme") == "Engineer @ Acme"
        )

    def test_nothing_known_returns_none(self) -> None:
        assert build_fallback_resume_title(None, None, None) is None
        assert build_fallback_resume_title("", "", "") is None

    def test_truncates_to_100_chars(self) -> None:
        result = build_fallback_resume_title("N" * 60, "R" * 60, "C" * 60)
        assert result is not None
        assert len(result) <= 100


class TestGenerateResumeTitle:
    async def test_raises_on_unusable_llm_output(self) -> None:
        with (
            patch(
                "app.services.cover_letter.complete",
                new_callable=AsyncMock,
                return_value="Okay, here's my interpretation of that thought process...",
            ),
            pytest.raises(ValueError),
        ):
            await generate_resume_title("Some job description")

    async def test_disables_reasoning_fallback(self) -> None:
        with patch(
            "app.services.cover_letter.complete",
            new_callable=AsyncMock,
            return_value="John Doe - Engineer @ Acme",
        ) as mock_complete:
            result = await generate_resume_title("JD", "en", "John Doe")
            assert result == "John Doe - Engineer @ Acme"
            assert mock_complete.call_args.kwargs["allow_reasoning_fallback"] is False
            assert mock_complete.call_args.kwargs["max_tokens"] == 200

    async def test_clean_output_returned(self) -> None:
        with patch(
            "app.services.cover_letter.complete",
            new_callable=AsyncMock,
            return_value='"Jane Roe - Data Scientist @ DataCo"',
        ):
            result = await generate_resume_title("JD")
            assert result == "Jane Roe - Data Scientist @ DataCo"


class TestTailoredFilename:
    def test_adds_prefix_once(self) -> None:
        assert _tailored_filename("cv.docx") == "tailored_cv.docx"

    def test_does_not_compound_on_retallor(self) -> None:
        assert _tailored_filename("tailored_cv.docx") == "tailored_cv.docx"
        assert _tailored_filename("tailored_tailored_cv.docx") == "tailored_cv.docx"
        assert (
            _tailored_filename("tailored_tailored_tailored_iyed-t-.docx")
            == "tailored_iyed-t-.docx"
        )

    def test_falls_back_when_missing(self) -> None:
        assert _tailored_filename(None) == "tailored_resume"
        assert _tailored_filename("  ") == "tailored_resume"


class TestPdfContentDisposition:
    def test_uses_title_when_present(self) -> None:
        header = _pdf_content_disposition({"title": "John Doe - Engineer"}, "id-1")
        assert 'filename="John Doe - Engineer.pdf"' in header

    def test_falls_back_to_resume_id(self) -> None:
        header = _pdf_content_disposition({"title": None}, "id-1")
        assert 'filename="resume_id-1.pdf"' in header

    def test_replaces_invalid_filename_characters(self) -> None:
        header = _pdf_content_disposition({"title": 'a/b\\c:d*e?f"g<h>i|j'}, "id-1")
        assert 'filename="a-b-c-d-e-f-g-h-i-j.pdf"' in header

    def test_non_ascii_title_gets_rfc5987_filename_star(self) -> None:
        header = _pdf_content_disposition({"title": "Développeur Full Stack"}, "id-1")
        assert "filename*=UTF-8''" in header
        assert "%C3%89" in header or "%C3%A9" in header

    def test_title_truncated_to_100_chars(self) -> None:
        header = _pdf_content_disposition({"title": "x" * 150}, "id-1")
        name_part = header.split('filename="')[1].split('.pdf"')[0]
        assert len(name_part) == 100
