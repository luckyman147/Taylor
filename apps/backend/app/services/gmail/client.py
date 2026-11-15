"""Gmail IMAP client — fetch unread emails, search, and summarize."""

import asyncio
import email
import email.header
import email.utils
import imaplib
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

logger = logging.getLogger(__name__)

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993
MAX_BODY_LEN = 3000


@dataclass
class EmailMessage:
    """A single email message."""

    uid: str
    subject: str
    sender: str
    date: str
    snippet: str
    body: str = ""
    is_unread: bool = False


@dataclass
class GmailConfig:
    """Gmail IMAP connection settings."""

    email: str
    app_password: str


def _load_gmail_config() -> GmailConfig | None:
    """Build Gmail config from existing SMTP credentials."""
    try:
        from app.config import get_api_keys_from_config, load_config_file

        config = load_config_file()
        keys = get_api_keys_from_config()
        sender_email = str(config.get("sender_email", "") or "")
        password = keys.get("smtp", "")

        if not sender_email or not password:
            logger.info("Gmail IMAP unavailable: sender_email=%s, smtp_key=%s",
                        "set" if sender_email else "missing",
                        "set" if password else "missing")
            return None

        return GmailConfig(email=sender_email, app_password=password)
    except Exception as e:
        logger.error("Failed to load Gmail config: %s", e)
        return None


def _decode_header(raw: str | None) -> str:
    """Decode MIME-encoded email header."""
    if not raw:
        return ""
    parts = email.header.decode_header(raw)
    decoded = []
    for data, charset in parts:
        if isinstance(data, bytes):
            decoded.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(data)
    return " ".join(decoded)


