"""Integration tests: JD-matched projects replace the Projects section.

Drives the real ``POST /resumes/improve/preview`` router against the isolated
DB with every LLM boundary mocked — except ``merge_matched_projects``, which
runs for real over seeded ``career_projects`` (its own ``complete_json`` call
is mocked). Asserts the replacement is visible in the preview resume AND in
the diff summary shown to the user.
"""

import copy
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.main import app

_JD_KEYWORDS = {
    "required_skills": ["Python"],
    "preferred_skills": [],
    "keywords": ["api", "docker"],
}

_BULLETS = {
    "openapi generator": ["Resolved spec drift by building a CLI generator that ships clients to users"],
    "docker swarm dashboard": ["Resolved cluster blind spots by building a live dashboard, cutting incident time"],
    "chess engine in c": ["Resolved slow decision trees by building alpha-beta search, beating novice players"],
}


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_resume_and_job(isolated_db, sample_resume):
    resume_data = copy.deepcopy(sample_resume)
    resume_data["personalProjects"] = [
        {
            "id": 1,
            "name": "Legacy App",
            "role": "Maintainer",
            "years": "2022",
            "github": None,
            "website": None,
            "description": ["Old monolithic app"],
            "descriptionStyles": ["bullet"],
        },
        {
            "id": 2,
            "name": "Tiny Shell",
            "role": "Hobbyist",
            "years": "2020",
            "github": None,
            "website": None,
            "description": ["A minimal POSIX shell"],
            "descriptionStyles": ["bullet"],
        },
        {
            "id": 3,
            "name": "Old App",
            "role": "Maintainer",
            "years": "2019",
            "github": None,
            "website": None,
            "description": ["Something unrelated"],
            "descriptionStyles": ["bullet"],
        },
    ]
    resume = await isolated_db.create_resume(
        content=__import__("json").dumps(resume_data, indent=2),
        content_type="json",
        filename="master.json",
        is_master=True,
        processed_data=resume_data,
        processing_status="ready",
    )
    job = await isolated_db.create_job(content="Senior Backend Engineer: Python and Docker.")
    return resume["resume_id"], job["job_id"], resume_data


async def _seed_career_projects(isolated_db):
    await isolated_db.create_career_project(
        name="OpenAPI Generator",
        role="Creator",
        years="2024",
        github="https://github.com/user/openapi-generator",
        description=["CLI tool generating API clients from OpenAPI specs"],
        languages=["Python"],
        readme="No numbers here.",
    )
    await isolated_db.create_career_project(
        name="Docker Swarm Dashboard",
        role="Developer",
        years="2023",
        description=["Web dashboard to manage Docker Swarm clusters"],
        languages=["Python", "Docker"],
    )
    await isolated_db.create_career_project(
        name="Chess Engine in C",
        role="Hobbyist",
        years="2021",
        description=["A toy chess engine"],
        languages=["C"],
    )


def _preview_stubs(original_data: dict, extra_bullets: dict | None = None):
    """Patch every LLM boundary except the real merge_matched_projects."""
    mocked_projects = [
        {"name": "OpenAPI Generator", "description": _BULLETS["openapi generator"]},
        {"name": "Docker Swarm Dashboard", "description": _BULLETS["docker swarm dashboard"]},
    ]
    if extra_bullets:
        for name, bullets in extra_bullets.items():
            mocked_projects.append({"name": name, "description": bullets})
    return [
        patch(
            "app.routers.resumes.extract_job_keywords",
            new_callable=AsyncMock,
            return_value=_JD_KEYWORDS,
        ),
        patch(
            "app.routers.resumes.generate_skill_target_plan",
            new_callable=AsyncMock,
            return_value={"accepted": [], "rejected": []},
        ),
        patch(
            "app.routers.resumes.verify_skill_target_plan",
            return_value={"accepted": [], "rejected": []},
        ),
        patch(
            "app.routers.resumes.get_matched_repos_for_job",
            new_callable=AsyncMock,
            return_value="",
        ),
        patch(
            "app.routers.resumes.generate_resume_diffs",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(changes=[], strategy_notes=""),
        ),
        patch(
            "app.routers.resumes.apply_diffs",
            return_value=(copy.deepcopy(original_data), [], []),
        ),
        patch("app.routers.resumes.verify_diff_result", return_value=[]),
        # Force the unrefined fallback path (handled gracefully by the router).
        patch(
            "app.routers.resumes.refine_resume",
            new_callable=AsyncMock,
            side_effect=RuntimeError("refinement disabled for test"),
        ),
        patch(
            "app.services.matched_projects.complete_json",
            new_callable=AsyncMock,
            return_value={"projects": mocked_projects},
        ),
    ]


