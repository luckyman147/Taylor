"""Integration tests for GET /job-scraper/profile-keywords/{resume_id}.

Tracked career skills must drive the suggested keywords; resume-parsed
skills are only the fallback.
"""

from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestProfileKeywords:
    async def test_unknown_resume_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/job-scraper/profile-keywords/ghost")
        assert resp.status_code == 404

    async def test_tracked_career_skills_drive_keywords(self, isolated_db):
        resume = await isolated_db.create_resume(
            content="# Jane",
            processed_data={
                "additional": {
                    "technicalSkills": [
                        "JavaScript",
                        "COBOL (legacy mainframe)",
                        "React",
                    ]
                },
                "workExperience": [
                    {"title": "Software Engineer", "company": "Globex"},
                ],
            },
        )
        await isolated_db.create_career_skill("Python", proficiency=5, years_experience=6)
        await isolated_db.create_career_skill("Go", proficiency=4, years_experience=2)

        async with _client() as client:
            resp = await client.get(
                f"/api/v1/job-scraper/profile-keywords/{resume['resume_id']}"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["skills"] == ["Python", "Go"]
        assert "Python" in body["suggested_keywords"]
        assert "Go" in body["suggested_keywords"]
        assert "COBOL" not in body["suggested_keywords"]

    async def test_tracked_skills_ranked_by_proficiency(self, isolated_db):
        resume = await isolated_db.create_resume(content="# Jane")
        await isolated_db.create_career_skill("Rust", proficiency=2, years_experience=8)
        await isolated_db.create_career_skill("Go", proficiency=4, years_experience=1)

        async with _client() as client:
            resp = await client.get(
                f"/api/v1/job-scraper/profile-keywords/{resume['resume_id']}"
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["skills"] == ["Go", "Rust"]

    async def test_title_role_keywords_appended(self, isolated_db):
        resume = await isolated_db.create_resume(
            content="# Jane",
            processed_data={
                "workExperience": [
                    {"title": "Software Engineer", "company": "Globex"},
                    {"title": "Backend Developer", "company": "Initech"},
                ],
            },
        )
        await isolated_db.create_career_skill("Python")

        async with _client() as client:
            resp = await client.get(
                f"/api/v1/job-scraper/profile-keywords/{resume['resume_id']}"
            )
        assert resp.status_code == 200
        body = resp.json()
        keywords = body["suggested_keywords"]
        assert "Python" in keywords
        # Roles parsed from the resume drive the family query (Q1).
        assert "Software Engineer" in keywords

    async def test_fallback_to_resume_skills_when_no_career_skills(self, isolated_db):
        resume = await isolated_db.create_resume(
            content="# Jane",
            processed_data={
                "additional": {
                    "technicalSkills": [
                        "Python (Advanced)",
                        "Docker",
                        "COBOL",
                    ]
                },
                "workExperience": [
                    {"title": "Software Engineer", "company": "Globex"},
                ],
            },
        )

        async with _client() as client:
            resp = await client.get(
                f"/api/v1/job-scraper/profile-keywords/{resume['resume_id']}"
            )
        assert resp.status_code == 200
        body = resp.json()
        keywords = body["suggested_keywords"]
        assert "Python" in keywords
        assert "Docker" in keywords
        assert "COBOL" not in keywords
