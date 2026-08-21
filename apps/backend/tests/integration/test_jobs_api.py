"""Integration tests for job description endpoints."""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestJobUpload:
    """POST /api/v1/jobs/upload"""

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_upload_single_job(self, mock_db, client):
        mock_db.create_job.return_value = {
            "job_id": "job-123",
            "content": "Senior Engineer at TechCorp",
            "created_at": "2026-01-01T00:00:00Z",
        }
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["Senior Engineer at TechCorp"],
                "resume_id": None,
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "data successfully processed"
        assert len(data["job_id"]) == 1

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_upload_multiple_jobs(self, mock_db, client):
        mock_db.create_job.side_effect = [
            {"job_id": f"job-{i}", "content": f"JD {i}", "created_at": "2026-01-01T00:00:00Z"}
            for i in range(3)
        ]
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["JD 1", "JD 2", "JD 3"],
            })
        assert resp.status_code == 200
        assert len(resp.json()["job_id"]) == 3

    async def test_upload_empty_list_returns_400(self, client):
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": [],
            })
        assert resp.status_code == 400

    async def test_upload_empty_string_returns_400(self, client):
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["  "],
            })
        assert resp.status_code == 400

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_upload_structured_jobs(self, mock_db, client):
        mock_db.create_job.side_effect = [
            {"job_id": f"job-{i}", "content": f"JD {i}", "created_at": "2026-01-01T00:00:00Z"}
            for i in range(2)
        ]
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "jobs": [
                    {
                        "title": "Backend Engineer",
                        "company": "Acme",
                        "location": "Remote",
                        "description": "Python + FastAPI role",
                        "url": "https://acme.com/jobs/1",
                        "source": "linkedin",
                    },
                    {
                        "title": "Flutter Dev",
                        "description": "Mobile role",
                    },
                ],
            })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["job_id"]) == 2
        assert "structured" in data["message"]

    async def test_upload_structured_with_empty_description_returns_400(self, client):
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "jobs": [{"title": "X", "description": "  "}],
            })
        assert resp.status_code == 400

    async def test_upload_both_modes_returns_400(self, client):
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["JD 1"],
                "jobs": [{"description": "JD 2"}],
            })
        assert resp.status_code == 400


class TestListJobs:
    """GET /api/v1/jobs"""

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_list_jobs_default(self, mock_db, client):
        mock_db.list_jobs.return_value = [
            {
                "job_id": "job-2",
                "content": "x" * 500,
                "resume_id": None,
                "created_at": "2026-01-02T00:00:00Z",
                "title": "Backend Engineer",
                "company": "Acme",
                "source": "linkedin",
            },
            {
                "job_id": "job-1",
                "content": "About the job\nWe are looking for a versatile Full-stack Developer.\nRoles And Responsibilities",
                "resume_id": None,
                "created_at": "2026-01-01T00:00:00Z",
            },
        ]
        async with client:
            resp = await client.get("/api/v1/jobs")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["job_id"] == "job-2"
        assert data[0]["title"] == "Backend Engineer"
        assert data[0]["source"] == "linkedin"
        assert len(data[0]["content_preview"]) == 300
        assert data[1]["title"] is None

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_list_jobs_filters_source(self, mock_db, client):
        mock_db.list_jobs.return_value = []
        async with client:
            resp = await client.get("/api/v1/jobs", params={"source": "linkedin", "limit": 5})
        assert resp.status_code == 200
        assert resp.json() == []
        assert mock_db.list_jobs.call_args.kwargs == {"source": "linkedin", "limit": 5}

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_list_jobs_falls_back_to_extracted_fields(self, mock_db, client):
        mock_db.list_jobs.return_value = [
            {
                "job_id": "job-1",
                "content": "Junior Django Developer – Full-Time | On-site | Tunis, Tunisia\nCompany Description\nBridges S.A. is hiring.",
                "resume_id": None,
                "created_at": "2026-01-01T00:00:00Z",
            },
            {
                "job_id": "job-2",
                "content": "( Platform Engineer @ Stravos )\nAbout Stravos :",
                "resume_id": None,
                "created_at": "2026-01-01T00:00:00Z",
            },
        ]
        async with client:
            resp = await client.get("/api/v1/jobs")
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["title"] == "Junior Django Developer"
        assert data[0]["location"] == "Tunis, Tunisia"
        assert data[0]["company"] == "Bridges S.A."
        assert data[1]["title"] == "Platform Engineer"
        assert data[1]["company"] == "Stravos"

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_list_jobs_keeps_stored_metadata_over_extraction(self, mock_db, client):
        mock_db.list_jobs.return_value = [
            {
                "job_id": "job-1",
                "content": "( Fallback Title @ Fallback Co )\n",
                "resume_id": None,
                "created_at": "2026-01-01T00:00:00Z",
                "title": "Stored Title",
                "company": "Stored Co",
            },
        ]
        async with client:
            resp = await client.get("/api/v1/jobs")
        assert resp.json()[0]["title"] == "Stored Title"
        assert resp.json()[0]["company"] == "Stored Co"


class TestGetJob:
    """GET /api/v1/jobs/{job_id}"""

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_get_existing_job(self, mock_db, client):
        mock_db.get_job.return_value = {
            "job_id": "job-123",
            "content": "Engineer role",
            "created_at": "2026-01-01T00:00:00Z",
        }
        async with client:
            resp = await client.get("/api/v1/jobs/job-123")
        assert resp.status_code == 200
        assert resp.json()["job_id"] == "job-123"

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_get_nonexistent_job_returns_404(self, mock_db, client):
        mock_db.get_job.return_value = None
        async with client:
            resp = await client.get("/api/v1/jobs/nonexistent")
        assert resp.status_code == 404


class TestDeleteJob:
    """DELETE /api/v1/jobs/{job_id}"""

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_delete_existing_job(self, mock_db, client):
        mock_db.delete_job.return_value = True
        async with client:
            resp = await client.delete("/api/v1/jobs/job-123")
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] is True
        assert body["job_id"] == "job-123"
        mock_db.delete_job.assert_awaited_once_with("job-123")

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_delete_nonexistent_job_returns_404(self, mock_db, client):
        mock_db.delete_job.return_value = False
        async with client:
            resp = await client.delete("/api/v1/jobs/nonexistent")
        assert resp.status_code == 404
