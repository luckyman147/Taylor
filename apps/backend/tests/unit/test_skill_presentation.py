"""Unit tests for the deterministic skill-presentation step."""

import copy

import pytest

from app.schemas.models import ResumeData
from app.services.skill_presentation import (
    _category_for,
    _jd_relevant,
    _keyword_terms,
    _norm,
    trim_and_group_skills,
)


_KEYWORDS = {
    "required_skills": ["Python", "React"],
    "preferred_skills": ["Docker"],
    "keywords": ["api", "typescript"],
}


def _resume(skills: list[str], summary: str = "") -> dict:
    return {
        "summary": summary or "Software engineer building web apps",
        "workExperience": [
            {
                "title": "Engineer",
                "company": "Acme",
                "description": ["Built React dashboards with Python backends"],
            }
        ],
        "personalProjects": [
            {"name": "Portal", "description": ["Dockerized microservices"]}
        ],
        "additional": {"technicalSkills": skills},
    }


class TestNormalize:
    def test_norm_unifies_case_and_separators(self):
        assert _norm("Next.js") == _norm("nextjs") == _norm("Next JS")
        assert _norm("C#") == "c"
        assert _norm("React") == "react"

    def test_keyword_terms_dedupe_casefolded(self):
        terms = _keyword_terms(
            {
                "required_skills": ["Python", "PYTHON"],
                "preferred_skills": ["docker"],
                "keywords": ["API", "API"],
            }
        )
        assert terms == ["python", "docker", "api"]


class TestJdRelevance:
    def test_exact_and_substring_matches(self):
        assert _jd_relevant("Python", _keyword_terms(_KEYWORDS))
        assert _jd_relevant("React Native", _keyword_terms(_KEYWORDS))
        assert not _jd_relevant("Next.js", _keyword_terms(_KEYWORDS))
        assert not _jd_relevant("Angular", _keyword_terms(_KEYWORDS))
        assert not _jd_relevant("", _keyword_terms(_KEYWORDS))

    def test_no_terms_is_never_relevant(self):
        assert not _jd_relevant("Python", [])


class TestCategories:
    def test_known_skills_map_to_expected_categories(self):
        assert _category_for("TypeScript") == "Languages"
        assert _category_for("Next.js") == "Frontend"
        assert _category_for("FastAPI") == "Backend"
        assert _category_for("PostgreSQL") == "Databases"
        assert _category_for("GitHub Actions") == "Cloud & DevOps"
        assert _category_for("Clean Architecture") == "Architecture"
        assert _category_for("RAG") == "AI/LLM"
        assert _category_for("Git") == "Tools"

    def test_unknown_skill_falls_back_to_tools(self):
        assert _category_for("Blender") == "Tools"

    def test_aliases_unify(self):
        assert _category_for("Golang") == "Languages"
        assert _category_for("K8s") == "Cloud & DevOps"

    def test_variant_containment_matches_real_world_skill_names(self):
        assert _category_for("REST APIs") == "Backend"
        assert _category_for("RESTful APIs") == "Backend"
        assert _category_for(".NET / ASP.NET Core") == "Backend"
        assert _category_for(".NET Framework") == "Backend"
        assert _category_for("RxJS") == "Frontend"
        assert _category_for("React Testing Library") == "Frontend"
        assert _category_for("AWS Lambda") == "Cloud & DevOps"
        assert _category_for("SQL Server") == "Databases"
        assert _category_for("Data Science") == "AI/LLM"
        assert _category_for("Scrum") == "Tools"
        assert _category_for("Testing Frameworks") == "Tools"

    def test_short_aliases_never_swallow_unrelated_skills(self):
        assert _category_for("Clean Code") == "Tools"
        assert _category_for("C# programming") == "Tools"
        assert _category_for("SOLID principles") == "Architecture"
        assert _category_for("Cloudflare") == "Tools"


