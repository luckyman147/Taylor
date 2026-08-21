"""Integration tests for the career graph: seeding, edges and CRUD.

Exercises the real API + isolated DB: fulfill-from-resume semantics
(replace-when-present), skill↔entry edges, graph-node CRUD and the
auto-fulfill path triggered by wizard finalize.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas.github import GitHubRepo, GitHubReposResponse
from app.schemas.models import Education, Experience
from app.services.resume_wizard import build_initial_wizard_state


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


_SAMPLE_PROCESSED = {
    "personalInfo": {"name": "Jane Doe", "location": "Berlin"},
    "summary": "Backend engineer who ships.",
    "workExperience": [
        {
            "title": "Backend Engineer",
            "company": "Acme",
            "years": "2021-2024",
            "description": [
                "Built the API with FastAPI and Kubernetes",
                "Cut latency by 40%",
            ],
        }
    ],
    "education": [
        {
            "institution": "Uni Tunis",
            "degree": "BSc Computer Science",
            "years": "2017-2021",
        }
    ],
    "personalProjects": [
        {
            "name": "Resume Matcher",
            "role": "Creator",
            "years": "2024",
            "github": "https://github.com/jane/resume-matcher",
            "description": ["Uses PostgreSQL", "Wrote golang tooling"],
        }
    ],
    "additional": {
        "technicalSkills": ["FastAPI", "Kubernetes", "PostgreSQL"],
        "languages": ["English, French"],
        "awards": ["Dean's list"],
        "certificationsTraining": ["AWS Certified Developer"],
    },
}


async def _seed_master(db, processed: dict) -> None:
    await db.create_resume(
        content="# Jane",
        content_type="md",
        filename="jane.md",
        is_master=True,
        processed_data=processed,
        processing_status="ready",
    )


class TestSeedFulfillsGraph:
    async def test_seed_fills_all_graph_sections(self, isolated_db):
        await _seed_master(isolated_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            resp = await client.post("/api/v1/profile/seed-from-master")
            assert resp.status_code == 200
            resp = await client.get("/api/v1/profile")
            body = resp.json()

        assert body["profile"]["work_experience"][0]["role"] == "Backend Engineer"
        assert body["profile"]["languages"] == ["English", "French"]
        assert body["profile"]["awards"] == ["Dean's list"]
        assert [e["institution"] for e in body["education"]] == ["Uni Tunis"]
        assert [p["name"] for p in body["projects"]] == ["Resume Matcher"]
        assert [
            c["name"] for c in body["certifications"]
        ] == ["AWS Certified Developer"]

    async def test_seed_builds_skill_edges_from_catalog_and_known_skills(
        self, isolated_db
    ):
        await _seed_master(isolated_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            await client.post("/api/v1/profile/seed-from-master")

        experience_edges = await isolated_db.list_career_entry_skills(
            "experience", "0"
        )
        project = (await isolated_db.list_career_projects())[0]
        project_edges = await isolated_db.list_career_entry_skills(
            "project", project["project_id"]
        )

        # Only skills the user listed are linked: FastAPI/Kubernetes yes,
        # "golang" prose no.
        assert [e["skill_name"] for e in experience_edges] == [
            "FastAPI",
            "Kubernetes",
        ]
        assert [e["skill_name"] for e in project_edges] == ["PostgreSQL"]

    async def test_reseed_replaces_when_present_and_keeps_when_absent(
        self, isolated_db
    ):
        await _seed_master(isolated_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            await client.post("/api/v1/profile/seed-from-master")
            # Same master resume re-processed with different education and no
            # projects/certifications sections.
            updated = dict(_SAMPLE_PROCESSED)
            updated["education"] = [
                {
                    "institution": "TU Berlin",
                    "degree": "MSc CS",
                    "years": "2021-2023",
                }
            ]
            updated["personalProjects"] = []
            del updated["additional"]["certificationsTraining"]
            master = await isolated_db.get_master_resume()
            await isolated_db.update_resume(
                master["resume_id"], {"processed_data": updated}
            )
            await client.post("/api/v1/profile/seed-from-master")
            body = (await client.get("/api/v1/profile")).json()

        # Education replaced by the new resume's; certifications and projects
        # survive because the new resume lacks those sections.
        assert [e["institution"] for e in body["education"]] == ["TU Berlin"]
        assert [p["name"] for p in body["projects"]] == ["Resume Matcher"]
        assert [
            c["name"] for c in body["certifications"]
        ] == ["AWS Certified Developer"]

    async def test_upload_edges_pruned_when_experience_shrinks(self, isolated_db):
        await _seed_master(isolated_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            await client.post("/api/v1/profile/seed-from-master")
            # Manual edit: drop the only experience row → its edge must go.
            resp = await client.put(
                "/api/v1/profile", json={"work_experience": []}
            )
            assert resp.status_code == 200

        assert await isolated_db.list_career_entry_skills("experience") == []

    async def test_memory_bundle_includes_graph_nodes(self, isolated_career_db):
        await _seed_master(isolated_career_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            await client.post("/api/v1/profile/seed-from-master")
            resp = await client.get("/api/v1/profile/memory")
        body = resp.json()
        assert [e["institution"] for e in body["education"]] == ["Uni Tunis"]
        project = body["projects"][0]
        assert project["name"] == "Resume Matcher"
        assert project["skills"] == ["PostgreSQL"]
        assert body["achievements"] == []


class TestGraphCrud:
    async def test_education_crud(self, isolated_db):
        async with _client() as client:
            created = await client.post(
                "/api/v1/profile/education",
                json={"institution": "Uni Tunis", "degree": "BSc"},
            )
            assert created.status_code == 201
            education_id = created.json()["education_id"]
            patched = await client.patch(
                f"/api/v1/profile/education/{education_id}",
                json={"years": "2017-2021"},
            )
            assert patched.status_code == 200
            assert patched.json()["years"] == "2017-2021"
            listed = await client.get("/api/v1/profile/education")
            assert [e["institution"] for e in listed.json()] == ["Uni Tunis"]
            deleted = await client.delete(
                f"/api/v1/profile/education/{education_id}"
            )
            assert deleted.json()["affected"] == 1
            assert (await client.get("/api/v1/profile/education")).json() == []

    async def test_project_crud_cascades_edges(self, isolated_db):
        async with _client() as client:
            created = await client.post(
                "/api/v1/profile/projects",
                json={"name": "Matcher", "github": "https://github.com/x/m"},
            )
            project_id = created.json()["project_id"]
            await isolated_db.set_career_entry_skills(
                "project", project_id, ["Python"]
            )
            assert await isolated_db.list_career_entry_skills(
                "project", project_id
            )
            deleted = await client.delete(f"/api/v1/profile/projects/{project_id}")
            assert deleted.json()["affected"] == 1
            # Edges died with the node.
            assert await isolated_db.list_career_entry_skills(
                "project", project_id
            ) == []

    async def test_achievement_crud_and_date_validation(self, isolated_db):
        async with _client() as client:
            bad = await client.post(
                "/api/v1/profile/achievements",
                json={"title": "Win", "date": "June 2024"},
            )
            assert bad.status_code == 422
            created = await client.post(
                "/api/v1/profile/achievements",
                json={"title": "Shipped v2", "date": "2024-06"},
            )
            assert created.status_code == 201
            assert created.json()["date"] == "2024-06"
            deleted = await client.delete(
                f"/api/v1/profile/achievements/{created.json()['achievement_id']}"
            )
            assert deleted.json()["affected"] == 1

    async def test_validation_on_create(self, isolated_db):
        async with _client() as client:
            empty = await client.post("/api/v1/profile/education", json={})
            assert empty.status_code == 422
            no_name = await client.post("/api/v1/profile/projects", json={})
            assert no_name.status_code == 422


class TestEducationImport:
    async def test_import_fills_education_from_master(self, isolated_db):
        await _seed_master(isolated_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            resp = await client.post("/api/v1/profile/education/import-from-master")
            assert resp.status_code == 200
            entries = resp.json()
        assert [e["institution"] for e in entries] == ["Uni Tunis"]

    async def test_import_replaces_stored_education(self, isolated_db):
        await _seed_master(isolated_db, _SAMPLE_PROCESSED)
        async with _client() as client:
            await client.post("/api/v1/profile/education", json={"institution": "Old School"})
            resp = await client.post("/api/v1/profile/education/import-from-master")
            assert [e["institution"] for e in resp.json()] == ["Uni Tunis"]

    async def test_import_noop_without_master_or_education(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/profile/education/import-from-master")
            assert resp.status_code == 200
            assert resp.json() == []
        # Master without an education section leaves stored entries untouched.
        await _seed_master(isolated_db, {"personalInfo": {"name": "Jane"}})
        async with _client() as client:
            await client.post("/api/v1/profile/education", json={"institution": "Kept"})
            resp = await client.post("/api/v1/profile/education/import-from-master")
            assert [e["institution"] for e in resp.json()] == ["Kept"]


class TestGitHubProjectImport:
    _REPOS = GitHubReposResponse(
        repos=[
            GitHubRepo(
                name="resume-matcher",
                description="Match resumes to job descriptions",
                visibility="PUBLIC",
                url="https://github.com/jane/resume-matcher",
                pushed_at=None,
                stargazer_count=12,
                is_fork=False,
                is_archived=False,
                languages=["Python", "TypeScript"],
                topics=["career", "ai"],
                readme="# Resume Matcher\nMatches resumes.",
            ),
            GitHubRepo(
                name="dotfiles",
                description="",
                visibility="PRIVATE",
                url="https://github.com/jane/dotfiles",
                pushed_at=None,
                stargazer_count=0,
                is_fork=True,
                is_archived=False,
                languages=["Shell"],
                topics=[],
                readme="",
            ),
        ],
        total=2,
    )

    async def _connect(self, monkeypatch) -> None:
        import app.routers.profile as profile_router

        async def fake_token() -> str:
            return "test-token"

        async def fake_repos() -> GitHubReposResponse:
            return self._REPOS

        monkeypatch.setattr(profile_router, "_get_token", fake_token)
        monkeypatch.setattr(profile_router, "github_repos", fake_repos)

    async def test_import_creates_projects_with_github_data(
        self, isolated_db, monkeypatch
    ):
        await self._connect(monkeypatch)
        async with _client() as client:
            resp = await client.post("/api/v1/profile/projects/import-from-github")
            assert resp.status_code == 200
            assert resp.json() == {"imported": 2, "updated": 0, "total": 2}
            body = (await client.get("/api/v1/profile")).json()

        by_name = {p["name"]: p for p in body["projects"]}
        matcher = by_name["resume-matcher"]
        assert matcher["github"] == "https://github.com/jane/resume-matcher"
        assert matcher["description"] == ["Match resumes to job descriptions"]
        assert matcher["languages"] == ["Python", "TypeScript"]
        assert matcher["readme"] == "# Resume Matcher\nMatches resumes."
        assert by_name["dotfiles"]["languages"] == ["Shell"]

    async def test_reimport_updates_in_place_without_duplicating(
        self, isolated_db, monkeypatch
    ):
        await self._connect(monkeypatch)
        async with _client() as client:
            await client.post("/api/v1/profile/projects/import-from-github")
            resp = await client.post("/api/v1/profile/projects/import-from-github")
            assert resp.json() == {"imported": 0, "updated": 2, "total": 2}
            body = (await client.get("/api/v1/profile")).json()
        assert len(body["projects"]) == 2

    async def test_import_respects_repo_selection(self, isolated_db, monkeypatch):
        await self._connect(monkeypatch)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/profile/projects/import-from-github",
                json={"repo_urls": ["https://github.com/jane/resume-matcher"]},
            )
            assert resp.status_code == 200
            assert resp.json() == {"imported": 1, "updated": 0, "total": 1}
            body = (await client.get("/api/v1/profile")).json()
        assert [p["name"] for p in body["projects"]] == ["resume-matcher"]

    async def test_import_requires_github_connection(self, isolated_db, monkeypatch):
        import app.routers.profile as profile_router

        async def no_token() -> None:
            return None

        monkeypatch.setattr(profile_router, "_get_token", no_token)
        async with _client() as client:
            resp = await client.post("/api/v1/profile/projects/import-from-github")
            assert resp.status_code == 401

    async def test_project_crud_round_trips_languages_and_readme(self, isolated_db):
        async with _client() as client:
            created = await client.post(
                "/api/v1/profile/projects",
                json={
                    "name": "Matcher",
                    "languages": ["Python", "python", "Go"],
                    "readme": "# Matcher docs",
                },
            )
            assert created.status_code == 201
            project = created.json()
            # Duplicates are dropped case-insensitively.
            assert project["languages"] == ["Python", "Go"]
            assert project["readme"] == "# Matcher docs"

            # A partial edit must not wipe the GitHub-imported extras.
            patched = await client.patch(
                f"/api/v1/profile/projects/{project['project_id']}",
                json={"name": "Matcher v2"},
            )
            assert patched.json()["languages"] == ["Python", "Go"]
            assert patched.json()["readme"] == "# Matcher docs"


class TestAutoFulfillOnWizardFinalize:
    async def test_finalize_fulfills_profile(self, isolated_db):
        state = build_initial_wizard_state()
        state.resume_data.personalInfo.name = "James"
        state.resume_data.personalInfo.location = "Tunis"
        state.resume_data.additional.technicalSkills = ["FastAPI"]
        state.resume_data.workExperience = [
            Experience(
                title="Backend Engineer",
                company="Acme",
                years="2022-2024",
                description=["Built APIs with FastAPI"],
            )
        ]
        state.resume_data.education = [
            Education(
                institution="Uni Tunis",
                degree="BSc",
                years="2017-2021",
            )
        ]

        async with _client() as client:
            resp = await client.post(
                "/api/v1/resume-wizard/finalize",
                json={"state": state.model_dump(mode="json")},
            )
            assert resp.status_code == 200
            body = (await client.get("/api/v1/profile")).json()

        assert body["profile"]["name"] == "James"
        assert body["profile"]["location"] == "Tunis"
        assert [e["institution"] for e in body["education"]] == ["Uni Tunis"]
        edges = await isolated_db.list_career_entry_skills("experience", "0")
        assert [e["skill_name"] for e in edges] == ["FastAPI"]