"""Company outreach email sending + tracking/analytics endpoints."""

import asyncio
import logging
import smtplib
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile

from app import llm_cache
from app.config import get_api_keys_from_config, load_config_file
from app.database import db
from app.schemas.models import (
    SENT_EMAIL_OUTCOMES,
    BulkSentEmailOutcomeRequest,
    BulkSentEmailOutcomeResponse,
    CheckRepliesResponse,
    EmailStatsResponse,
    OutreachAnalysisReport,
    OutreachAnalysisResponse,
    ReplyCandidate,
    ReplyCandidateMatch,
    SendEmailResponse,
    SentEmailOutcomeRequest,
    SentEmailOutcomeResponse,
    SentEmailResponse,
)
from app.services.career_profile import _llm_configured
from app.services.email_analytics import analyze_outreach, compute_email_stats
from app.services.email_sender import (
    EmailAttachment,
    EmailDeliveryConfig,
    OutgoingEmail,
    send_email,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["Email"])

MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024  # 5MB

EMAIL_MODES = ("personalized", "shared")

# Cap on pending emails scanned per "Check for replies" click, and how many
# IMAP searches may run at once (each search opens its own connection —
# sequential scans of a large pending queue take far too long).
MAX_REPLY_SCAN = 30
MAX_REPLY_SCAN_CONCURRENCY = 5
MAX_REPLY_MATCHES_PER_RECIPIENT = 3