class TestTrimAndGroup:
    def test_keeps_jd_skills_drops_irrelevant_ones(self):
        resume = _resume(["Python", "React", "Angular", "Kubernetes", "Blender", "Docker"])
        result, warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result["additional"]["technicalSkills"] == ["Python", "React", "Docker"]
        assert any(
            "Removed 3 skill" in w
            and "Angular" in w
            and "Kubernetes" in w
            and "Blender" in w
            for w in warnings
        )

    def test_evidence_only_skill_is_kept(self):
        resume = _resume(
            ["Angular", "Blender"], summary="Angular dashboards for retail"
        )
        result, warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result["additional"]["technicalSkills"] == ["Angular"]
        assert any("Removed 1 skill" in w and "Blender" in w for w in warnings)

    def test_jd_kept_first_then_evidence_in_list_order(self):
        resume = _resume(
            ["Blender", "Angular", "Python"], summary="Angular dashboards"
        )
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result["additional"]["technicalSkills"] == ["Python", "Angular"]

    def test_groups_follow_catalog_order(self):
        resume = _resume(
            ["Git", "Python", "React", "PostgreSQL", "Docker"],
            summary="Python and PostgreSQL backed Git-driven workflows",
        )
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        groups = result["additional"]["skillGroups"]
        names = [g["name"] for g in groups]
        assert names == [
            "Languages",
            "Frontend",
            "Databases",
            "Cloud & DevOps",
            "Tools",
        ]
        by_name = {g["name"]: g["skills"] for g in groups}
        assert by_name["Languages"] == ["Python"]
        assert by_name["Frontend"] == ["React"]
        assert by_name["Cloud & DevOps"] == ["Docker"]
        assert by_name["Tools"] == ["Git"]

    def test_unknown_skill_lands_in_tools_group(self):
        resume = _resume(["Python", "Blender", "React"], summary="Blender 3D models")
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        by_name = {g["name"]: g["skills"] for g in result["additional"]["skillGroups"]}
        assert by_name["Tools"] == ["Blender"]

    def test_cap_limits_kept_skills(self):
        skills = [f"Skill{i}" for i in range(1, 26)]
        resume = _resume(skills, summary=" ".join(skills))
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert len(result["additional"]["technicalSkills"]) <= 24

    def test_noop_without_jd_terms(self):
        resume = _resume(["Python"])
        result, warnings = trim_and_group_skills(resume, {})
        assert result is resume
        assert warnings == []

    def test_noop_without_skills(self):
        resume = _resume([])
        result, warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result is resume
        assert warnings == []

    def test_noop_on_non_dict(self):
        result, warnings = trim_and_group_skills(None, _KEYWORDS)
        assert result is None
        assert warnings == []

    def test_noop_when_everything_would_be_dropped(self):
        resume = _resume(["Blender"])
        result, warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result is resume
        assert any("not trimmed" in w for w in warnings)

    def test_splits_comma_joined_legacy_items_before_trimming(self):
        resume = _resume(
            ["Python, React, Docker", "Angular, Blender"],
            summary="Python backends, React dashboards, Dockerized services",
        )
        result, warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result["additional"]["technicalSkills"] == ["Python", "React", "Docker"]
        assert any("Removed 2 skill" in w and "Angular" in w and "Blender" in w for w in warnings)
        by_name = {g["name"]: g["skills"] for g in result["additional"]["skillGroups"]}
        assert by_name["Languages"] == ["Python"]
        assert by_name["Frontend"] == ["React"]
        assert by_name["Cloud & DevOps"] == ["Docker"]

    def test_splits_preserve_parenthesized_commas(self):
        resume = _resume(["Python (Django, FastAPI), Blender"], summary="x")
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert "Python (Django, FastAPI)" in result["additional"]["technicalSkills"]
        assert "Blender" not in result["additional"]["technicalSkills"]

    def test_splits_dedupe_across_items_and_entries(self):
        resume = _resume(
            ["Python, Python", "python", "Python , React"], summary="Python apps"
        )
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert result["additional"]["technicalSkills"] == ["Python", "React"]

    def test_does_not_mutate_input(self):
        resume = _resume(["Python", "Blender"])
        snapshot = copy.deepcopy(resume)
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        assert resume == snapshot
        assert result is not resume

    def test_output_validates_against_resume_schema(self):
        resume = _resume(["Python", "React", "Docker", "Git"])
        resume.update(
            {
                "personalInfo": {
                    "name": "A",
                    "title": "Engineer",
                    "email": "a@b.c",
                    "phone": "",
                    "location": "",
                },
                "education": [],
                "sectionMeta": [],
                "customSections": {},
            }
        )
        result, _warnings = trim_and_group_skills(resume, _KEYWORDS)
        validated = ResumeData.model_validate(result)
        assert validated.additional.technicalSkills == ["Python", "React", "Docker"]
        groups = validated.additional.skillGroups
        assert {g.name for g in groups} == {
            "Languages",
            "Frontend",
            "Cloud & DevOps",
        }
