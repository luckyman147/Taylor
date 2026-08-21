"""SMTP email sending for the company outreach feature."""

import asyncio
import logging
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr

logger = logging.getLogger(__name__)


@dataclass
class EmailDeliveryConfig:
    """SMTP connection + sender identity settings."""

    smtp_host: str
    smtp_port: int = 587
    sender_email: str = ""
    sender_name: str | None = None
    password: str = ""
    use_tls: bool = True


@dataclass
class EmailAttachment:
    """A single file attached to an outgoing email."""

    name: str
    data: bytes
    content_type: str | None = None


@dataclass
class OutgoingEmail:
    """A single email to send."""

    to_email: str
    subject: str
    body: str
    to_name: str | None = None
    attachments: list[EmailAttachment] = field(default_factory=list)


def _build_message(cfg: EmailDeliveryConfig, email: OutgoingEmail) -> EmailMessage:
    """Build an EmailMessage from config + outgoing email (with optional attachments)."""
    msg = EmailMessage()
    msg["Subject"] = email.subject
    msg["From"] = (
        formataddr((cfg.sender_name, cfg.sender_email))
        if cfg.sender_name
        else cfg.sender_email
    )
    msg["To"] = (
        formataddr((email.to_name, email.to_email)) if email.to_name else email.to_email
    )
    msg.set_content(email.body)

    for attachment in email.attachments:
        maintype, sep, subtype = (attachment.content_type or "application/octet-stream").partition("/")
        if not sep:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(
            attachment.data,
            maintype=maintype,
            subtype=subtype,
            filename=attachment.name,
        )
    return msg


def _send_sync(cfg: EmailDeliveryConfig, email: OutgoingEmail) -> None:
    """Send the email over SMTP (blocking; run in a worker thread)."""
    msg = _build_message(cfg, email)
    if cfg.smtp_port == 465:
        with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=30) as server:
            server.login(cfg.sender_email, cfg.password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=30) as server:
            if cfg.use_tls:
                server.starttls()
            server.login(cfg.sender_email, cfg.password)
            server.send_message(msg)


async def send_email(cfg: EmailDeliveryConfig, email: OutgoingEmail) -> None:
    """Send ``email`` via SMTP without blocking the event loop.

    Runs the blocking ``smtplib`` call in a worker thread. SMTP-level failures
    (auth, connection, rejection) propagate to the caller.
    """
    await asyncio.to_thread(_send_sync, cfg, email)