"""Integration tests for the career-profile API (real isolated DB)."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def llm_off(monkeypatch):
    """Force the LLM to look unconfigured regardless of the dev config."""

    class _NoKeyConfig:
        api_key = None
        provider = "openai"

    monkeypatch.setattr("app.services.career_profile.get_llm_config", lambda: _NoKeyConfig())


class TestProfileCrud:
    async def test_get_auto_creates_empty_profile(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/profile")
        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"]["profile_id"]
        assert body["profile"]["name"] is None
        assert body["skills"] == []
        assert body["certifications"] == []

    async def test_get_tolerates_legacy_row_with_null_work_experience(self, isolated_db):
        from sqlalchemy import text

        async with isolated_db._session() as session:
            for column in ("work_experience", "languages", "awards"):
                await session.execute(
                    text(f"ALTER TABLE career_profiles DROP COLUMN {column}")
                )
                await session.execute(
                    text(f"ALTER TABLE career_profiles ADD COLUMN {column} TEXT")
                )
            await session.execute(
                text(
                    "INSERT INTO career_profiles "
                    "(profile_id, career_goals, target_roles, target_locations, "
                    " created_at, updated_at) "
                    "VALUES ('legacy-1', '[]', '[]', '[]', "
                    "        '2024-01-01T00:00:00', '2024-01-01T00:00:00')"
                )
            )
            await session.commit()
        async with _client() as client:
            resp = await client.get("/api/v1/profile")
        assert resp.status_code == 200
        profile = resp.json()["profile"]
        assert profile["work_experience"] == []
        assert profile["languages"] == []
        assert profile["awards"] == []
        assert profile["source_resume_id"] is None

    async def test_put_updates_and_persists(self, isolated_db):
        async with _client() as client:
            resp = await client.put(
                "/api/v1/profile",
                json={
                    "name": "Jane Doe",
                    "title": "Senior Data Scientist",
                    "target_roles": ["ML Engineer", "Data Engineer"],
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Jane Doe"
        assert body["target_roles"] == ["ML Engineer", "Data Engineer"]

        async with _client() as client:
            resp = await client.get("/api/v1/profile")
        assert resp.json()["profile"]["name"] == "Jane Doe"

    async def test_put_ignores_unknown_fields(self, isolated_db):
        async with _client() as client:
            resp = await client.put("/api/v1/profile", json={"name": "A", "nope": 42})
        assert resp.status_code == 200
        assert resp.json()["name"] == "A"

    async def test_put_work_experience_round_trip_and_cleaning(self, isolated_db):
        payload = {
            "work_experience": [
                {
                    "role": "Backend Engineer",
                    "company": "Acme",
                    "location": "Berlin",
                    "years": "2021-2024",
                    "description": ["Built the API", " Cut latency "],
                },
                {"role": "", "company": "", "location": "", "years": "", "description": []},
            ]
        }
        async with _client() as client:
            resp = await client.put("/api/v1/profile", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["work_experience"] == [
            {
                "role": "Backend Engineer",
                "company": "Acme",
                "location": "Berlin",
                "years": "2021-2024",
                "description": ["Built the API", "Cut latency"],
            }
        ]
        assert body["source_resume_id"] is None

        async with _client() as client:
            resp = await client.get("/api/v1/profile")
        assert resp.json()["profile"]["work_experience"][0]["role"] == "Backend Engineer"


class TestSeedFromMaster:
    async def test_seed_404_without_master(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
        assert resp.status_code == 404

    async def test_seed_empty_body_uses_master(self, isolated_db):
        await isolated_db.create_resume(
            content="# Jane",
            is_master=True,
            processed_data={"personalInfo": {"name": "Jane Doe"}},
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master", json={})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Jane Doe"

    async def test_seed_unknown_resume_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/seed-from-master", json={"resume_id": "ghost"}
            )
        assert resp.status_code == 404

    async def test_seed_copies_personal_info(self, isolated_db):
        await isolated_db.create_resume(
            content="# Jane",
            is_master=True,
            processed_data={
                "personalInfo": {
                    "name": "Jane Doe",
                    "title": "Backend Engineer",
                    "email": "jane@example.com",
                    "linkedin": "linkedin.com/in/jane",
                    "city": "Berlin",
                }
            },
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Jane Doe"
        assert body["title"] == "Backend Engineer"
        assert body["email"] == "jane@example.com"
        assert body["linkedin"] == "linkedin.com/in/jane"
        assert body["location"] is None

    async def test_seed_from_chosen_resume_copies_summary_skills_experience(self, isolated_db):
        resume = await isolated_db.create_resume(
            content="# Full CV",
            is_master=False,
            title="Full CV 2026",
            filename="full-cv.pdf",
            processed_data={
                "personalInfo": {"name": "Jane Doe", "title": "Staff Engineer"},
                "summary": "Ten years shipping distributed systems.",
                "workExperience": [
                    {
                        "title": "Staff Engineer",
                        "company": "Globex",
                        "location": "Remote",
                        "years": "2022 - Present",
                        "description": ["Led the platform team", "Cut p99 30%"],
                    },
                    {"title": "", "company": "", "years": "", "description": []},
                ],
                "additional": {"technicalSkills": ["Go", "Kubernetes", "go"]},
            },
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/seed-from-master", json={"resume_id": resume["resume_id"]}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Jane Doe"
        assert body["summary"] == "Ten years shipping distributed systems."
        assert body["work_experience"] == [
            {
                "role": "Staff Engineer",
                "company": "Globex",
                "location": "Remote",
                "years": "2022 - Present",
                "description": ["Led the platform team", "Cut p99 30%"],
            }
        ]
        assert body["source_resume_id"] == resume["resume_id"]
        assert body["source_resume_title"] == "Full CV 2026"

        async with _client() as client:
            resp = await client.get("/api/v1/profile")
        skill_names = [skill["name"] for skill in resp.json()["skills"]]
        assert skill_names == ["Go", "Kubernetes"]

    async def test_seed_merges_skills_keeps_existing(self, isolated_db):
        async with _client() as client:
            await client.post("/api/v1/profile/skills", json={"name": "Python"})
        await isolated_db.create_resume(
            content="# CV",
            is_master=True,
            processed_data={
                "additional": {"technicalSkills": ["python", "Docker", "SQL"]}
            },
        )
        async with _client() as client:
            await client.post("/api/v1/profile/seed-from-master")
            resp = await client.get("/api/v1/profile")
        skill_names = [skill["name"] for skill in resp.json()["skills"]]
        assert sorted(skill_names) == ["Docker", "Python", "SQL"]

    async def test_seed_splits_comma_merged_skills_and_languages(self, isolated_db):
        await isolated_db.create_resume(
            content="# CV",
            is_master=True,
            processed_data={
                "additional": {
                    "technicalSkills": [
                        "Angular, .NET / ASP.NET Core, NestJS,",
                        "Git, GitHub; Docker, Kubernetes",
                        "Python",
                    ],
                    "languages": ["English, French"],
                }
            },
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
            assert resp.status_code == 200
            profile = resp.json()
            resp = await client.get("/api/v1/profile")
            skills = [skill["name"] for skill in resp.json()["skills"]]
        assert skills == [
            ".NET / ASP.NET Core",
            "Angular",
            "Docker",
            "Git",
            "GitHub",
            "Kubernetes",
            "NestJS",
            "Python",
        ]
        assert profile["languages"] == ["English", "French"]

    async def test_seed_keeps_existing_summary_when_resume_has_none(self, isolated_db):
        async with _client() as client:
            await client.put("/api/v1/profile", json={"summary": "My own summary"})
        await isolated_db.create_resume(
            content="# CV",
            is_master=True,
            processed_data={"personalInfo": {"name": "Jane"}},
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
        assert resp.status_code == 200
        assert resp.json()["summary"] == "My own summary"
        assert resp.json()["name"] == "Jane"

    async def test_seed_replaces_languages_and_awards(self, isolated_db):
        async with _client() as client:
            await client.put(
                "/api/v1/profile",
                json={"languages": ["French"], "awards": ["Old Award"]},
            )
        await isolated_db.create_resume(
            content="# CV",
            is_master=True,
            processed_data={
                "additional": {
                    "languages": ["English", "Arabic"],
                    "awards": ["Dean's List", "Hackathon Winner"],
                }
            },
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
        assert resp.status_code == 200
        body = resp.json()
        assert body["languages"] == ["English", "Arabic"]
        assert body["awards"] == ["Dean's List", "Hackathon Winner"]

    async def test_seed_keeps_existing_lists_when_resume_has_none(self, isolated_db):
        async with _client() as client:
            await client.put(
                "/api/v1/profile",
                json={"languages": ["French"], "awards": ["Old Award"]},
            )
        await isolated_db.create_resume(
            content="# CV",
            is_master=True,
            processed_data={"personalInfo": {"name": "Jane"}},
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
        assert resp.status_code == 200
        body = resp.json()
        assert body["languages"] == ["French"]
        assert body["awards"] == ["Old Award"]

    async def test_put_languages_and_awards_round_trip_and_clean(self, isolated_db):
        async with _client() as client:
            resp = await client.put(
                "/api/v1/profile",
                json={"languages": [" English ", " ", "Arabic"], "awards": [" A ", ""]},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["languages"] == ["English", "Arabic"]
        assert body["awards"] == ["A"]


class TestSkills:
    async def test_create_then_patch_then_delete(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skills",
                json={"name": "Python", "proficiency": 5, "years_experience": 6},
            )
        assert resp.status_code == 201
        skill = resp.json()
        assert skill["name"] == "Python"
        skill_id = skill["skill_id"]

        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/profile/skills/{skill_id}", json={"proficiency": 3}
            )
        assert resp.status_code == 200
        assert resp.json()["proficiency"] == 3

        async with _client() as client:
            resp = await client.delete(f"/api/v1/profile/skills/{skill_id}")
        assert resp.status_code == 200
        assert resp.json()["affected"] == 1

    async def test_duplicate_name_conflicts_case_insensitively(self, isolated_db):
        async with _client() as client:
            await client.post("/api/v1/profile/skills", json={"name": "Python"})
            resp = await client.post("/api/v1/profile/skills", json={"name": "python"})
        assert resp.status_code == 409

    async def test_patch_unknown_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.patch(
                "/api/v1/profile/skills/ghost", json={"proficiency": 2}
            )
        assert resp.status_code == 404

    async def test_delete_unknown_returns_affected_zero(self, isolated_db):
        async with _client() as client:
            resp = await client.delete("/api/v1/profile/skills/ghost")
        assert resp.status_code == 200
        assert resp.json()["affected"] == 0

    async def test_rename_onto_existing_conflicts(self, isolated_db):
        async with _client() as client:
            a = (await client.post("/api/v1/profile/skills", json={"name": "Go"})).json()
            await client.post("/api/v1/profile/skills", json={"name": "Rust"})
            resp = await client.patch(
                f"/api/v1/profile/skills/{a['skill_id']}", json={"name": "rust"}
            )
        assert resp.status_code == 409


class TestCertifications:
    async def test_lifecycle(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/certifications",
                json={
                    "name": "AWS Solutions Architect",
                    "issuer": "Amazon",
                    "date_obtained": "2024-03",
                },
            )
        assert resp.status_code == 201
        cert = resp.json()
        assert cert["name"] == "AWS Solutions Architect"
        cert_id = cert["certification_id"]

        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/profile/certifications/{cert_id}", json={"url": "https://aws"}
            )
        assert resp.status_code == 200
        assert resp.json()["url"] == "https://aws"

        async with _client() as client:
            resp = await client.delete(f"/api/v1/profile/certifications/{cert_id}")
        assert resp.status_code == 200
        assert resp.json()["affected"] == 1

    async def test_patch_unknown_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.patch(
                "/api/v1/profile/certifications/ghost", json={"name": "X"}
            )
        assert resp.status_code == 404


class TestMemory:
    async def test_memory_shape(self, isolated_career_db):
        async with _client() as client:
            resp = await client.get("/api/v1/profile/memory")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "profile",
            "master_resume",
            "skills",
            "certifications",
            "education",
            "projects",
            "achievements",
            "funnel",
            "rejected_applications",
            "scraped_jobs",
            "contacts",
            "github_repos",
        }
        assert "rejection_rate" in body["funnel"]
        assert "total" in body["funnel"]
        assert "by_status" in body["funnel"]


class TestInsights:
    async def test_insights_llm_called_once_per_snapshot(self, isolated_career_db):
        """The gap-analysis LLM call is cached until the data snapshot changes."""
        from app.services import career_profile as cp

        application = await isolated_career_db.create_application(
            job_id="j-cache-1", resume_id="r-cache-1", status="applied"
        )
        with (
            patch.object(
                cp,
                "generate_gap_analysis",
                new_callable=AsyncMock,
                return_value="**Narrative 1**",
            ) as gap,
        ):
            async with _client() as client:
                first = await client.get("/api/v1/profile/insights")
                second = await client.get("/api/v1/profile/insights")
        assert first.status_code == 200
        assert first.json()["stats"]["total"] == 1
        assert first.json()["stats"]["by_status"]["applied"] == 1
        assert first.json()["narrative"] == "**Narrative 1**"
        assert second.json() == first.json()
        assert gap.await_count == 1  # served from cache, no second LLM call

        # A write (rejection) flips the fingerprint → cache rebuilds.
        with (
            patch.object(
                cp,
                "generate_gap_analysis",
                new_callable=AsyncMock,
                return_value="**Narrative 2**",
            ) as gap,
        ):
            async with _client() as client:
                await client.patch(
                    f"/api/v1/applications/{application['application_id']}",
                    json={"status": "rejected"},
                )
                third = await client.get("/api/v1/profile/insights")
        assert third.json()["stats"]["total"] == 1
        assert third.json()["stats"]["by_status"]["rejected"] == 1
        assert third.json()["narrative"] == "**Narrative 2**"
        assert gap.await_count == 1

    async def test_insights_invalidate_on_new_saved_job(self, isolated_career_db):
        from app.services import career_profile as cp

        with (
            patch.object(
                cp,
                "generate_gap_analysis",
                new_callable=AsyncMock,
                return_value="**Before**",
            ) as gap,
        ):
            async with _client() as client:
                first = await client.get("/api/v1/profile/insights")
        assert first.status_code == 200
        assert first.json()["narrative"] == "**Before**"
        assert gap.await_count == 1

        await isolated_career_db.save_scraped_jobs(
            search_id="s-cache-2",
            resume_id="r-cache-2",
            jobs=[{"title": "Python Dev", "company": "Acme", "url": "https://a/cache"}],
        )
        with (
            patch.object(
                cp,
                "generate_gap_analysis",
                new_callable=AsyncMock,
                return_value="**After**",
            ) as gap,
        ):
            async with _client() as client:
                second = await client.get("/api/v1/profile/insights")
        assert second.json()["narrative"] == "**After**"
        assert gap.await_count == 1

    async def test_insights_degrade_when_llm_fails(self, isolated_career_db):
        from app.services import career_profile as cp

        with (
            patch.object(
                cp,
                "generate_gap_analysis",
                new_callable=AsyncMock,
                side_effect=RuntimeError("boom"),
            ),
        ):
            async with _client() as client:
                resp = await client.get("/api/v1/profile/insights")
        assert resp.status_code == 200
        assert resp.json()["narrative"] is None
        assert resp.json()["stats"]["total"] == 0


class TestAsk:
    async def test_ask_503_when_llm_not_configured(self, isolated_db, llm_off):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/ask", json={"question": "What should I learn next?"}
            )
        assert resp.status_code == 503

    async def test_ask_returns_markdown_answer(self, isolated_db):
        with (
            patch(
                "app.routers.profile.answer_career_question",
                new_callable=AsyncMock,
                return_value="**Learn ML**",
            ),
            patch(
                "app.services.career_profile.get_llm_config",
                return_value=type("C", (), {"api_key": "sk-test", "provider": "openai"})(),
            ),
        ):
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/profile/ask", json={"question": "What should I learn next?"}
                )
        assert resp.status_code == 200
        assert resp.json()["answer"] == "**Learn ML**"

    async def test_ask_missing_question_is_422(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/profile/ask", json={})
        assert resp.status_code == 422


class TestSkillRoi:
    async def test_roi_empty_returns_note(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-roi", json={"include_advice": False}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []
        assert body["note"]
        assert body["advice"] is None

    async def test_roi_uses_saved_jobs_deterministically(self, isolated_db):
        await isolated_db.save_scraped_jobs(
            search_id="s1",
            resume_id="r1",
            jobs=[
                {
                    "title": "Senior Python Developer",
                    "company": "Acme",
                    "url": "https://a/1",
                    "description": "Looking for a senior Python engineer with deep Django and SQL experience. Salary $130,000 - $150,000.",
                    "salary": "$130,000 - $150,000",
                },
                {
                    "title": "Data Scientist",
                    "company": "Globex",
                    "url": "https://a/2",
                    "description": "We need a Python and PyTorch expert. No SQL.",
                    "salary": "$110,000",
                },
            ],
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-roi", json={"include_advice": False}
            )
            second = await client.post(
                "/api/v1/profile/skill-roi", json={"include_advice": False}
            )
        assert resp.status_code == 200
        rows = resp.json()["results"]
        assert rows, "Expected at least one ROI row from the catalog"
        top = rows[0]
        assert set(top.keys()) == {
            "skill",
            "jobs_unlocked_pct",
            "matching_jobs",
            "salary_impact_pct",
            "learning_effort",
            "existing_knowledge",
            "roi_score",
            "action",
            "in_profile",
        }
        assert top["matching_jobs"] >= 0
        assert 0 <= top["roi_score"] <= 100
        assert second.json()["results"] == rows

    async def test_roi_filters_to_requested_skills(self, isolated_db):
        await isolated_db.save_scraped_jobs(
            search_id="s1",
            resume_id="r1",
            jobs=[
                {
                    "title": "Python Developer",
                    "company": "Acme",
                    "url": "https://a/1",
                    "description": "Python expert wanted.",
                    "salary": None,
                }
            ],
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-roi",
                json={"skills": ["Python", "Nonexistent-Skill-Xyz"], "include_advice": False},
            )
        assert resp.status_code == 200
        names = [row["skill"] for row in resp.json()["results"]]
        assert "Python" in names
        assert "Nonexistent-Skill-Xyz" not in names

    async def test_roi_includes_profile_skills(self, isolated_db):
        await isolated_db.save_scraped_jobs(
            search_id="s1",
            resume_id="r1",
            jobs=[
                {
                    "title": "Python Developer",
                    "company": "Acme",
                    "url": "https://a/1",
                    "description": "Python expert wanted.",
                    "salary": None,
                }
            ],
        )
        await isolated_db.create_career_skill("Python", proficiency=4)
        await isolated_db.create_career_skill("RareSkillNotInJobs", proficiency=2)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/skill-roi", json={"include_advice": False}
            )
        assert resp.status_code == 200
        rows = {row["skill"]: row for row in resp.json()["results"]}
        assert "Python" in rows
        assert rows["Python"]["matching_jobs"] == 1
        assert rows["Python"]["existing_knowledge"] == 80
        assert "RareSkillNotInJobs" in rows, "Profile skills must show even without job matches"
        assert rows["RareSkillNotInJobs"]["matching_jobs"] == 0


class TestSuggestions:
    async def test_suggestions_from_jobs_and_work_history(self, isolated_db):
        await isolated_db.save_scraped_jobs(
            search_id="s1",
            resume_id="r1",
            jobs=[
                {
                    "title": "Senior Python Developer",
                    "company": "Acme",
                    "location": "Tunis, Tunisia",
                    "url": "https://a/1",
                    "description": "Python expert wanted.",
                },
                {
                    "title": "Senior Python Developer",
                    "company": "Globex",
                    "location": "Remote",
                    "url": "https://a/2",
                    "description": "Django wanted.",
                },
            ],
        )
        await isolated_db.update_career_profile(
            {"work_experience": [{"role": "Backend Engineer", "company": "OldCo", "location": "Sousse"}]}
        )
        async with _client() as client:
            roles = await client.get("/api/v1/profile/suggestions?field=target_roles")
            locations = await client.get("/api/v1/profile/suggestions?field=target_locations")
        assert roles.status_code == 200
        assert set(roles.json()["suggestions"]) == {"Senior Python Developer", "Backend Engineer"}
        assert locations.status_code == 200
        assert set(locations.json()["suggestions"]) == {"Tunis, Tunisia", "Remote", "Sousse"}

    async def test_suggestions_goals_are_role_derived(self, isolated_db):
        await isolated_db.save_scraped_jobs(
            search_id="s1",
            resume_id="r1",
            jobs=[
                {
                    "title": "ML Engineer",
                    "company": "Acme",
                    "url": "https://a/1",
                    "description": "ML wanted.",
                }
            ],
        )
        async with _client() as client:
            resp = await client.get("/api/v1/profile/suggestions?field=career_goals")
        assert resp.status_code == 200
        suggestions = resp.json()["suggestions"]
        assert suggestions, "Expected role-derived career goals"
        assert any("ML Engineer" in goal for goal in suggestions)

    async def test_suggestions_empty_when_no_data(self, isolated_db):
        async with _client() as client:
            for field in ("career_goals", "target_roles", "target_locations"):
                resp = await client.get(f"/api/v1/profile/suggestions?field={field}")
                assert resp.status_code == 200
                assert resp.json()["suggestions"] == []

    async def test_suggestions_invalid_field_is_422(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/profile/suggestions?field=bogus")
        assert resp.status_code == 422


class TestMarketPosition:
    async def test_market_position_empty_returns_note_and_verdict(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/profile/market-position", json={})
        assert resp.status_code == 200
        body = resp.json()
        assert body["skills"] == []
        assert body["domains"] == []
        assert body["current_role"] is None
        assert body["specialization"] == []
        assert body["recommended_roles"] == []
        assert body["note"]
        assert body["verdict"]

    async def test_market_position_scores_skills_and_domains(self, isolated_db):
        await isolated_db.create_career_skill(
            "Python", proficiency=4, years_experience=3, last_used="2026"
        )
        await isolated_db.create_career_skill("Kubernetes", proficiency=1)
        await isolated_db.create_career_certification(
            name="AWS Certified Solutions Architect", issuer="AWS"
        )
        await isolated_db.update_career_profile(
            {"work_experience": [{"role": "Backend Engineer", "years": "2019 - 2023"}]}
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/market-position", json={})
        assert resp.status_code == 200
        body = resp.json()

        skills = {row["skill"]: row for row in body["skills"]}
        assert "Python" in skills
        assert 0 <= skills["Python"]["percentile"] <= 100
        assert skills["Python"]["level"] in {"beginner", "intermediate", "advanced", "expert"}
        assert "Kubernetes" in skills
        assert body["note"] is None

        domains = {row["domain"]: row for row in body["domains"]}
        assert "Backend" in domains
        backend = domains["Backend"]
        assert backend["percentile"] > 40
        assert backend["readiness"] in {"strong", "adequate", "underqualified"}
        assert backend["seniority"] in {"junior", "mid", "senior"}

        assert body["current_role"] == "Mid Backend Engineer"
        assert body["specialization"] == ["Python"]
        assert body["recommended_roles"]
        assert body["recommended_roles"][0]["role"] == "Python Developer"
        assert "Best next picks" in body["verdict"]

    async def test_market_position_uses_projects_as_evidence(self, isolated_db):
        await isolated_db.create_career_project(
            name="React dashboard",
            description=["A TypeScript UI for metrics"],
            languages=["React", "TypeScript"],
        )
        async with _client() as client:
            resp = await client.post("/api/v1/profile/market-position", json={})
        assert resp.status_code == 200
        body = resp.json()
        domains = {row["domain"]: row for row in body["domains"]}
        assert "Frontend" in domains, "Projects alone should surface the Frontend domain"
        assert body["current_role"] == "Junior Frontend Developer"