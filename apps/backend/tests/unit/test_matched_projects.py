"""Unit tests for JD-matched career projects (scoring, bullets, merge)."""

import copy
from unittest.mock import AsyncMock, patch

import pytest

from app.schemas.models import ResumeData
from app.services.matched_projects import (
    _MAX_BULLET_CHARS,
    _normalize_bullets_response,
    generate_project_bullets,
    merge_matched_projects,
    score_project,
    select_by_name,
    select_matched_projects,
    suggest_matched_projects,
)

_KEYWORDS = {
    "required_skills": ["Python", "Django"],
    "preferred_skills": ["PostgreSQL"],
    "keywords": ["api", "web"],
}


def _project(**overrides):
    project = {
        "project_id": "p1",
        "name": "Portfolio API",
        "role": "Backend Developer",
        "years": "2024",
        "github": "https://github.com/user/portfolio-api",
        "website": None,
        "description": ["Built a REST API with Django and PostgreSQL"],
        "languages": ["Python", "SQL"],
        "readme": "Serves 10k requests per day.",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }
    project.update(overrides)
    return project


def _resume_project(name, bullets):
    return {
        "id": 1,
        "name": name,
        "role": "Developer",
        "years": "2023",
        "github": None,
        "website": None,
        "description": bullets,
        "descriptionStyles": ["bullet"] * len(bullets),
    }


def _resume_data_with(projects):
    return {
        "personalInfo": {"fullName": "Jane Doe"},
        "summary": "Engineer",
        "workExperience": [],
        "education": [],
        "personalProjects": projects,
        "additional": {
            "technicalSkills": [],
            "languages": [],
            "certificationsTraining": [],
            "awards": [],
        },
        "sectionMeta": [],
        "customSections": {},
    }


class TestScoring:
    def test_scores_name_role_description_and_languages(self):
        terms = ["python", "api"]
        assert score_project(_project(), terms) > 0

    def test_name_weights_three(self):
        terms = ["portfolio"]
        assert score_project(_project(), terms) == 3

    def test_description_weights_two(self):
        terms = ["django"]
        assert score_project(_project(), terms) == 2

    def test_languages_weight_one(self):
        terms = ["redis"]
        project = _project(languages=["Redis"], description=["Built a REST API"])
        assert score_project(project, terms) == 1

    def test_readme_weight_one(self):
        assert score_project(_project(), ["requests"]) == 1

    def test_skills_field_weights_two(self):
        terms = ["fastapi"]
        project = _project(skills=["FastAPI"])
        assert score_project(project, terms) == 2

    def test_zero_when_no_term_hits(self):
        assert score_project(_project(), ["kubernetes", "terraform"]) == 0

    def test_empty_terms_returns_zero(self):
        assert score_project(_project(), []) == 0

    def test_non_dict_project_returns_zero(self):
        assert score_project(None, ["python"]) == 0


class TestSelection:
    def test_returns_matches_sorted_by_score(self):
        career = [
            _project(name="Portfolio API", description=["Built a Django API"]),
            _project(name="Unrelated Game", description=["A toy raytracer"], languages=["C"]),
        ]
        matched = select_matched_projects(career, [], _KEYWORDS)
        assert [m.project["name"] for m in matched] == ["Portfolio API"]

    def test_returns_top_two(self):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
            _project(name="API Three", description=["Flask web app"]),
        ]
        matched = select_matched_projects(career, [], _KEYWORDS)
        assert len(matched) == 2

    def test_respects_custom_max(self):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
            _project(name="API Three", description=["Flask web app"]),
        ]
        assert len(select_matched_projects(career, [], _KEYWORDS, max_suggested=3)) == 3

    def test_flags_already_in_resume_case_insensitively(self):
        career = [
            _project(name="Portfolio API", description=["Django API"]),
            _project(name="Not Listed", description=["Python CLI tool"]),
        ]
        resume = [_resume_project("portfolio api", ["old bullet"])]
        matched = select_matched_projects(career, resume, _KEYWORDS)
        by_name = {m.project["name"]: m for m in matched}
        assert by_name["Portfolio API"].already_in_resume is True
        assert by_name["Not Listed"].already_in_resume is False

    def test_empty_terms_returns_empty(self):
        assert select_matched_projects([_project()], [], {"keywords": []}) == []

    def test_no_matches_returns_empty(self):
        career = [
            _project(
                name="Unrelated Game",
                description=["A toy raytracer"],
                languages=["C"],
            )
        ]
        assert select_matched_projects(career, [], _KEYWORDS) == []


