"""Integration tests for skill gaps + learning resources endpoints.

Runs against the real isolated DB; the LLM is mocked at ``complete_json``
and proposed URLs are served by ``respx`` so the real verifier runs.
"""

from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_jobs(isolated_db) -> None:
    await isolated_db.save_scraped_jobs(
        search_id="s1",
        resume_id="r1",
        jobs=[
            {
                "title": "Senior Python Developer",
                "company": "Acme",
                "url": "https://a/1",
                "description": "Senior Python engineer with deep Django and SQL.",
                "salary": "$130,000",
            },
            {
                "title": "Platform Engineer",
                "company": "Globex",
                "url": "https://a/2",
                "description": "We run Kubernetes on AWS with Terraform.",
                "salary": "$120,000",
            },
        ],
    )


def _llm_resource_payload():
    return {
        "Kubernetes": [
            {"title": "K8s Docs", "url": "https://kubernetes.test/docs", "source": "docs"},
            {"title": "Dead Course", "url": "https://dead.test/course", "source": "course"},
        ]
    }


def _set_llm_on(monkeypatch) -> None:
    """Force the router's LLM gate on (router holds its own reference)."""
    monkeypatch.setattr("app.routers.profile._llm_configured", lambda: True)


def _set_llm_off(monkeypatch) -> None:
    monkeypatch.setattr("app.routers.profile._llm_configured", lambda: False)


class TestSkillRoiSections:
    async def test_returns_gap_and_strengthen_sections(self, isolated_db):
        await isolated_db.create_career_skill("Python", proficiency=1)
        await _seed_jobs(isolated_db)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-roi", json={"include_advice": False}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["gaps"], "Expected missing demanded skills in gaps"
        assert all(row["action"] == "learn" for row in body["gaps"])
        assert {row["skill"] for row in body["gaps"]} >= {"Kubernetes", "AWS", "Terraform"}
        python = next(row for row in body["strengthen"] if row["skill"] == "Python")
        assert python["action"] == "strengthen"
        assert python["existing_knowledge"] == 20

    async def test_sections_empty_without_jobs(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-roi", json={"include_advice": False}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["gaps"] == []
        assert body["strengthen"] == []
        assert body["note"]


class TestSkillResources:
    @respx.mock
    async def test_generates_verifies_and_caches(
        self, isolated_db, monkeypatch
    ):
        respx.get("https://kubernetes.test/docs").mock(
            return_value=httpx.Response(200, text="<title>Kubernetes Docs</title>")
        )
        respx.get("https://dead.test/course").mock(
            return_value=httpx.Response(404)
        )
        _set_llm_on(monkeypatch)
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(return_value=_llm_resource_payload()),
        ) as mock_llm:
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/profile/skill-resources",
                    json={"skills": ["Kubernetes"]},
                )
        assert resp.status_code == 200
        resources = resp.json()["resources"]
        assert resources == {
            "Kubernetes": [
                {
                    "title": "Kubernetes Docs",
                    "url": "https://kubernetes.test/docs",
                    "source": "docs",
                }
            ]
        }, "Dead link must be dropped, live link keeps real title"
        assert mock_llm.await_count == 1

    @respx.mock
    async def test_second_call_serves_cache_without_llm(
        self, isolated_db, monkeypatch
    ):
        respx.get("https://kubernetes.test/docs").mock(
            return_value=httpx.Response(200, text="<title>Kubernetes Docs</title>")
        )
        _set_llm_on(monkeypatch)
        payload = _llm_resource_payload()
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(return_value=payload),
        ) as mock_llm:
            async with _client() as client:
                first = await client.post(
                    "/api/v1/profile/skill-resources",
                    json={"skills": ["Kubernetes"]},
                )
                second = await client.post(
                    "/api/v1/profile/skill-resources",
                    json={"skills": ["Kubernetes"]},
                )
        assert first.status_code == 200 and second.status_code == 200
        assert second.json()["resources"]["Kubernetes"], "Cache must be served"
        assert mock_llm.await_count == 1, "Second call must not hit the LLM"

    @respx.mock
    async def test_refresh_forces_regeneration(self, isolated_db, monkeypatch):
        respx.get("https://kubernetes.test/docs").mock(
            return_value=httpx.Response(200, text="<title>Kubernetes Docs</title>")
        )
        _set_llm_on(monkeypatch)
        payload = _llm_resource_payload()
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(return_value=payload),
        ) as mock_llm:
            async with _client() as client:
                await client.post(
                    "/api/v1/profile/skill-resources",
                    json={"skills": ["Kubernetes"]},
                )
                await client.post(
                    "/api/v1/profile/skill-resources",
                    json={"skills": ["Kubernetes"], "refresh": True},
                )
        assert mock_llm.await_count == 2, "refresh=True must regenerate"

    @respx.mock
    async def test_llm_off_serves_cached_data_with_note(
        self, isolated_db, monkeypatch
    ):
        respx.get("https://kubernetes.test/docs").mock(
            return_value=httpx.Response(200, text="<title>Kubernetes Docs</title>")
        )
        _set_llm_on(monkeypatch)
        with patch(
            "app.services.career_profile.complete_json",
            new=AsyncMock(return_value=_llm_resource_payload()),
        ):
            async with _client() as client:
                await client.post(
                    "/api/v1/profile/skill-resources",
                    json={"skills": ["Kubernetes"]},
                )
        _set_llm_off(monkeypatch)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-resources",
                json={"skills": ["Kubernetes", "AWS"]},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["resources"]["Kubernetes"], "Cached data still served"
        assert "AWS" not in body["resources"]
        assert body["note"]

    async def test_empty_skills_is_422(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-resources", json={"skills": []}
            )
        assert resp.status_code == 422