MIN_EMAILS_TO_ANALYZE = 3

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
    contact_id: str = Form(default=""),
    purpose: str = Form(default=""),
    email_mode: str = Form(default=""),
    attachments: list[UploadFile] | None = File(default=None),
) -> SendEmailResponse:
    """Send an outreach email to a company or contact via SMTP.

    Accepts optional file attachments (each up to 5MB). The sender identity
    and SMTP server are read from the email settings (sender email + app
    password set in Settings > Email). On success the message snapshot is
    persisted to the sent-email history together with the optional contact
    link, purpose, and send mode (personalized|shared) used for analytics.
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

    email_mode_text = email_mode.strip()
    if email_mode_text and email_mode_text not in EMAIL_MODES:
        raise HTTPException(
            status_code=400,
            detail="Invalid email mode. Must be 'personalized' or 'shared'.",
        )

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

    # Attach the user HTML signature (career profile) — HTML part only
    # (+ plain-text fallback). Sanitized again on the way out.
    try:
        from app.services.html_signature import (
            has_signature,
            sanitize_signature_html,
            signature_to_text,
        )

        profile = await db.get_career_profile()
        raw_sig = (profile or {}).get("email_signature") or ""
        if has_signature(raw_sig):
            email.html_signature = sanitize_signature_html(raw_sig)
            email.text_signature = signature_to_text(email.html_signature)
    except Exception as exc:  # noqa: BLE001 — signature is optional decoration
        logger.warning("Failed to load email signature: %s", exc)

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
            contact_id=contact_id.strip() or None,
            purpose=purpose.strip() or None,
            email_mode=email_mode_text or None,
        )
    except Exception as exc:
        logger.error("Failed to persist sent-email history for %s: %s", to_email, exc)

    return SendEmailResponse(success=True, message=f"Email sent to {to_email}.")


@router.get("/history", response_model=list[SentEmailResponse])
async def get_email_history(
    response: Response,
    company_id: str | None = None,
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[SentEmailResponse]:
    """List sent-email history, newest first, optionally for one company.

    Paginated via ``limit``/``offset``; the unpaginated total (after the
    company filter) is returned in the ``X-Total-Count`` header. Defaults
    return the full list for backward compatibility.
    """
    rows = await db.list_sent_emails(company_id=company_id or None)
    response.headers["X-Total-Count"] = str(len(rows))
    return [SentEmailResponse(**row) for row in rows[offset : offset + limit]]


def _validate_outcome(outcome: str) -> str:
    outcome_text = outcome.strip()
    if outcome_text not in SENT_EMAIL_OUTCOMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid outcome. Must be one of: {', '.join(SENT_EMAIL_OUTCOMES)}.",
        )
    return outcome_text


@router.patch("/history/{log_id}/outcome", response_model=SentEmailOutcomeResponse)
async def update_email_outcome(
    log_id: str,
    payload: SentEmailOutcomeRequest,
) -> SentEmailOutcomeResponse:
    """Mark the response outcome of one sent email (manual or reply-confirmed)."""
    outcome = _validate_outcome(payload.outcome)
    note = (payload.note or "").strip() or None
    row = await db.update_sent_email_outcome(log_id, outcome, note)
    if row is None:
        raise HTTPException(status_code=404, detail="Sent email not found.")
    return SentEmailOutcomeResponse(updated=True, email=SentEmailResponse(**row))


@router.post("/history/bulk-outcome", response_model=BulkSentEmailOutcomeResponse)
async def bulk_update_email_outcomes(
    payload: BulkSentEmailOutcomeRequest,
) -> BulkSentEmailOutcomeResponse:
    """Apply one response outcome to many sent emails at once."""
    outcome = _validate_outcome(payload.outcome)
    note = (payload.note or "").strip() or None
    updated = await db.bulk_update_sent_email_outcomes(
        payload.log_ids, outcome, note
    )
    return BulkSentEmailOutcomeResponse(updated=updated)


def _date_after_sent(message_date: str, sent_at: str) -> bool:
    """True when the reply date is at/after the send time (or unparseable)."""
    try:
        parsed = parsedate_to_datetime(message_date)
        sent_date = datetime.fromisoformat(sent_at) if sent_at else None
        if parsed is not None and sent_date is not None:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed >= sent_date
    except (TypeError, ValueError):
        pass
    return True


@router.post("/check-replies", response_model=CheckRepliesResponse)
async def check_email_replies() -> CheckRepliesResponse:
    """Scan the IMAP inbox for replies to pending sent emails.

    Returns candidate matches only — the user confirms each one by setting the
    outcome (never auto-marked). Responds ``200`` with ``unavailable_reason``
    when IMAP is not configured or unreachable.
    """
    from app.services.gmail import is_available, search_emails

    rows = await db.list_sent_emails()
    pending = [row for row in rows if row.get("outcome") == "pending"]
    if not pending:
        return CheckRepliesResponse(checked=0, candidates=[])

    try:
        available = await is_available()
    except Exception as exc:  # noqa: BLE001 — IMAP is optional
        logger.warning("IMAP availability check failed: %s", exc)
        available = False
    if not available:
        return CheckRepliesResponse(
            checked=0,
            unavailable_reason=(
                "IMAP is not configured or unreachable. Set your email app "
                "password in Settings > Email to check for replies."
            ),
        )

    candidates: list[ReplyCandidate] = []
    semaphore = asyncio.Semaphore(MAX_REPLY_SCAN_CONCURRENCY)

    async def _scan_one(row: dict) -> ReplyCandidate | None:
        recipient = (row.get("recipient_email") or "").strip()
        if not recipient:
            return None
        async with semaphore:
            try:
                messages = await search_emails(
                    f'FROM "{recipient}"', max_results=MAX_REPLY_MATCHES_PER_RECIPIENT
                )
            except Exception as exc:  # noqa: BLE001 — keep scanning other recipients
                logger.warning("IMAP search failed for %s: %s", recipient, exc)
                return None
        match = next(
            (
                message
                for message in messages
                if _date_after_sent(message.date, row.get("sent_at") or "")
            ),
            None,
        )
        if match is None:
            return None
        return ReplyCandidate(
            log_id=row["log_id"],
            recipient_email=recipient,
            company_name=row.get("company_name") or "",
            sent_subject=row.get("subject") or "",
            sent_at=row.get("sent_at") or "",
            matched=ReplyCandidateMatch(
                uid=match.uid or "",
                subject=match.subject or "",
                sender=match.sender or "",
                date=match.date or "",
                snippet=match.snippet or "",
            ),
        )

    scanned = pending[:MAX_REPLY_SCAN]
    results = await asyncio.gather(*(_scan_one(row) for row in scanned))
    candidates = [candidate for candidate in results if candidate is not None]
    return CheckRepliesResponse(checked=len(scanned), candidates=candidates)


@router.get("/stats", response_model=EmailStatsResponse)
async def get_email_stats() -> EmailStatsResponse:
    """Deterministic outreach performance statistics over the sent history."""
    rows = await db.list_sent_emails()
    return EmailStatsResponse(**compute_email_stats(rows))


@router.post("/analyze", response_model=OutreachAnalysisResponse)
async def analyze_outreach_history() -> OutreachAnalysisResponse:
    """LLM analysis of outreach performance: what works, what to change.

    Single-flight via ``llm_cache.coalesce`` (double-click runs one LLM call;
    nothing is cached, so a later call re-analyzes with fresh data).
    """
    if not _llm_configured():
        raise HTTPException(
            status_code=400,
            detail="LLM is not configured. Add an API key in Settings → AI.",
        )
    rows = await db.list_sent_emails()
    if len(rows) < MIN_EMAILS_TO_ANALYZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Not enough sent emails to analyze. Send at least "
                f"{MIN_EMAILS_TO_ANALYZE} emails first."
            ),
        )

    async def _run() -> OutreachAnalysisResponse:
        report = await analyze_outreach(rows)
        saved = await db.save_outreach_analysis(
            report.model_dump(),
            emails_analyzed=len(rows),
            fingerprint=key,
        )
        return OutreachAnalysisResponse(
            report=report,
            emails_analyzed=len(rows),
            message="",
            created_at=saved["created_at"],
        )

    key = llm_cache.make_key(
        "email_analysis", [(row["log_id"], row["outcome"]) for row in rows]
    )
    try:
        return await llm_cache.coalesce(key, _run)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surface as generic client error
        logger.error("Outreach analysis failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Analysis failed. Please try again.",
        )


@router.get("/analysis/latest", response_model=OutreachAnalysisResponse)
async def get_latest_analysis() -> OutreachAnalysisResponse:
    """Return the most recently saved AI outreach analysis, if any.

    Responds ``404`` when no analysis has been saved yet — the client shows
    the empty state and the user can run a fresh analysis.
    """
    saved = await db.get_latest_outreach_analysis()
    if saved is None:
        raise HTTPException(status_code=404, detail="No analysis has been saved yet.")
    return OutreachAnalysisResponse(
        report=OutreachAnalysisReport.model_validate(saved["report"]),
        emails_analyzed=saved.get("emails_analyzed") or 0,
        created_at=saved.get("created_at"),
    )