class TestSuggestions:
    def test_returns_top_five_with_scores(self):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
            _project(name="API Three", description=["Flask web app"]),
            _project(name="API Four", description=["Aiohttp web app"]),
            _project(name="API Five", description=["Pyramid web app"]),
            _project(name="API Six", description=["Tornado web app"]),
        ]
        suggestions = suggest_matched_projects(career, [], _KEYWORDS)
        assert len(suggestions) == 5
        names = [m.project["name"] for m, _score in suggestions]
        assert names == [f"API {word}" for word in ("One", "Two", "Three", "Four", "Five")]
        scores = [score for _m, score in suggestions]
        assert scores == sorted(scores, reverse=True)

    def test_honors_custom_limit(self):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
        ]
        assert len(suggest_matched_projects(career, [], _KEYWORDS, limit=1)) == 1

    def test_flags_already_in_resume_and_score_zero(self):
        career = [
            _project(name="Portfolio API", description=["Django API"]),
            _project(name="Not Listed", description=["Python CLI tool"]),
        ]
        resume = [_resume_project("portfolio api", ["old bullet"])]
        suggestions = suggest_matched_projects(career, resume, _KEYWORDS)
        by_name = {m.project["name"]: (m, s) for m, s in suggestions}
        match, score = by_name["Portfolio API"]
        assert match.already_in_resume is True
        assert score > 0

    def test_empty_terms_returns_empty(self):
        assert suggest_matched_projects([_project()], [], {"keywords": []}) == []

    def test_dedupes_casefolded_duplicate_names_keeping_highest_score(self):
        career = [
            _project(
                name="Portfolio API",
                description=["A Django REST API with API docs"],
                languages=["Python"],
            ),
            _project(
                name="portfolio api",
                description=["A Django REST API"],
                languages=["Python"],
            ),
            _project(
                name="API Two",
                description=["FastAPI web service"],
                languages=["Python"],
            ),
        ]
        suggestions = suggest_matched_projects(career, [], _KEYWORDS)
        assert len(suggestions) == 2
        assert suggestions[0][0].project["name"] == "Portfolio API"
        assert suggestions[1][0].project["name"] == "API Two"

    def test_no_matches_returns_empty(self):
        career = [
            _project(
                name="Unrelated Game",
                description=["A toy raytracer"],
                languages=["C"],
            )
        ]
        assert suggest_matched_projects(career, [], _KEYWORDS) == []


class TestSelectByName:
    def test_returns_chosen_projects_in_selection_order(self):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
            _project(name="API Three", description=["Flask web app"]),
        ]
        selected = select_by_name(
            career, [], ["API Three", "API One"]
        )
        assert [m.project["name"] for m in selected] == ["API Three", "API One"]

    def test_matches_case_insensitively_and_dedupes(self):
        career = [_project(name="Portfolio API", description=["Django API"])]
        selected = select_by_name(
            career, [], ["portfolio api", "PORTFOLIO API"]
        )
        assert len(selected) == 1

    def test_skips_unknown_names(self):
        career = [_project(name="API One", description=["Django API"])]
        selected = select_by_name(career, [], ["API One", "Ghost Project"])
        assert [m.project["name"] for m in selected] == ["API One"]

    def test_empty_selection_returns_empty(self):
        assert select_by_name([_project()], [], []) == []

    def test_caps_at_four(self):
        career = [
            _project(name=f"API {i}", description=["Django API"]) for i in range(6)
        ]
        selected = select_by_name(career, [], [p["name"] for p in career])
        assert len(selected) == 4

    def test_flags_already_in_resume(self):
        career = [_project(name="Portfolio API", description=["Django API"])]
        resume = [_resume_project("portfolio api", ["old bullet"])]
        selected = select_by_name(career, resume, ["Portfolio API"])
        assert selected[0].already_in_resume is True


