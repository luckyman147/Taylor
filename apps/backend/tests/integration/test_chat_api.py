"""Integration tests for Chat Command Center API endpoints."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client(isolated_db):
    """Async test client against the isolated DB."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestThreadCRUD:
    @pytest.mark.asyncio
    async def test_create_thread(self, client):
        resp = await client.post("/api/v1/chat/threads", json={"mode": "ask"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["thread_id"]
        assert data["mode"] == "ask"
        assert data["title"] == "New Chat"

    @pytest.mark.asyncio
    async def test_create_thread_with_title(self, client):
        resp = await client.post(
            "/api/v1/chat/threads",
            json={"mode": "coach", "title": "Career Planning"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Career Planning"
        assert data["mode"] == "coach"

    @pytest.mark.asyncio
    async def test_list_threads(self, client):
        await client.post("/api/v1/chat/threads", json={"mode": "ask"})
        await client.post("/api/v1/chat/threads", json={"mode": "coach"})
        resp = await client.get("/api/v1/chat/threads")
        assert resp.status_code == 200
        threads = resp.json()
        assert len(threads) >= 2

    @pytest.mark.asyncio
    async def test_update_thread_mode(self, client):
        create = await client.post("/api/v1/chat/threads", json={"mode": "ask"})
        thread_id = create.json()["thread_id"]
        resp = await client.patch(
            f"/api/v1/chat/threads/{thread_id}",
            json={"mode": "recruiter"},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @pytest.mark.asyncio
    async def test_update_nonexistent_returns_404(self, client):
        resp = await client.patch(
            "/api/v1/chat/threads/nonexistent",
            json={"mode": "coach"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_thread(self, client):
        create = await client.post("/api/v1/chat/threads", json={"mode": "ask"})
        thread_id = create.json()["thread_id"]
        resp = await client.delete(f"/api/v1/chat/threads/{thread_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        # Verify deleted
        resp = await client.patch(
            f"/api/v1/chat/threads/{thread_id}",
            json={"mode": "coach"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_nonexistent_returns_404(self, client):
        resp = await client.delete("/api/v1/chat/threads/nonexistent")
        assert resp.status_code == 404


class TestTurn:
    @pytest.mark.asyncio
    async def test_turn_on_nonexistent_thread_returns_404(self, client):
        resp = await client.post(
            "/api/v1/chat/threads/nonexistent/turn",
            json={"message": "Hello"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_empty_message_rejected(self, client):
        create = await client.post("/api/v1/chat/threads", json={"mode": "ask"})
        thread_id = create.json()["thread_id"]
        resp = await client.post(
            f"/api/v1/chat/threads/{thread_id}/turn",
            json={"message": ""},
        )
        assert resp.status_code == 422


class TestConfirmCancel:
    @pytest.mark.asyncio
    async def test_confirm_nonexistent_token_returns_404(self, client):
        resp = await client.post(
            "/api/v1/chat/confirm",
            json={"token": "nonexistent"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_cancel_nonexistent_token_returns_404(self, client):
        resp = await client.post(
            "/api/v1/chat/cancel",
            json={"token": "nonexistent"},
        )
        assert resp.status_code == 404


class TestMemory:
    @pytest.mark.asyncio
    async def test_save_memory(self, client):
        create = await client.post("/api/v1/chat/threads", json={"mode": "ask"})
        thread_id = create.json()["thread_id"]
        resp = await client.post(
            "/api/v1/chat/memory/save",
            json={
                "statement": "I prefer remote work",
                "source_thread_id": thread_id,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @pytest.mark.asyncio
    async def test_dismiss_nonexistent_memory_returns_404(self, client):
        resp = await client.delete("/api/v1/chat/memory/nonexistent")
        assert resp.status_code == 404