class TestMatchedProjectsInPreview:
    async def test_preview_replaces_projects_section(
        self, isolated_db, sample_resume, monkeypatch
    ):
        monkeypatch.setattr(
            "app.services.matched_projects._llm_configured", lambda: True
        )
        resume_id, job_id, resume_data = await _seed_resume_and_job(
            isolated_db, sample_resume
        )
        await _seed_career_projects(isolated_db)

        with ExitStack() as stack:
            for stub in _preview_stubs(resume_data):
                stack.enter_context(stub)
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/resumes/improve/preview",
                    json={"resume_id": resume_id, "job_id": job_id},
                )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]

        projects = data["resume_preview"]["personalProjects"]
        assert [p["name"] for p in projects] == [
            "Docker Swarm Dashboard",
            "OpenAPI Generator",
        ], "Section must contain exactly the 2 JD-matched projects"
        assert projects[0]["description"] == _BULLETS["docker swarm dashboard"]
        assert projects[1]["description"] == _BULLETS["openapi generator"]
        assert projects[1]["github"] == "https://github.com/user/openapi-generator"
        assert all(
            p["descriptionStyles"] == ["bullet"] * len(p["description"])
            for p in projects
        )
        assert any(
            "Projects section replaced with 2 job-matched" in w
            for w in data["warnings"]
        )

        # The unmatched resume projects are dropped — visible as a project
        # removal in the preview diff (new entries are proven by the
        # resume_preview names above).
        change_types = [
            c["change_type"]
            for c in data["detailed_changes"]
            if c["field_type"] == "project"
        ]
        assert "removed" in change_types

    async def test_preview_leaves_projects_untouched_without_matches(
        self, isolated_db, sample_resume
    ):
        # No career projects seeded at all -> merge is a no-op.
        resume_id, job_id, resume_data = await _seed_resume_and_job(
            isolated_db, sample_resume
        )
        # JD keywords that cannot match anything.
        no_match_keywords = {
            "required_skills": [],
            "preferred_skills": [],
            "keywords": ["quantum-cryptography", "zumba"],
        }
        stubs = _preview_stubs(resume_data)
        stubs[0] = patch(
            "app.routers.resumes.extract_job_keywords",
            new_callable=AsyncMock,
            return_value=no_match_keywords,
        )
        with ExitStack() as stack:
            for stub in stubs:
                stack.enter_context(stub)
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/resumes/improve/preview",
                    json={"resume_id": resume_id, "job_id": job_id},
                )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["resume_preview"]["personalProjects"][0]["name"] == "Legacy App"
        assert not any(
            "Projects section replaced" in w for w in data["warnings"]
        )

    async def test_suggestions_endpoint_returns_pickable_projects(
        self, isolated_db, sample_resume, monkeypatch
    ):
        monkeypatch.setattr(
            "app.services.matched_projects._llm_configured", lambda: True
        )
        resume_id, job_id, resume_data = await _seed_resume_and_job(
            isolated_db, sample_resume
        )
        await _seed_career_projects(isolated_db)

        with ExitStack() as stack:
            for stub in _preview_stubs(resume_data):
                stack.enter_context(stub)
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/resumes/improve/projects-suggestions",
                    json={"resume_id": resume_id, "job_id": job_id},
                )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        projects = data["projects"]
        assert [p["name"] for p in projects] == [
            "Docker Swarm Dashboard",
            "OpenAPI Generator",
        ]
        assert projects[0]["score"] == 7
        assert projects[1]["score"] == 6
        assert all(p["already_in_resume"] is False for p in projects)
        assert projects[0]["description"] == _BULLETS["docker swarm dashboard"]
        assert projects[1]["description"] == _BULLETS["openapi generator"]
        assert projects[1]["github"] == "https://github.com/user/openapi-generator"

    async def test_suggestions_without_matches_returns_empty(
        self, isolated_db, sample_resume
    ):
        resume_id, job_id, resume_data = await _seed_resume_and_job(
            isolated_db, sample_resume
        )
        await _seed_career_projects(isolated_db)
        no_match_keywords = {
            "required_skills": [],
            "preferred_skills": [],
            "keywords": ["quantum-cryptography", "zumba"],
        }
        stubs = _preview_stubs(resume_data)
        stubs[0] = patch(
            "app.routers.resumes.extract_job_keywords",
            new_callable=AsyncMock,
            return_value=no_match_keywords,
        )
        with ExitStack() as stack:
            for stub in stubs:
                stack.enter_context(stub)
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/resumes/improve/projects-suggestions",
                    json={"resume_id": resume_id, "job_id": job_id},
                )
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["projects"] == []

    async def test_preview_uses_user_selected_projects(
        self, isolated_db, sample_resume, monkeypatch
    ):
        monkeypatch.setattr(
            "app.services.matched_projects._llm_configured", lambda: True
        )
        resume_id, job_id, resume_data = await _seed_resume_and_job(
            isolated_db, sample_resume
        )
        await _seed_career_projects(isolated_db)

        with ExitStack() as stack:
            for stub in _preview_stubs(
                resume_data,
                extra_bullets={"Chess Engine in C": _BULLETS["chess engine in c"]},
            ):
                stack.enter_context(stub)
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/resumes/improve/preview",
                    json={
                        "resume_id": resume_id,
                        "job_id": job_id,
                        "selected_projects": ["Chess Engine in C"],
                    },
                )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        projects = data["resume_preview"]["personalProjects"]
        assert [p["name"] for p in projects] == ["Chess Engine in C"]
        assert projects[0]["description"] == _BULLETS["chess engine in c"]
        assert any(
            "Projects section replaced with 1 job-matched" in w
            for w in data["warnings"]
        )

    async def test_preview_groups_and_trims_skills(
        self, isolated_db, sample_resume
    ):
        # sample_resume skills: Python, FastAPI, Docker, AWS, PostgreSQL, Redis.
        # JD terms: python / api / docker -> AWS, PostgreSQL, Redis are neither
        # JD-relevant nor evidenced anywhere in the resume text: they must be
        # trimmed and the survivors grouped by category.
        resume_id, job_id, resume_data = await _seed_resume_and_job(
            isolated_db, sample_resume
        )

        with ExitStack() as stack:
            for stub in _preview_stubs(resume_data):
                stack.enter_context(stub)
            async with _client() as client:
                resp = await client.post(
                    "/api/v1/resumes/improve/preview",
                    json={"resume_id": resume_id, "job_id": job_id},
                )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        additional = data["resume_preview"]["additional"]

        assert additional["technicalSkills"] == ["Python", "FastAPI", "Docker"]
        assert additional["skillGroups"] == [
            {"name": "Languages", "skills": ["Python"]},
            {"name": "Backend", "skills": ["FastAPI"]},
            {"name": "Cloud & DevOps", "skills": ["Docker"]},
        ]
        assert any(
            "Removed 3 skill(s) not relevant" in w
            and "AWS" in w
            and "PostgreSQL" in w
            and "Redis" in w
            for w in data["warnings"]
        )

        # The trim is visible in the preview diff as per-skill removals.
        skill_changes = [
            c
            for c in data["detailed_changes"]
            if c["field_path"] == "additional.technicalSkills"
        ]
        assert {c["original_value"] for c in skill_changes} == {
            "AWS",
            "PostgreSQL",
            "Redis",
        }
        assert all(c["change_type"] == "removed" for c in skill_changes)