class TestNormalizeBullets:
    def test_non_dict_raw_returns_empty(self):
        assert _normalize_bullets_response(None) == {}
        assert _normalize_bullets_response(["nope"]) == {}

    def test_missing_projects_key_returns_empty(self):
        assert _normalize_bullets_response({"other": []}) == {}

    def test_keeps_valid_entry(self):
        raw = {
            "projects": [
                {"name": "Portfolio API", "description": ["Resolved X by building Y, cutting Z"]}
            ]
        }
        assert _normalize_bullets_response(raw) == {
            "portfolio api": ["Resolved X by building Y, cutting Z"]
        }

    def test_drops_entries_without_name_or_list(self):
        raw = {
            "projects": [
                {"name": "", "description": ["A"]},
                {"name": "X", "description": "not a list"},
                {"name": "Y", "description": ["A", "B"]},
            ]
        }
        assert _normalize_bullets_response(raw) == {}

    def test_keeps_only_exactly_one_bullet(self):
        # The description must be a single phrase: 2+ bullets means the entry
        # is malformed and must not reach the resume.
        assert _normalize_bullets_response(
            {"projects": [{"name": "X", "description": []}]}
        ) == {}
        assert _normalize_bullets_response(
            {"projects": [{"name": "X", "description": ["1", "2"]}]}
        ) == {}
        assert _normalize_bullets_response(
            {"projects": [{"name": "X", "description": ["1"]}]}
        ) == {"x": ["1"]}

    def test_dedupes_and_truncates_overlong_and_drops_blank_bullets(self):
        # Overlong rows are truncated at the last word boundary, never
        # dropped — losing the phrase would silently remove the project.
        # (Blanks are dropped, duplicates de-duped, and the exact-1 rule
        # still applies: "the phrase" + the truncated row would be 2.)
        raw = {
            "projects": [
                {
                    "name": "X",
                    "description": [
                        "the phrase",
                        "the phrase",
                        "   ",
                        "word " * 80,
                    ],
                }
            ]
        }
        truncated = "word " * 59 + "word"
        assert len(truncated) <= _MAX_BULLET_CHARS
        # "the phrase" + the truncated row would be 2 bullets -> entry dropped.
        assert _normalize_bullets_response(raw) == {}
        # A single overlong row alone is truncated and kept, never dropped —
        # losing the phrase would silently remove the project.
        assert _normalize_bullets_response(
            {"projects": [{"name": "X", "description": ["word " * 80]}]}
        ) == {"x": [truncated]}

    def test_truncation_never_splits_words(self):
        from app.services.matched_projects import _truncate_bullet

        assert _truncate_bullet("short", 10) == "short"
        cut = _truncate_bullet("alpha beta gamma delta", 12)
        assert cut == "alpha beta"
        assert len(cut) <= 12
        assert _truncate_bullet("x" * 50, 10) == "x" * 10


class TestGenerateBullets:
    async def test_returns_empty_when_llm_off(self, monkeypatch):
        monkeypatch.setattr("app.services.matched_projects._llm_configured", lambda: False)
        assert await generate_project_bullets([_project()], _KEYWORDS) == {}

    async def test_returns_empty_for_no_projects(self, monkeypatch):
        monkeypatch.setattr("app.services.matched_projects._llm_configured", lambda: True)
        assert await generate_project_bullets([], _KEYWORDS) == {}

    async def test_calls_complete_json_and_normalizes(self, monkeypatch):
        monkeypatch.setattr("app.services.matched_projects._llm_configured", lambda: True)
        payload = {
            "projects": [
                {"name": "Portfolio API", "description": ["Resolved X by building Y, cutting Z"]}
            ]
        }
        with patch(
            "app.services.matched_projects.complete_json",
            new=AsyncMock(return_value=payload),
        ) as mock_llm:
            result = await generate_project_bullets([_project()], _KEYWORDS, language="fr")
        assert result == {"portfolio api": ["Resolved X by building Y, cutting Z"]}
        kwargs = mock_llm.await_args.kwargs
        prompt = mock_llm.await_args.args[0]
        assert kwargs["schema_type"] == "project_bullets"
        assert "Portfolio API" in prompt
        assert "French" in prompt

    def test_prompt_enforces_single_phrase_with_psr_flow(self):
        from app.prompts import MATCHED_PROJECTS_PROMPT

        assert "exactly 1 bullet" in MATCHED_PROJECTS_PROMPT
        assert "SINGLE concise phrase" in MATCHED_PROJECTS_PROMPT
        assert "Problem -> Solution -> Result" in MATCHED_PROJECTS_PROMPT
        for verb in ("Resolved", "Built", "Delivered"):
            assert verb in MATCHED_PROJECTS_PROMPT
        assert '"description": ["the single Problem -> Solution -> Result phrase"]' in (
            MATCHED_PROJECTS_PROMPT
        )

    def test_diff_prompt_summary_follows_c_what_formula(self):
        from app.prompts import DIFF_IMPROVE_PROMPT

        assert "C-WHAT formula" in DIFF_IMPROVE_PROMPT
        assert "WHO = the candidate's professional identity" in DIFF_IMPROVE_PROMPT
        assert "WHAT = their specialization" in DIFF_IMPROVE_PROMPT
        assert "RESULT = measurable impact" in DIFF_IMPROVE_PROMPT
        assert "HOW = the technologies and methodologies" in DIFF_IMPROVE_PROMPT

    async def test_language_code_none_falls_back_to_content_language(self, monkeypatch):
        monkeypatch.setattr("app.services.matched_projects._llm_configured", lambda: True)
        with patch(
            "app.services.matched_projects.complete_json",
            new=AsyncMock(return_value={"projects": []}),
        ) as mock_llm:
            result = await generate_project_bullets([_project()], _KEYWORDS)
        assert result == {}
        assert mock_llm.await_count == 1


