"""Integration tests for outreach tracking: outcomes, stats, replies, analysis.

Covers the PATCH/bulk outcome endpoints, the deterministic /stats endpoint,
the IMAP reply-check contract (candidates only — never auto-marked; graceful
200 + unavailable_reason), and the /analyze guards + LLM wiring.
"""

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas.models import OutreachAnalysisReport
from app.services.gmail.client import EmailMessage as GmailMessage


@pytest.fixture
def email_env(isolated_db, tmp_path, monkeypatch):
    """Isolate config.json + crypto secret + key store for email settings."""
    from app import crypto
    from app.config import settings
    import app.config as config_module

    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(config_module, "CONFIG_FILE_PATH", tmp_path / "config.json")
    crypto.reset_cache()
    yield isolated_db
    crypto.reset_cache()


def _client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _configure_smtp(client: AsyncClient) -> None:
    await client.put(
        "/api/v1/config/email",
        json={
            "smtp_host": "smtp.gmail.com",
            "sender_email": "me@gmail.com",
            "password": "secret-1",
        },
    )


async def _send(client: AsyncClient, *, subject: str = "Hello", body: str = "Body") -> str:
    """Send one email through the API (SMTP mocked) and return its log_id."""
    with patch(
        "app.routers.email.send_email",
        new_callable=AsyncMock,
        return_value=None,
    ):
        r = await client.post(
            "/api/v1/email/send",
            data={
                "company_email": "careers@acme.example",
                "company_name": "Acme",
                "company_id": "co-1",
                "subject": subject,
                "body": body,
            },
        )
    assert r.status_code == 200
    hist = await client.get("/api/v1/email/history")
    entries = [e for e in hist.json() if e["subject"] == subject]
    assert entries, f"no history entry for {subject!r}"
    return entries[0]["log_id"]


