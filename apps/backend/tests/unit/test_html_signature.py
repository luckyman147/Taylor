"""Unit tests for the HTML email signature sanitizer + text fallback."""

from app.services.html_signature import (
    build_html_signature_block,
    has_signature,
    sanitize_signature_html,
    signature_to_text,
)


class TestSanitizeSignatureHtml:
    def test_empty_input(self) -> None:
        assert sanitize_signature_html("") == ""
        assert sanitize_signature_html(None) == ""
        assert sanitize_signature_html("   \n  ") == ""

    def test_keeps_allowed_inline_html(self) -> None:
        raw = (
            '<p style="color:#111;font-size:14px;"><strong>Jane Doe</strong><br>'
            '<a href="https://jane.dev">Portfolio</a></p>'
        )
        out = sanitize_signature_html(raw)
        assert "<strong>" in out
        assert 'href="https://jane.dev"' in out
        assert "color" in out

    def test_strips_script_tags(self) -> None:
        out = sanitize_signature_html(
            "<p>Hi</p><script>alert(1)</script><p>Bye</p>"
        )
        assert "script" not in out.lower()
        assert "alert" not in out
        assert "Hi" in out
        assert "Bye" in out

    def test_strips_event_handlers(self) -> None:
        out = sanitize_signature_html(
            '<a href="https://x.dev" onclick="steal()">x</a>'
        )
        assert "onclick" not in out
        assert 'href="https://x.dev"' in out

    def test_blocks_javascript_urls(self) -> None:
        out = sanitize_signature_html('<a href="javascript:alert(1)">bad</a>')
        assert "javascript:" not in out.lower()

    def test_allows_mailto_and_tel(self) -> None:
        out = sanitize_signature_html(
            '<a href="mailto:a@b.c">email</a> <a href="tel:+15550100">call</a>'
        )
        assert "mailto:a@b.c" in out
        assert "tel:+15550100" in out

    def test_unwraps_unknown_tags_but_keeps_text(self) -> None:
        out = sanitize_signature_html("<article><p>Keep me</p></article>")
        assert "article" not in out
        assert "Keep me" in out

    def test_strips_iframe_and_style_blocks(self) -> None:
        out = sanitize_signature_html(
            '<style>p{color:red}</style><iframe src="https://evil"></iframe><p>ok</p>'
        )
        assert "iframe" not in out
        assert "<style" not in out
        assert "ok" in out

    def test_keeps_avatar_border_radius_and_object_fit(self) -> None:
        # Frontend photoHtml emits a circular avatar; save must not strip it.
        raw = (
            '<img src="https://cdn.example/a.png" alt="Jane" width="48" height="48" '
            'style="border-radius:50%;object-fit:cover" />'
        )
        out = sanitize_signature_html(raw)
        assert "border-radius:50%" in out
        assert "object-fit:cover" in out

    def test_keeps_font_style_italic(self) -> None:
        out = sanitize_signature_html(
            '<span style="color:#111;font-style:italic;font-weight:700">Name</span>'
        )
        assert "font-style:italic" in out
        assert "font-weight:700" in out


class TestSignatureToText:
    def test_br_becomes_newline(self) -> None:
        text = signature_to_text("<strong>Jane</strong><br>Engineer")
        assert "Jane" in text
        assert "Engineer" in text
        assert "Jane" in text.splitlines()[0]

    def test_strips_tags(self) -> None:
        text = signature_to_text('<p><a href="https://x.dev">Site</a></p>')
        assert "Site" in text
        assert "<" not in text

    def test_empty(self) -> None:
        assert signature_to_text("") == ""
        assert signature_to_text(None) == ""


class TestHasSignatureAndBlock:
    def test_has_signature(self) -> None:
        assert has_signature("<p>x</p>") is True
        assert has_signature("  ") is False
        assert has_signature("") is False
        assert has_signature(None) is False

    def test_build_block_wraps_separator(self) -> None:
        block = build_html_signature_block("<p>Jane</p>")
        assert block.startswith("<div")
        assert "border-top" in block
        assert "Jane" in block

    def test_build_block_empty(self) -> None:
        assert build_html_signature_block("") == ""
        assert build_html_signature_block("<script>x</script>") == ""
