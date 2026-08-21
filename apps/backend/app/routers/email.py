"""Company outreach email sending endpoint."""

import logging
import smtplib
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import get_api_keys_from_config, load_config_file
from app.database import db
from app.schemas.models import SendEmailResponse, SentEmailResponse
from app.services.email_sender import (
    EmailAttachment,
    EmailDeliveryConfig,
    OutgoingEmail,
    send_email,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["Email"])

MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024  # 5MB

ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".txt",
    ".md",
    ".rtf",
    ".odt",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".svg",
    ".zip",
    ".csv",
    ".xlsx",
    ".pptx",
    ".json",
}


def _load_delivery_config() -> EmailDeliveryConfig:
    """Build the SMTP delivery config from settings + encrypted key store."""
    config = load_config_file()
    keys = get_api_keys_from_config()
    return EmailDeliveryConfig(
        smtp_host=str(config.get("smtp_host", "") or ""),
        smtp_port=int(config.get("smtp_port", 587) or 587),
        sender_email=str(config.get("sender_email", "") or ""),
        sender_name=(config.get("sender_name") or None),
        password=keys.get("smtp", ""),
        use_tls=bool(config.get("use_tls", True)),
    )


@router.post("/send", response_model=SendEmailResponse)
async def send_company_email(
    company_email: str = Form(...),
    company_name: str = Form(default=""),
    company_id: str = Form(default=""),
    subject: str = Form(...),
    body: str = Form(...),
    attachments: list[UploadFile] | None = File(default=None),
) -> SendEmailResponse:
    """Send an outreach email to a company via the configured SMTP account.

    Accepts optional file attachments (each up to 5MB). The sender identity
    and SMTP server are read from the email settings (sender email + app
    password set in Settings > Email). On success the message snapshot is
    persisted to the sent-email history (when ``company_id`` is provided).
    """
    cfg = _load_delivery_config()

    if not cfg.smtp_host or not cfg.sender_email or not cfg.password:
        raise HTTPException(
            status_code=400,
            detail="Email sender is not configured. Set your SMTP settings and app password in Settings > Email.",
        )

    to_email = company_email.strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Recipient email is required.")

    subject_text = subject.strip()
    body_text = body
    if not subject_text or not body_text.strip():
        raise HTTPException(status_code=400, detail="Subject and body are required.")

    file_attachments: list[EmailAttachment] = []
    for attachment in attachments or []:
        filename = Path(attachment.filename or "").name
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type for attachment: {ext or '(no extension)'}",
            )
        content = await attachment.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Attachment file is empty.")
        if len(content) > MAX_ATTACHMENT_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Attachment too large. Maximum size is 5MB.",
            )
        file_attachments.append(
            EmailAttachment(
                name=filename,
                content_type=attachment.content_type,
                data=content,
            )
        )

    email = OutgoingEmail(
        to_email=to_email,
        to_name=company_name.strip() or None,
        subject=subject_text,
        body=body_text,
        attachments=file_attachments,
    )

    try:
        await send_email(cfg, email)
    except smtplib.SMTPAuthenticationError as exc:
        logger.error("SMTP auth failed for %s: %s", cfg.sender_email, exc)
        raise HTTPException(
            status_code=502,
            detail="Email authentication failed. Check the sender email and app password in Settings > Email.",
        )
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as exc:
        logger.error("SMTP rejected message to %s: %s", to_email, exc)
        raise HTTPException(
            status_code=502,
            detail="The email server rejected the message. Check the recipient email address.",
        )
    except (TimeoutError, OSError, smtplib.SMTPException) as exc:
        logger.error("SMTP connection failed to %s: %s", cfg.smtp_host, exc)
        raise HTTPException(
            status_code=502,
            detail="Could not connect to the email server. Check the SMTP host, port, and TLS settings.",
        )
    except Exception as exc:
        logger.error("Email send failed unexpectedly: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to send email. Please try again.")

    company_id_text = company_id.strip()
    try:
        await db.create_sent_email(
            company_id=company_id_text or None,
            company_name=company_name.strip(),
            recipient_email=to_email,
            subject=subject_text,
            body=body_text,
            attachments=[
                {
                    "name": att.name,
                    "content_type": att.content_type,
                    "size": len(att.data),
                }
                for att in file_attachments
            ],
        )
    except Exception as exc:
        logger.error("Failed to persist sent-email history for %s: %s", to_email, exc)

    return SendEmailResponse(success=True, message=f"Email sent to {to_email}.")


@router.get("/history", response_model=list[SentEmailResponse])
async def get_email_history(
    company_id: str | None = None,
) -> list[SentEmailResponse]:
    """List sent-email history, newest first, optionally for one company."""
    rows = await db.list_sent_emails(company_id=company_id or None)
    return [SentEmailResponse(**row) for row in rows]