async def test_send_persists_contact_purpose_mode_and_pending_outcome(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        with patch(
            "app.routers.email.send_email",
            new_callable=AsyncMock,
            return_value=None,
        ):
            r = await client.post(
                "/api/v1/email/send",
                data={
                    "company_email": "jane@acme.example",
                    "company_name": "Acme",
                    "contact_id": "contact-9",
                    "purpose": "referral",
                    "email_mode": "shared",
                    "subject": "Shared intro",
                    "body": "Hi Jane,",
                },
            )
        assert r.status_code == 200
        hist = await client.get("/api/v1/email/history")
        entry = hist.json()[0]
        assert entry["contact_id"] == "contact-9"
        assert entry["purpose"] == "referral"
        assert entry["email_mode"] == "shared"
        assert entry["outcome"] == "pending"
        assert entry["outcome_note"] is None
        assert entry["outcome_at"] is None


async def test_send_rejects_invalid_email_mode(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        with patch(
            "app.routers.email.send_email",
            new_callable=AsyncMock,
            return_value=None,
        ):
            r = await client.post(
                "/api/v1/email/send",
                data={
                    "company_email": "jane@acme.example",
                    "subject": "Hi",
                    "body": "Hello",
                    "email_mode": "telepathy",
                },
            )
    assert r.status_code == 400
    assert "Invalid email mode" in r.json()["detail"]


async def test_patch_outcome_marks_responded_with_note(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        log_id = await _send(client, subject="First")

        r = await client.patch(
            f"/api/v1/email/history/{log_id}/outcome",
            json={"outcome": "responded", "note": "Wants a call Friday"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["updated"] is True
        assert body["email"]["outcome"] == "responded"
        assert body["email"]["outcome_note"] == "Wants a call Friday"
        assert body["email"]["outcome_at"]

        hist = await client.get("/api/v1/email/history")
        assert hist.json()[0]["outcome"] == "responded"

        # Clearing the note with an empty string.
        r2 = await client.patch(
            f"/api/v1/email/history/{log_id}/outcome",
            json={"outcome": "responded", "note": ""},
        )
        assert r2.status_code == 200
        assert r2.json()["email"]["outcome_note"] is None


async def test_patch_outcome_invalid_and_missing(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        log_id = await _send(client, subject="First")

        bad = await client.patch(
            f"/api/v1/email/history/{log_id}/outcome",
            json={"outcome": "engaged"},
        )
        assert bad.status_code == 400
        assert "Invalid outcome" in bad.json()["detail"]

        missing = await client.patch(
            "/api/v1/email/history/nope/outcome",
            json={"outcome": "responded"},
        )
        assert missing.status_code == 404


async def test_bulk_outcome_updates_subset(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        a = await _send(client, subject="A")
        b = await _send(client, subject="B")
        c = await _send(client, subject="C")

        r = await client.post(
            "/api/v1/email/history/bulk-outcome",
            json={"log_ids": [a, b], "outcome": "not_interested"},
        )
        assert r.status_code == 200
        assert r.json() == {"updated": 2}

        hist = await client.get("/api/v1/email/history")
        outcomes = {e["log_id"]: e["outcome"] for e in hist.json()}
        assert outcomes[a] == "not_interested"
        assert outcomes[b] == "not_interested"
        assert outcomes[c] == "pending"

        bad = await client.post(
            "/api/v1/email/history/bulk-outcome",
            json={"log_ids": [a], "outcome": "nope"},
        )
        assert bad.status_code == 400


async def test_history_pagination_limit_offset_and_total_header(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        await _send(client, subject="A")
        await _send(client, subject="B")
        await _send(client, subject="C")

        page1 = await client.get("/api/v1/email/history?limit=2")
        assert page1.status_code == 200
        assert len(page1.json()) == 2
        assert page1.headers["x-total-count"] == "3"

        page2 = await client.get("/api/v1/email/history?limit=2&offset=2")
        assert page2.status_code == 200
        assert len(page2.json()) == 1
        assert page2.headers["x-total-count"] == "3"

        # Newest first: page 1 holds the most recent send.
        subjects = {e["subject"] for e in page1.json()}
        assert "C" in subjects

        # Backward compatible: no params → full list + header.
        full = await client.get("/api/v1/email/history")
        assert len(full.json()) == 3
        assert full.headers["x-total-count"] == "3"


async def test_stats_endpoint_reports_rates_and_segments(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        a = await _send(client, subject="Alpha")
        b = await _send(client, subject="Beta")
        await _send(client, subject="Gamma")

        await client.patch(
            f"/api/v1/email/history/{a}/outcome", json={"outcome": "responded"}
        )
        await client.post(
            "/api/v1/email/history/bulk-outcome",
            json={"log_ids": [b], "outcome": "bounced"},
        )

        r = await client.get("/api/v1/email/stats")
        assert r.status_code == 200
        stats = r.json()
        assert stats["total_sent"] == 3
        assert stats["responded"] == 1
        assert stats["bounced"] == 1
        assert stats["pending"] == 1
        # denominator = 3 - 1 bounced = 2 → 0.5
        assert stats["response_rate"] == 0.5
        assert stats["by_recipient_type"]
        assert stats["timeline"]


async def test_check_replies_returns_unavailable_reason_when_imap_down(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        await _send(client, subject="Pending")

        with patch(
            "app.services.gmail.is_available",
            new_callable=AsyncMock,
            return_value=False,
        ):
            r = await client.post("/api/v1/email/check-replies")
        assert r.status_code == 200
        body = r.json()
        assert body["candidates"] == []
        assert body["unavailable_reason"]
        assert "IMAP" in body["unavailable_reason"]


async def test_check_replies_returns_candidates_without_automatic_marking(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        log_id = await _send(client, subject="Pending")

        reply = GmailMessage(
            uid="msg-42",
            subject="Re: Pending",
            sender="careers@acme.example",
            date=format_datetime(datetime.now(timezone.utc) + timedelta(minutes=5)),
            snippet="Sounds interesting — let's talk.",
            body="Sounds interesting — let's talk.",
        )

        with patch(
            "app.services.gmail.is_available",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "app.services.gmail.search_emails",
            new_callable=AsyncMock,
            return_value=[reply],
        ):
            r = await client.post("/api/v1/email/check-replies")

        assert r.status_code == 200
        body = r.json()
        assert body["checked"] == 1
        assert body["unavailable_reason"] is None
        assert len(body["candidates"]) == 1
        candidate = body["candidates"][0]
        assert candidate["log_id"] == log_id
        assert candidate["matched"]["uid"] == "msg-42"
        assert candidate["matched"]["subject"] == "Re: Pending"
        assert "let's talk" in candidate["matched"]["snippet"]

        # Candidates are NEVER auto-marked — outcome stays pending.
        hist = await client.get("/api/v1/email/history")
        assert hist.json()[0]["outcome"] == "pending"

        # Confirming is an explicit PATCH.
        confirm = await client.patch(
            f"/api/v1/email/history/{log_id}/outcome",
            json={"outcome": "responded"},
        )
        assert confirm.status_code == 200


async def test_check_replies_nothing_pending(email_env) -> None:
    async with _client() as client:
        r = await client.post("/api/v1/email/check-replies")
        assert r.status_code == 200
        assert r.json() == {
            "checked": 0,
            "candidates": [],
            "unavailable_reason": None,
        }


async def test_check_replies_ignores_messages_older_than_send(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        await _send(client, subject="Pending")

        old_reply = GmailMessage(
            uid="msg-old",
            subject="Re: Pending",
            sender="careers@acme.example",
            date=format_datetime(datetime.now(timezone.utc) - timedelta(days=30)),
            snippet="Old thread",
            body="Old thread",
        )

        with patch(
            "app.services.gmail.is_available",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "app.services.gmail.search_emails",
            new_callable=AsyncMock,
            return_value=[old_reply],
        ):
            r = await client.post("/api/v1/email/check-replies")

        assert r.status_code == 200
        body = r.json()
        assert body["checked"] == 1
        assert body["candidates"] == []


def _fake_report() -> OutreachAnalysisReport:
    return OutreachAnalysisReport(
        summary="Short, specific subjects win.",
        what_works=["Concrete role mentions"],
        what_fails=["Generic 'Hi' openers"],
        subject_tips=["Keep subjects under 8 words"],
        body_tips=["Lead with the ask"],
        cta_tips=["One clear CTA"],
        example_subject="Backend intern — 2 lines about me",
        example_body="Hi Jane,\n\n...",
    )


async def test_analyze_requires_llm_and_minimum_history(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)

        # LLM not configured → 400.
        with patch(
            "app.routers.email._llm_configured", return_value=False
        ):
            r = await client.post("/api/v1/email/analyze")
        assert r.status_code == 400
        assert "LLM is not configured" in r.json()["detail"]

        # Configured but fewer than 3 emails → 400.
        with patch(
            "app.routers.email._llm_configured", return_value=True
        ):
            await _send(client, subject="Only one")
            r2 = await client.post("/api/v1/email/analyze")
        assert r2.status_code == 400
        assert "Not enough sent emails" in r2.json()["detail"]


async def test_analyze_returns_report_and_single_flights(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        for subject in ("One", "Two", "Three"):
            await _send(client, subject=subject)

        with patch(
            "app.routers.email._llm_configured", return_value=True
        ), patch(
            "app.routers.email.analyze_outreach",
            new_callable=AsyncMock,
            return_value=_fake_report(),
        ) as mock_analyze:
            r = await client.post("/api/v1/email/analyze")

        assert r.status_code == 200
        body = r.json()
        assert body["emails_analyzed"] == 3
        assert body["report"]["summary"] == "Short, specific subjects win."
        assert body["report"]["example_subject"].startswith("Backend intern")
        assert body["created_at"]
        assert mock_analyze.await_count == 1


async def test_analysis_latest_404_then_returns_saved_report(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)

        # Nothing saved yet → 404.
        first = await client.get("/api/v1/email/analysis/latest")
        assert first.status_code == 404

        for subject in ("One", "Two", "Three"):
            await _send(client, subject=subject)

        with patch(
            "app.routers.email._llm_configured", return_value=True
        ), patch(
            "app.routers.email.analyze_outreach",
            new_callable=AsyncMock,
            return_value=_fake_report(),
        ):
            analyzed = await client.post("/api/v1/email/analyze")
        assert analyzed.status_code == 200

        # The analysis is persisted and served by /analysis/latest.
        latest = await client.get("/api/v1/email/analysis/latest")
        assert latest.status_code == 200
        body = latest.json()
        assert body["report"]["summary"] == "Short, specific subjects win."
        assert body["emails_analyzed"] == 3
        assert body["created_at"]


async def test_analysis_latest_upserts_singleton_row(email_env) -> None:
    async with _client() as client:
        await _configure_smtp(client)
        for subject in ("One", "Two", "Three"):
            await _send(client, subject=subject)

        second_report = OutreachAnalysisReport(summary="Second run wins.")

        with patch(
            "app.routers.email._llm_configured", return_value=True
        ), patch(
            "app.routers.email.analyze_outreach",
            new_callable=AsyncMock,
            return_value=_fake_report(),
        ):
            await client.post("/api/v1/email/analyze")

        # Different fingerprint (outcomes changed) + different report.
        log = (await client.get("/api/v1/email/history")).json()[0]
        await client.patch(
            f"/api/v1/email/history/{log['log_id']}/outcome",
            json={"outcome": "responded"},
        )

        with patch(
            "app.routers.email._llm_configured", return_value=True
        ), patch(
            "app.routers.email.analyze_outreach",
            new_callable=AsyncMock,
            return_value=second_report,
        ):
            await client.post("/api/v1/email/analyze")

        latest = await client.get("/api/v1/email/analysis/latest")
        assert latest.status_code == 200
        assert latest.json()["report"]["summary"] == "Second run wins."
        assert latest.json()["emails_analyzed"] == 3