def _strip_html(text: str) -> str:
    """Strip HTML tags, CSS, entities, and collapse whitespace."""
    import html
    # Remove <style> blocks and their content
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Remove <script> blocks
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Remove CSS @font-face and media queries
    text = re.sub(r"@font-face\s*\{[^}]*\}", "", text, flags=re.IGNORECASE)
    text = re.sub(r"@media[^{]*\{.*?\}\s*\}", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Decode HTML entities (&nbsp; &zwnj; etc.)
    text = html.unescape(text)
    # Remove zero-width joiners and non-breaking spaces
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    text = text.replace("\u00a0", " ")  # nbsp -> space
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n", "\n", text)
    return text.strip()


def _extract_body(msg: email.message.Message) -> tuple[str, str]:
    """Extract plain-text body and full text from email.

    Returns (snippet, full_body) where:
    - snippet: first ~300 chars of meaningful content
    - full_body: up to MAX_BODY_LEN chars of the full email text
    """
    plain_parts: list[str] = []
    html_parts: list[str] = []

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ct == "text/plain":
                plain_parts.append(text)
            elif ct == "text/html":
                html_parts.append(text)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                html_parts.append(text)
            else:
                plain_parts.append(text)

    # Prefer plain text, fall back to HTML with tag stripping
    if plain_parts:
        body = "\n".join(plain_parts)
    elif html_parts:
        body = _strip_html("\n".join(html_parts))
    else:
        return "", ""

    body = _strip_html(body)

    # Extract snippet: skip short greeting lines, find first substantive paragraph
    lines = body.split("\n")
    snippet_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if len(stripped) < 10:
            continue
        # Skip common greeting/boilerplate patterns
        if re.match(r"^(hi|hello|dear|hey|good\s+(morning|afternoon|evening))\b", stripped, re.IGNORECASE):
            continue
        snippet_lines.append(stripped)
        if len(" ".join(snippet_lines)) > 300:
            break

    snippet = " ".join(snippet_lines)[:300]
    full_body = body[:MAX_BODY_LEN]

    return snippet, full_body


def _parse_email(msg_data: bytes, uid: str) -> EmailMessage:
    """Parse raw email data into an EmailMessage."""
    msg = email.message_from_bytes(msg_data)
    subject = _decode_header(msg.get("Subject"))
    sender = _decode_header(msg.get("From"))
    date_str = msg.get("Date", "")
    snippet, body = _extract_body(msg)

    # Check if unread (has \Seen flag)
    is_unread = b"\\Seen" not in msg_data if isinstance(msg_data, bytes) else True

    return EmailMessage(
        uid=uid,
        subject=subject,
        sender=sender,
        date=date_str,
        snippet=snippet,
        body=body,
        is_unread=is_unread,
    )


def extract_imap_folder_name(raw_folder: bytes | str) -> str | None:
    """Extract the mailbox name from an IMAP LIST response.

    Examples:
        b'(\\HasNoChildren) "/" "INBOX"' -> 'INBOX'
        b'(\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"'
            -> '[Gmail]/Sent Mail'
    """
    if isinstance(raw_folder, bytes):
        raw_folder = raw_folder.decode("utf-8", errors="replace")

    match = re.search(r'\s"([^"]+)"\s*$', raw_folder)
    if match:
        return match.group(1)

    parts = raw_folder.rsplit(" ", 1)
    if len(parts) == 2:
        return parts[1].strip('"')

    return None


def _has_sent_flag(raw_folder: bytes | str) -> bool:
    """Check if an IMAP LIST response has the \\Sent special-use flag."""
    text = (
        raw_folder.decode("utf-8", errors="replace")
        if isinstance(raw_folder, bytes)
        else raw_folder
    )
    return "\\Sent" in text or "\\sent" in text.lower()


def _normalize_folder(name: str) -> str:
    """Normalize a folder name for comparison."""
    return " ".join(name.strip().lower().split())


def _find_folder(
    raw_folders: list[bytes] | None,
    requested: str,
) -> tuple[str | None, list[str]]:
    """Resolve the best-matching IMAP folder from raw LIST response.

    Returns (resolved_folder, all_parsed_names).
    """
    if not raw_folders:
        return None, []

    parsed: list[str] = []
    sent_folder: str | None = None

    for raw in raw_folders:
        name = extract_imap_folder_name(raw)
        if name:
            parsed.append(name)
            if _has_sent_flag(raw):
                sent_folder = name

    requested_norm = _normalize_folder(requested)

    # 1. Exact match
    for name in parsed:
        if _normalize_folder(name) == requested_norm:
            return name, parsed

    # 2. If requested is "sent", prefer the \Sent flag, then fuzzy match
    if requested_norm in ("sent", "sent mail"):
        if sent_folder:
            return sent_folder, parsed
        sent_candidates = {
            "sent", "sent mail", "[gmail]/sent mail", "[gmail]/sent",
        }
        for name in parsed:
            norm = _normalize_folder(name)
            if norm in sent_candidates or "sent" in norm:
                return name, parsed

    return None, parsed


def _quote_mailbox(mailbox: str) -> str:
    """Quote a mailbox name for IMAP if it contains special characters."""
    if " " in mailbox or "[" in mailbox or "/" in mailbox:
        return f'"{mailbox}"'
    return mailbox


def _fetch_emails_sync(
    config: GmailConfig,
    search_criteria: str = "UNSEEN",
    max_results: int = 10,
    folder: str = "INBOX",
) -> list[EmailMessage]:
    """Fetch emails via IMAP (blocking; run in a worker thread)."""
    results: list[EmailMessage] = []

    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(config.email, config.app_password)

        # List available folders and resolve the target
        status, raw_folders = mail.list()
        logger.info("Gmail IMAP LIST status=%r, raw=%r", status, raw_folders[:5] if raw_folders else [])

        resolved_folder, all_folders = _find_folder(raw_folders, folder)

        if resolved_folder is None:
            logger.error(
                "Could not find IMAP folder '%s'. Available: %s",
                folder, all_folders,
            )
            mail.logout()
            return results

        if resolved_folder != folder:
            logger.info("IMAP folder resolved: %s -> %s", folder, resolved_folder)

        status, data = mail.select(_quote_mailbox(resolved_folder))
        if status != "OK":
            logger.error("Failed to select folder '%s': %s", resolved_folder, data)
            mail.logout()
            return results

        status, data = mail.search(None, search_criteria)
        if status != "OK" or not data[0]:
            logger.info("IMAP search '%s' returned 0 results in '%s'", search_criteria, resolved_folder)
            mail.logout()
            return results

        uid_list = data[0].split()
        recent_uids = uid_list[-max_results:] if len(uid_list) > max_results else uid_list
        recent_uids.reverse()

        for uid in recent_uids:
            status, msg_data = mail.fetch(uid, "(RFC822)")
            if status == "OK" and msg_data and msg_data[0]:
                raw = msg_data[0][1]
                results.append(_parse_email(raw, uid.decode()))

        mail.logout()
        logger.info("IMAP search '%s' in '%s': found %d emails", search_criteria, resolved_folder, len(results))
    except imaplib.IMAP4.error as e:
        logger.error("IMAP error searching '%s' in '%s': %s", search_criteria, folder, e)
    except Exception as e:
        logger.error("Gmail fetch failed: %s", e)

    return results


async def get_unread_emails(max_results: int = 10) -> list[EmailMessage]:
    """Fetch unread emails from Gmail inbox."""
    config = _load_gmail_config()
    if not config:
        return []
    return await asyncio.to_thread(_fetch_emails_sync, config, "UNSEEN", max_results)


async def search_emails(query: str, max_results: int = 10) -> list[EmailMessage]:
    """Search emails using IMAP search syntax.

    Examples:
        FROM "hr@company.com"
        SUBJECT "interview"
        FROM "linkedin" SUBJECT "job"
        SINCE "01-Sep-2026"
    """
    config = _load_gmail_config()
    if not config:
        return []
    return await asyncio.to_thread(_fetch_emails_sync, config, query, max_results)


async def search_sent_emails(query: str = "ALL", max_results: int = 10) -> list[EmailMessage]:
    """Search emails in the Sent Mail folder.

    Resolves the sent folder dynamically via IMAP LIST + \\Sent flag detection.
    """
    config = _load_gmail_config()
    if not config:
        return []
    return await asyncio.to_thread(_fetch_emails_sync, config, query, max_results, folder="sent")


async def get_inbox_summary(max_results: int = 20) -> list[EmailMessage]:
    """Fetch recent emails (read + unread) for inbox summary."""
    config = _load_gmail_config()
    if not config:
        return []
    return await asyncio.to_thread(_fetch_emails_sync, config, "ALL", max_results)


async def is_available() -> bool:
    """Check if Gmail IMAP is configured and reachable."""
    config = _load_gmail_config()
    if not config:
        return False

    def _check() -> bool:
        try:
            mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
            mail.login(config.email, config.app_password)
            mail.select("INBOX")
            mail.logout()
            return True
        except Exception:
            return False

    return await asyncio.to_thread(_check)