def _bullets_for(names_and_bullets):
    return {
        name.casefold(): bullets
        for name, bullets in names_and_bullets
    }


class TestMerge:
    async def test_replaces_section_with_matched_projects(self, monkeypatch):
        career = [
            _project(
                name="Portfolio API",
                description=["Built a Django API"],
                readme="Now serves 50k requests.",
            ),
            _project(
                name="Not Listed",
                description=["Python CLI tool"],
                languages=["Python"],
            ),
            _project(
                name="Unrelated Game",
                description=["A toy raytracer"],
                languages=["C"],
            ),
        ]
        improved = _resume_data_with([_resume_project("Portfolio API", ["old bullet"])])
        generated = _bullets_for(
            [
                ("Portfolio API", ["Resolved X by building Y, cutting Z"]),
                ("Not Listed", ["Resolved A by building B, shipping C"]),
            ]
        )
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(return_value=generated),
        ) as mock_gen:
            result, warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        assert mock_gen.await_count == 1
        projects = result["personalProjects"]
        assert [p["name"] for p in projects] == ["Portfolio API", "Not Listed"]
        assert projects[0]["description"] == ["Resolved X by building Y, cutting Z"]
        assert projects[0]["github"] == "https://github.com/user/portfolio-api"
        assert projects[1]["id"] == 0
        assert all(
            p["descriptionStyles"] == ["bullet"] * len(p["description"])
            for p in projects
        )
        assert any("replaced with 2 job-matched" in w for w in warnings)

    async def test_keeps_existing_bullets_when_llm_off(self, monkeypatch):
        career = [
            _project(name="Portfolio API", description=["Existing bullet"]),
            _project(name="Not Listed", description=["New match bullet"], languages=["Python"]),
        ]
        improved = _resume_data_with([_resume_project("Portfolio API", ["Existing bullet"])])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(return_value={}),
        ):
            result, _warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        projects = result["personalProjects"]
        # In-resume match keeps its existing bullets; never-listed match is
        # skipped because it has nothing safe to show.
        assert [p["name"] for p in projects] == ["Portfolio API"]
        assert projects[0]["description"] == ["Existing bullet"]

    async def test_generation_failure_is_noop_safe(self, monkeypatch):
        career = [_project(name="Portfolio API", description=["Existing bullet"])]
        improved = _resume_data_with([_resume_project("Portfolio API", ["Existing bullet"])])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            result, _warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        assert result["personalProjects"][0]["description"] == ["Existing bullet"]

    async def test_no_matches_returns_data_unchanged(self):
        career = [
            _project(
                name="Unrelated Game",
                description=["A toy raytracer"],
                languages=["C"],
            )
        ]
        improved = _resume_data_with([_resume_project("Portfolio API", ["old"])])
        result, warnings = await merge_matched_projects(
            original_data=improved,
            improved_data=improved,
            career_projects=career,
            job_keywords=_KEYWORDS,
        )
        assert result is improved
        assert warnings == []

    async def test_empty_career_projects_returns_data_unchanged(self):
        improved = _resume_data_with([_resume_project("Portfolio API", ["old"])])
        result, warnings = await merge_matched_projects(
            original_data=improved,
            improved_data=improved,
            career_projects=[],
            job_keywords=_KEYWORDS,
        )
        assert result is improved
        assert warnings == []

    async def test_non_dict_improved_data_returns_data_unchanged(self):
        result, _warnings = await merge_matched_projects(
            original_data=None,
            improved_data="not a dict",
            career_projects=[_project()],
            job_keywords=_KEYWORDS,
        )
        assert result == "not a dict"

    async def test_enforces_max_two_suggested(self, monkeypatch):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
            _project(name="API Three", description=["Flask web app"]),
        ]
        improved = _resume_data_with([])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(
                return_value=_bullets_for(
                    [
                        ("API One", ["Resolved P by building S, with R"]),
                        ("API Two", ["Resolved P by building S, with R"]),
                        ("API Three", ["Resolved P by building S, with R"]),
                    ]
                )
            ),
        ):
            result, _warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        assert len(result["personalProjects"]) == 2

    async def test_uses_user_selection_when_provided(self, monkeypatch):
        career = [
            _project(name="API One", description=["Django API"]),
            _project(name="API Two", description=["FastAPI web service"]),
            _project(name="API Three", description=["Flask web app"]),
        ]
        improved = _resume_data_with([])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(
                return_value=_bullets_for(
                    [("API Three", ["Resolved P by building S, cutting R"])]
                )
            ),
        ) as mock_gen:
            result, warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
                selected_names=["API Three"],
            )
        # The user's pick wins over the auto top-2.
        assert [p["name"] for p in result["personalProjects"]] == ["API Three"]
        assert result["personalProjects"][0]["description"] == [
            "Resolved P by building S, cutting R"
        ]
        assert any("replaced with 1 job-matched" in w for w in warnings)
        assert mock_gen.await_count == 1

    async def test_user_selection_skips_unknown_names(self, monkeypatch):
        career = [_project(name="API One", description=["Django API"])]
        improved = _resume_data_with([])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(
                return_value=_bullets_for([("API One", ["Resolved P by building S, with R"])])
            ),
        ):
            result, _warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
                selected_names=["Ghost Project", "API One"],
            )
        assert [p["name"] for p in result["personalProjects"]] == ["API One"]

    async def test_user_selection_unknown_only_is_noop(self):
        career = [_project(name="API One", description=["Django API"])]
        improved = _resume_data_with([_resume_project("API One", ["old"])])
        result, warnings = await merge_matched_projects(
            original_data=improved,
            improved_data=improved,
            career_projects=career,
            job_keywords=_KEYWORDS,
            selected_names=["Ghost Project"],
        )
        assert result is improved
        assert warnings == []

    async def test_warns_about_invented_metrics(self, monkeypatch):
        career = [_project(name="Portfolio API", readme="no numbers here")]
        improved = _resume_data_with([])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(
                return_value=_bullets_for(
                    [
                        (
                            "Portfolio API",
                            ["Resolved X with 99% fewer errors by building Y"],
                        )
                    ]
                )
            ),
        ):
            result, warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        assert "99%" in result["personalProjects"][0]["description"][0]
        assert any("Possible invented metric" in w and "99%" in w for w in warnings)

    async def test_no_metric_warning_when_metric_in_evidence(self, monkeypatch):
        career = [_project(name="Portfolio API", readme="cut error rate by 99%")]
        improved = _resume_data_with([])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(
                return_value=_bullets_for(
                    [
                        ("Portfolio API", ["Cut error rate by 99% by building Y"])
                    ]
                )
            ),
        ):
            _result, warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        assert not any("Possible invented metric" in w for w in warnings)

    async def test_output_validates_against_resume_schema(self, monkeypatch):
        career = [_project(name="Portfolio API", description=["Django API"])]
        improved = _resume_data_with([_resume_project("Portfolio API", ["old"])])
        with patch(
            "app.services.matched_projects.generate_project_bullets",
            new=AsyncMock(
                return_value=_bullets_for(
                    [("Portfolio API", ["Resolved X by building Y, cutting Z"])]
                )
            ),
        ):
            result, _warnings = await merge_matched_projects(
                original_data=improved,
                improved_data=copy.deepcopy(improved),
                career_projects=career,
                job_keywords=_KEYWORDS,
            )
        validated = ResumeData.model_validate(result)
        assert [p.name for p in validated.personalProjects] == ["Portfolio API"]
        assert validated.personalProjects[0].descriptionStyles == ["bullet"] * 1
