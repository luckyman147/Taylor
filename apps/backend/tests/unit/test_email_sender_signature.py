"""Unit tests for email_sender HTML/text signature injection."""

from app.services.email_sender import (
    EmailDeliveryConfig,
    OutgoingEmail,
    _build_message,
)


def _cfg() -> EmailDeliveryConfig:
    return EmailDeliveryConfig(
        smtp_host="smtp.example.com",
        sender_email="me@example.com",
        sender_name="Me",
        password="x",
    )


class TestBuildMessageSignature:
    def test_no_signature_keeps_plain_body(self) -> None:
        msg = _build_message(
            _cfg(),
            OutgoingEmail(
                to_email="to@example.com",
                subject="Hi",
                body="Hello there.\n\nBest,\nJane",
            ),
        )
        plain = msg.get_body(preferencelist=("plain",)).get_content()
        assert plain.strip().startswith("Hello there.")
        assert "border-top" not in plain

        html = msg.get_body(preferencelist=("html",)).get_content()
        assert "Hello there." in html
        assert "border-top" not in html

    def test_html_signature_only_in_html_part(self) -> None:
        sig_html = '<p style="color:#0a0"><strong>Jane Doe</strong><br>Engineer</p>'
        sig_text = "Jane Doe\nEngineer"
        msg = _build_message(
            _cfg(),
            OutgoingEmail(
                to_email="to@example.com",
                subject="Hi",
                body="Hello there.",
                html_signature=sig_html,
                text_signature=sig_text,
            ),
        )
        plain = msg.get_body(preferencelist=("plain",)).get_content()
        html = msg.get_body(preferencelist=("html",)).get_content()

        # Text fallback present, raw HTML tags not required in plain.
        assert "Jane Doe" in plain
        assert "Hello there." in plain
        assert plain.index("Hello there.") < plain.index("Jane Doe")

        # HTML part has signature block with separator.
        assert "border-top" in html
        assert "Jane Doe" in html
        assert "<p" in html or "Jane" in html

    def test_signature_sanitized_on_build(self) -> None:
        # Even if a caller forgets to sanitize, build re-sanitizes via block helper.
        msg = _build_message(
            _cfg(),
            OutgoingEmail(
                to_email="to@example.com",
                subject="Hi",
                body="Body.",
                html_signature="<script>alert(1)</script><p>Safe</p>",
            ),
        )
        html = msg.get_body(preferencelist=("html",)).get_content()
        assert "alert(1)" not in html
        assert "Safe" in html
