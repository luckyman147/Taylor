"""Sanitize and render the user-configured HTML email signature.

The signature is stored on the career profile (``email_signature``) and
injected into the HTML alternative of outgoing emails only. Input is
untrusted HTML (user-authored but must not carry scripts/event handlers),
so both save and send paths run :func:`sanitize_signature_html`.
"""

from __future__ import annotations

import re
from html import unescape
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

# Tags allowed inside an email signature fragment.
_ALLOWED_TAGS = frozenset(
    {
        "a",
        "b",
        "blockquote",
        "br",
        "div",
        "em",
        "font",
        "h1",
        "h2",
        "h3",
        "h4",
        "hr",
        "i",
        "img",
        "li",
        "p",
        "span",
        "strong",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "u",
        "ul",
        "ol",
    }
)

# Per-tag attribute allowlist (lowercase names).
_ALLOWED_ATTRS: dict[str, frozenset[str]] = {
    "a": frozenset({"href", "title", "target", "rel"}),
    "img": frozenset({"src", "alt", "width", "height"}),
    "table": frozenset({"border", "cellpadding", "cellspacing", "width", "align"}),
    "td": frozenset({"align", "valign", "width", "colspan", "rowspan"}),
    "th": frozenset({"align", "valign", "width", "colspan", "rowspan"}),
    "tr": frozenset({"align", "valign"}),
    "font": frozenset({"color", "size", "face"}),
    "div": frozenset({"align"}),
    "p": frozenset({"align"}),
}
_DEFAULT_ATTRS = frozenset({"align", "style", "class", "title"})

_SAFE_STYLE_RE = re.compile(
    r"(color|font-size|font-family|font-style|font-weight|line-height|text-align|"
    r"text-decoration|margin|margin-top|margin-bottom|margin-left|margin-right|"
    r"padding|padding-top|padding-bottom|padding-left|padding-right|"
    r"border|border-top|border-bottom|border-left|border-right|"
    r"border-color|border-style|border-width|border-radius|"
    r"background-color|width|height|"
    r"max-width|display|object-fit|vertical-align|letter-spacing)\s*:\s*[^;{}]+",
    re.IGNORECASE,
)
_URL_ATTRS = frozenset({"href", "src"})


def _safe_url(value: str) -> str | None:
    """Allow http(s), mailto, tel, and relative anchors only."""
    raw = unescape(value.strip())
    if not raw:
        return None
    if raw.startswith("#"):
        return raw
    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme in {"http", "https", "mailto", "tel"}:
        return raw
    # Bare domains like example.com/path — treat as https.
    if not scheme and raw.startswith("//"):
        return f"https:{raw}"
    if not scheme and ("." in raw.split("/")[0] or raw.startswith("/")):
        return f"https:{raw.lstrip('/')}" if not raw.startswith("/") else raw
    return None


def _sanitize_style(value: str) -> str | None:
    parts = [m.group(0).strip().rstrip(";") for m in _SAFE_STYLE_RE.finditer(value)]
    parts = [p for p in parts if p]
    if not parts:
        return None
    return "; ".join(parts)


def _filter_attrs(tag: Tag) -> None:
    allowed = _ALLOWED_ATTRS.get(tag.name, _DEFAULT_ATTRS) | _DEFAULT_ATTRS
    for attr in list(tag.attrs):
        name = attr.lower()
        if name.startswith("on"):
            del tag.attrs[attr]
            continue
        if name in _URL_ATTRS:
            safe = _safe_url(str(tag.attrs[attr]))
            if safe is None:
                del tag.attrs[attr]
            else:
                tag.attrs[attr] = safe
            continue
        if name == "style":
            safe_style = _sanitize_style(str(tag.attrs[attr]))
            if safe_style is None:
                del tag.attrs[attr]
            else:
                tag.attrs[attr] = safe_style
            continue
        if name not in allowed:
            del tag.attrs[attr]
        elif name == "target":
            # Only allow _blank on links, force rel noopener.
            if tag.name == "a" and str(tag.attrs[attr]).lower() == "_blank":
                tag.attrs["rel"] = "noopener noreferrer"
            else:
                del tag.attrs[attr]


def _strip_dangerous_markup(text: str) -> str:
    """Remove script/style/iframe blocks (with content) then stray tags."""
    # Full blocks with content first — otherwise inner JS becomes text nodes.
    text = re.sub(
        r"<(script|style|iframe|object|embed)\b[^>]*>.*?</\1\s*>",
        "",
        text,
        flags=re.I | re.S,
    )
    # Unclosed / self-closing leftovers.
    text = re.sub(
        r"</?(script|style|iframe|object|embed|link|meta)\b[^>]*>",
        "",
        text,
        flags=re.I,
    )
    return text


def sanitize_signature_html(raw: str | None) -> str:
    """Return a safe HTML fragment for the email signature (may be empty)."""
    if not raw or not raw.strip():
        return ""
    text = _strip_dangerous_markup(raw.strip())
    soup = BeautifulSoup(text, "html.parser")

    for node in list(soup.find_all(True)):
        if not isinstance(node, Tag):
            continue
        name = node.name.lower()
        if name not in _ALLOWED_TAGS:
            # Unwrap unknown tags (keep text); drop dangerous containers fully.
            if name in {"script", "style", "iframe", "object", "embed", "link", "meta"}:
                node.decompose()
            else:
                node.unwrap()
            continue
        node.name = name
        _filter_attrs(node)

    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()

    result = str(soup).strip()
    if not result:
        return ""
    # Second pass: re-parse to catch anything introduced by unwrap.
    result = _strip_dangerous_markup(result)
    soup2 = BeautifulSoup(result, "html.parser")
    for node in list(soup2.find_all(True)):
        if not isinstance(node, Tag):
            continue
        name = node.name.lower()
        if name not in _ALLOWED_TAGS:
            if name in {"script", "style", "iframe", "object", "embed"}:
                node.decompose()
            else:
                node.unwrap()
            continue
        _filter_attrs(node)
    for comment in soup2.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()
    return str(soup2).strip()


def signature_to_text(html: str | None) -> str:
    """Plain-text fallback for the text/plain multipart part."""
    if not html or not html.strip():
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for block in soup.find_all(["p", "div", "tr", "li", "h1", "h2", "h3", "h4", "blockquote"]):
        block.append("\n")
    text = soup.get_text()
    text = unescape(text)
    # Normalize newlines and strip trailing spaces per line.
    lines = [line.rstrip() for line in text.splitlines()]
    # Collapse 3+ blank lines.
    out: list[str] = []
    blanks = 0
    for line in lines:
        if not line.strip():
            blanks += 1
            if blanks > 1:
                continue
            out.append("")
        else:
            blanks = 0
            out.append(line)
    return "\n".join(out).strip()


def has_signature(raw: str | None) -> bool:
    """True when a non-empty signature HTML string is configured."""
    return bool(raw and raw.strip())


def build_html_signature_block(html: str) -> str:
    """Wrap sanitized signature HTML in a light separator block for email HTML."""
    clean = sanitize_signature_html(html)
    if not clean:
        return ""
    return (
        '<div style="clear:both;margin-top:18px;padding-top:12px;'
        'border-top:1px solid #d0d0d0;">'
        f"{clean}</div>"
    )
