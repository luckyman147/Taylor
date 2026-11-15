"""Best-effort contact enrichment — public sources only (no paid APIs).

Fetches a person's or company's website (plus /contact, /about, /team pages)
and extracts emails/phones with regexes. Pattern guesses
(``first.last@domain``) are returned with a ``low`` confidence flag so the UI
can distinguish verified-looking finds from guesses.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 ResumeMatcher/1.0"
)
PAGE_REQUEST_DELAY = 0.3
FETCH_TIMEOUT = 12.0
MAX_PAGES_PER_DOMAIN = 4

_SUBPATHS = ("/contact", "/contact-us", "/about", "/about-us", "/team", "/our-team")

_EMAIL_RE = re.compile(
    r"(?<![\w.+-])([A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)"
)
_PHONE_RE = re.compile(
    r"(?<!\w)(\+?\d[\d\s().-]{7,17}\d)(?!\w)"
)
_EMAIL_SUFFIX_BLACKLIST = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".example.com",
    ".test",
    "sentry",
    "wixpress",
    "schema.org",
)


def normalize_phone(raw: str) -> str | None:
    """Keep digits/+ with light formatting; drop obvious non-numbers."""
    cleaned = raw.strip()
    digits = re.sub(r"\D", "", cleaned)
    if len(digits) < 8 or len(digits) > 15:
        return None
    return cleaned


def extract_emails(text: str) -> list[str]:
    """Unique normalized emails, minus image/placeholder domains."""
    found: list[str] = []
    for match in _EMAIL_RE.findall(text or ""):
        email = match.casefold().rstrip(".,;)")
        if any(email.endswith(sfx) or sfx in email for sfx in _EMAIL_SUFFIX_BLACKLIST):
            continue
        if email not in found:
            found.append(email)
    return found


def extract_phones(text: str) -> list[str]:
    """Unique phone-looking strings with 8-15 digits."""
    found: list[str] = []
    for match in _PHONE_RE.findall(text or ""):
        phone = normalize_phone(match)
        if phone and phone not in found:
            found.append(phone)
    return found


def guess_pattern_email(full_name: str, domain: str) -> str | None:
    """Guess ``first.last@domain`` from a full name; low-confidence signal."""
    if not full_name or not domain:
        return None
    parts = [p for p in re.sub(r"[^A-Za-z\s.-]", " ", full_name).split() if p]
    if len(parts) < 2:
        return None
    first = parts[0].casefold()
    last = parts[-1].casefold()
    return f"{first}.{last}@{domain.casefold()}"


async def _fetch_page(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        resp = await client.get(url, follow_redirects=True)
        if resp.status_code != 200:
            return None
        content_type = resp.headers.get("content-type", "")
        if "html" not in content_type and "text" not in content_type:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        return soup.get_text(" ", strip=True)
    except Exception as exc:
        logger.debug("Enrichment fetch failed for %s: %s", url, exc)
        return None


async def enrich_from_website(
    website: str, full_name: str | None = None
) -> dict[str, Any]:
    """Crawl a website's key pages for email/phone.

    Returns {email, phone, emails_found, phones_found, email_confidence,
    pages_fetched}. ``email_confidence`` is "high" for an address found on a
    page, "low" for a pattern guess, "none" otherwise.
    """
    result: dict[str, Any] = {
        "email": None,
        "phone": None,
        "emails_found": [],
        "phones_found": [],
        "email_confidence": "none",
        "pages_fetched": 0,
    }
    if not website:
        return result
    raw = website.strip()
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return result
    base = f"{parsed.scheme}://{parsed.netloc}"
    domain = parsed.netloc.removeprefix("www.")

    emails: list[str] = []
    phones: list[str] = []
    async with httpx.AsyncClient(
        timeout=FETCH_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    ) as client:
        urls = [base] + [urljoin(base + "/", path.lstrip("/")) for path in _SUBPATHS]
        for url in urls[:MAX_PAGES_PER_DOMAIN]:
            if emails and phones:
                break
            text = await _fetch_page(client, url)
            if not text:
                continue
            result["pages_fetched"] += 1
            for email in extract_emails(text):
                if email not in emails:
                    emails.append(email)
            for phone in extract_phones(text):
                if phone not in phones:
                    phones.append(phone)
            await asyncio.sleep(PAGE_REQUEST_DELAY)

    personal = [e for e in emails if not e.split("@", 1)[0] in {
        "info", "hello", "hi", "contact", "support", "sales", "office", "admin",
        "team", "mail", "noreply", "no-reply", "press", "jobs", "careers", "hr",
    }]
    if personal:
        result["email"] = personal[0]
        result["email_confidence"] = "high"
    elif emails:
        result["email"] = emails[0]
        result["email_confidence"] = "medium"
    elif full_name:
        guess = guess_pattern_email(full_name, domain)
        if guess:
            result["email"] = guess
            result["email_confidence"] = "low"
    result["emails_found"] = emails
    result["phones_found"] = phones
    if phones:
        result["phone"] = phones[0]
    return result
