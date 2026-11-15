"""Unit tests for best-effort contact enrichment extraction."""

from app.services.contact_enrichment import (
    extract_emails,
    extract_phones,
    guess_pattern_email,
    normalize_phone,
)


class TestExtractEmails:
    def test_finds_and_normalizes(self):
        text = "Reach us at Sales@Acme.com or jane@acme.com."
        emails = extract_emails(text)
        assert "sales@acme.com" in emails
        assert "jane@acme.com" in emails

    def test_dedupes(self):
        assert extract_emails("a@b.com a@b.com") == ["a@b.com"]

    def test_filters_image_assets(self):
        assert extract_emails("logo sprite@2x.png") == []
        assert extract_emails("mail@example.com.sentry.io") == []


class TestExtractPhones:
    def test_international(self):
        phones = extract_phones("Call +216 71 123 456 today")
        assert any("216" in p for p in phones)

    def test_rejects_too_short(self):
        assert extract_phones("order #12345 now") == []


class TestNormalizePhone:
    def test_valid(self):
        assert normalize_phone("+1 (555) 010-2030") == "+1 (555) 010-2030"

    def test_too_few_digits(self):
        assert normalize_phone("12345") is None


class TestGuessPatternEmail:
    def test_first_dot_last(self):
        assert guess_pattern_email("Jane Doe", "acme.com") == "jane.doe@acme.com"

    def test_single_name_returns_none(self):
        assert guess_pattern_email("Plato", "acme.com") is None

    def test_empty_inputs(self):
        assert guess_pattern_email("", "acme.com") is None
        assert guess_pattern_email("Jane", "") is None
