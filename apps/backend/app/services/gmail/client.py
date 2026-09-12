"""Gmail IMAP client — fetch unread emails, search, and summarize."""

import asyncio
import email
import email.header
import email.utils
import imaplib
import logging
from dataclasses import dataclass, field
from datetime import datetime

logger = logging.getLogger(__name__)

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993


@dataclass
class EmailMessage:
    """A single email message."""

    uid: str
    subject: str
    sender: str
    date: str
    snippet: str
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


def _extract_snippet(msg: email.message.Message, max_len: int = 200) -> str:
    """Extract a plain-text snippet from the email body."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")
                    break
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            body = payload.decode(charset, errors="replace")

    # Strip HTML tags for snippet
    import re
    body = re.sub(r"<[^>]+>", "", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body[:max_len] + ("..." if len(body) > max_len else "")


def _parse_email(msg_data: bytes, uid: str) -> EmailMessage:
    """Parse raw email data into an EmailMessage."""
    msg = email.message_from_bytes(msg_data)
    subject = _decode_header(msg.get("Subject"))
    sender = _decode_header(msg.get("From"))
    date_str = msg.get("Date", "")
    snippet = _extract_snippet(msg)

    # Check if unread (has \Seen flag)
    is_unread = b"\\Seen" not in msg_data if isinstance(msg_data, bytes) else True

    return EmailMessage(
        uid=uid,
        subject=subject,
        sender=sender,
        date=date_str,
        snippet=snippet,
        is_unread=is_unread,
    )


def _fetch_emails_sync(
    config: GmailConfig,
    search_criteria: str = "UNSEEN",
    max_results: int = 10,
) -> list[EmailMessage]:
    """Fetch emails via IMAP (blocking; run in a worker thread)."""
    results: list[EmailMessage] = []

    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(config.email, config.app_password)
        mail.select("inbox")

        status, data = mail.search(None, search_criteria)
        if status != "OK" or not data[0]:
            mail.logout()
            return results

        uid_list = data[0].split()
        # Get the last N UIDs (most recent)
        recent_uids = uid_list[-max_results:] if len(uid_list) > max_results else uid_list
        recent_uids.reverse()  # Most recent first

        for uid in recent_uids:
            status, msg_data = mail.fetch(uid, "(RFC822)")
            if status == "OK" and msg_data and msg_data[0]:
                raw = msg_data[0][1]
                results.append(_parse_email(raw, uid.decode()))

        mail.logout()
    except imaplib.IMAP4.error as e:
        logger.error("IMAP error: %s", e)
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
