"""Integration tests for the AI skill-suggestions endpoint.

Runs against the real isolated DB; the LLM is mocked at ``complete_json``.
"""

from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_llm_on(monkeypatch) -> None:
    """Force the router's LLM gate on (router holds its own reference)."""
    monkeypatch.setattr("app.routers.profile._llm_configured", lambda: True)


def _set_llm_off(monkeypatch) -> None:
    monkeypatch.setattr("app.routers.profile._llm_configured", lambda: False)


class TestSkillSuggestions:
    async def test_llm_off_returns_empty_with_note(self, isolated_db, monkeypatch):
        _set_llm_off(monkeypatch)
        async with _client() as client:
            resp = await client.post("/api/v1/profile/skill-suggestions")
        assert resp.status_code == 200
        body = resp.json()
        assert body["skills"] == []
        assert body["note"]

    async def test_llm_on_returns_suggestions_without_existing_skills(
        self, isolated_db, monkeypatch
    ):
        await isolated_db.create_career_skill("Python", proficiency=3)
        await isolated_db.create_career_skill("React", proficiency=2)
        payload = {
            "skills": [
                {"name": "Docker", "reason": "Your projects run in containers.", "kind": "remembered"},
                {"name": "RAG", "reason": "Unlocks LLM apps.", "kind": "learn_next"},
                {"name": "Python", "reason": "Already listed.", "kind": "remembered"},
            ]
        }
        _set_llm_on(monkeypatch)
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(return_value=payload),
        ) as mock_llm:
            async with _client() as client:
                resp = await client.post("/api/v1/profile/skill-suggestions")
        assert resp.status_code == 200
        body = resp.json()
        assert [s["name"] for s in body["skills"]] == ["Docker", "RAG"]
        assert body["skills"][0]["reason"] == "Your projects run in containers."
        assert body["skills"][0]["kind"] == "remembered"
        assert body["skills"][1]["kind"] == "learn_next"
        assert body["note"] is None
        assert mock_llm.await_count == 1

    async def test_garbage_llm_payload_degrades_gracefully(
        self, isolated_db, monkeypatch
    ):
        _set_llm_on(monkeypatch)
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(return_value={"unexpected": True}),
        ):
            async with _client() as client:
                resp = await client.post("/api/v1/profile/skill-suggestions")
        assert resp.status_code == 200
        body = resp.json()
        assert body["skills"] == []
        assert body["note"], "Empty result must come with a note"

    async def test_llm_failure_returns_generic_note(self, isolated_db, monkeypatch):
        _set_llm_on(monkeypatch)
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            async with _client() as client:
                resp = await client.post("/api/v1/profile/skill-suggestions")
        assert resp.status_code == 200
        body = resp.json()
        assert body["skills"] == []
        assert body["note"]