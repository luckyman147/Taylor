"""Integration tests for email config + send endpoints.

The config tests use a patched config.json + temp key store so the encrypted
SMTP password round-trips without touching the real config file. The send
endpoint patches the SMTP transport so no network is used.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.main import app


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


async def test_email_config_defaults(email_env) -> None:
    async with _client() as client:
        r = await client.get("/api/v1/config/email")
    assert r.status_code == 200
    body = r.json()
    assert body["smtp_host"] == ""
    assert body["smtp_port"] == 587
    assert body["sender_email"] == ""
    assert body["use_tls"] is True
    assert body["has_password"] is False


async def test_email_config_save_and_roundtrip(email_env) -> None:
    async with _client() as client:
        r = await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "smtp_port": 587,
                "sender_email": "me@gmail.com",
                "sender_name": "Jane Doe",
                "use_tls": True,
                "password": "app-password-123",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["smtp_host"] == "smtp.gmail.com"
        assert body["sender_email"] == "me@gmail.com"
        assert body["sender_name"] == "Jane Doe"
        assert body["has_password"] is True

        # Password never returns raw.
        assert "app-password-123" not in r.text

        # Reload reflects saved state.
        r2 = await client.get("/api/v1/config/email")
        assert r2.json()["has_password"] is True

    # Encrypted at rest.
    ciphertexts = email_env.get_api_key_ciphertexts()
    assert "smtp" in ciphertexts
    assert "app-password-123" not in ciphertexts["smtp"]


async def test_email_config_clears_password(email_env) -> None:
    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={"sender_email": "me@gmail.com", "password": "secret-1"},
        )
        r = await client.put("/api/v1/config/email", json={"password": ""})
        assert r.status_code == 200
        assert r.json()["has_password"] is False
        r2 = await client.get("/api/v1/config/email")
        assert r2.json()["has_password"] is False


async def test_send_email_success_with_attachment(email_env) -> None:
    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "sender_email": "me@gmail.com",
                "password": "secret-1",
            },
        )

    files = [("attachments", ("resume.pdf", b"%PDF-1.4 fake", "application/pdf"))]
    data = {
        "company_email": "careers@acme.example",
        "company_name": "Acme Robotics",
        "subject": "Summer internship inquiry",
        "body": "Dear team,\n\nI would love to intern at Acme Robotics.",
    }

    with patch(
        "app.routers.email.send_email",
        new_callable=AsyncMock,
        return_value=None,
    ) as mock:
        async with _client() as client:
            r = await client.post(
                "/api/v1/email/send",
                data=data,
                files=files,
            )
        assert r.status_code == 200
        assert r.json()["success"] is True

        sent = mock.await_args.args[1]
        assert sent.to_email == "careers@acme.example"
        assert sent.subject == "Summer internship inquiry"
        assert len(sent.attachments) == 1
        assert sent.attachments[0].name == "resume.pdf"
        assert sent.attachments[0].data == b"%PDF-1.4 fake"


async def test_send_email_success_with_multiple_attachments(email_env) -> None:
    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "sender_email": "me@gmail.com",
                "password": "secret-1",
            },
        )

    files = [
        ("attachments", ("Mohamed Iyed Touati - Resume.pdf", b"%PDF-1.4 resume", "application/pdf")),
        ("attachments", ("cover-letter.docx", b"PK fake docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
    ]
    data = {
        "company_email": "careers@acme.example",
        "company_name": "Acme Robotics",
        "subject": "Summer internship inquiry",
        "body": "Dear team,\n\nI would love to intern at Acme Robotics.",
    }

    with patch(
        "app.routers.email.send_email",
        new_callable=AsyncMock,
        return_value=None,
    ) as mock:
        async with _client() as client:
            r = await client.post(
                "/api/v1/email/send",
                data=data,
                files=files,
            )
        assert r.status_code == 200

        sent = mock.await_args.args[1]
        assert [a.name for a in sent.attachments] == [
            "Mohamed Iyed Touati - Resume.pdf",
            "cover-letter.docx",
        ]
        assert [a.data for a in sent.attachments] == [b"%PDF-1.4 resume", b"PK fake docx"]


async def test_send_email_rejects_unconfigured_sender(email_env) -> None:
    async with _client() as client:
        r = await client.post(
            "/api/v1/email/send",
            data={
                "company_email": "careers@acme.example",
                "subject": "Hi",
                "body": "Hello",
            },
        )
    assert r.status_code == 400
    assert "not configured" in r.json()["detail"]


async def test_send_email_rejects_bad_attachment_type(email_env) -> None:
    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "sender_email": "me@gmail.com",
                "password": "secret-1",
            },
        )
        files = [("attachments", ("evil.exe", b"MZ", "application/x-msdownload"))]
        r = await client.post(
            "/api/v1/email/send",
            data={
                "company_email": "careers@acme.example",
                "subject": "Hi",
                "body": "Hello",
            },
            files=files,
        )
    assert r.status_code == 400
    assert "Unsupported file type" in r.json()["detail"]


async def test_send_email_propagates_smtp_auth_error(email_env) -> None:
    import smtplib

    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "sender_email": "me@gmail.com",
                "password": "wrong",
            },
        )

    with patch(
        "app.routers.email.send_email",
        new_callable=AsyncMock,
        side_effect=smtplib.SMTPAuthenticationError(535, b"auth failed"),
    ):
        async with _client() as client:
            r = await client.post(
                "/api/v1/email/send",
                data={
                    "company_email": "careers@acme.example",
                    "subject": "Hi",
                    "body": "Hello",
                },
            )
    assert r.status_code == 502
    assert "authentication failed" in r.json()["detail"]


async def test_send_email_persists_history_with_attachments(email_env) -> None:
    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "sender_email": "me@gmail.com",
                "password": "secret-1",
            },
        )

    files = [
        ("attachments", ("Mohamed Iyed Touati - Resume.pdf", b"%PDF-1.4 resume", "application/pdf")),
    ]
    data = {
        "company_email": "careers@acme.example",
        "company_name": "Acme Robotics",
        "company_id": "company-123",
        "subject": "Summer internship inquiry",
        "body": "Dear team,\n\nI would love to intern at Acme Robotics.",
    }

    with patch(
        "app.routers.email.send_email",
        new_callable=AsyncMock,
        return_value=None,
    ):
        async with _client() as client:
            r = await client.post(
                "/api/v1/email/send",
                data=data,
                files=files,
            )
            assert r.status_code == 200

            hist = await client.get("/api/v1/email/history?company_id=company-123")
            assert hist.status_code == 200
            entries = hist.json()
            assert len(entries) == 1
            entry = entries[0]
            assert entry["subject"] == "Summer internship inquiry"
            assert entry["body"] == "Dear team,\n\nI would love to intern at Acme Robotics."
            assert entry["recipient_email"] == "careers@acme.example"
            assert entry["company_name"] == "Acme Robotics"
            assert entry["attachments"] == [
                {"name": "Mohamed Iyed Touati - Resume.pdf", "content_type": "application/pdf", "size": len(b"%PDF-1.4 resume")}
            ]
            assert entry["sent_at"]

            other = await client.get("/api/v1/email/history?company_id=other-company")
            assert other.status_code == 200
            assert other.json() == []


async def test_email_history_newest_first(email_env) -> None:
    async with _client() as client:
        await client.put(
            "/api/v1/config/email",
            json={
                "smtp_host": "smtp.gmail.com",
                "sender_email": "me@gmail.com",
                "password": "secret-1",
            },
        )

    with patch(
        "app.routers.email.send_email",
        new_callable=AsyncMock,
        return_value=None,
    ):
        async with _client() as client:
            for i in range(2):
                await client.post(
                    "/api/v1/email/send",
                    data={
                        "company_email": "careers@acme.example",
                        "company_name": "Acme Robotics",
                        "company_id": "company-ordering",
                        "subject": f"Email number {i}",
                        "body": f"Body {i}",
                    },
                )
            hist = await client.get("/api/v1/email/history?company_id=company-ordering")
            subjects = [e["subject"] for e in hist.json()]
            assert subjects == ["Email number 1", "Email number 0"]