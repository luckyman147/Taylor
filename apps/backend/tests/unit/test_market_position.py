"""Unit tests for the deterministic market-position model.

Covers the pure math: composite skill scoring (with renormalized weights),
the score -> percentile mapping, recency and years parsing, certification
boosts, domain aggregation (skills + role-title years + projects), the
current-role / specialization / recommended-roles derivation and the verdict
templates. No LLM involved.
"""

import pytest

from app.services.market_position import (
    _cert_matches,
    _domain_percentile,
    _entry_years,
    _interpolate,
    _project_matches,
    _recency_score,
    _score_to_percentile,
    _skill_composite,
    compute_market_position,
)


class TestInterpolation:
    def test_midpoint_of_curve(self):
        assert _interpolate([(0, 5), (50, 50), (100, 99)], 50) == 50

    def test_clamps_below_and_above(self):
        curve = [(0, 5), (50, 50), (100, 99)]
        assert _interpolate(curve, -10) == 5
        assert _interpolate(curve, 250) == 99

    def test_linear_between_points(self):
        assert _interpolate([(0, 0), (10, 100)], 5) == 50


class TestRecencyScore:
    def test_fresh_is_full_marks(self):
        assert _recency_score("2026", 2026) == 100
        assert _recency_score("2025", 2026) == 100

    def test_stale_drops(self):
        assert _recency_score("2023", 2026) == 60
        assert _recency_score("2020", 2026) == 10

    def test_unparseable_returns_none(self):
        assert _recency_score("nope", 2026) is None
        assert _recency_score("1800", 2026) is None
        assert _recency_score("", 2026) is None


class TestCertMatches:
    def test_cert_mentioning_skill(self):
        assert _cert_matches("AWS", ["AWS Certified Solutions Architect"])
        assert _cert_matches("Kubernetes", ["CKA (Kubernetes Administrator)"])

    def test_unrelated_cert_does_not_match(self):
        assert not _cert_matches("AWS", ["CKA"])
        assert not _cert_matches("AWS", [])


class TestProjectMatches:
    def test_matches_across_name_and_languages(self):
        project = {
            "name": "React portfolio",
            "description": ["Built a dashboard UI"],
            "languages": ["JavaScript", "TypeScript"],
        }
        assert _project_matches(project, ["react", "vue"])
        assert _project_matches(project, ["ui"])
        assert not _project_matches(project, ["backend", "api"])

    def test_readme_preview_counts(self):
        project = {"name": "Tool", "readme": "A small data pipeline with Spark"}
        assert _project_matches(project, ["spark"])
        assert not _project_matches(project, ["kubernetes"])


class TestSkillComposite:
    def test_strong_skill_scores_high(self):
        skill = {"name": "Python", "proficiency": 4, "years_experience": 3, "last_used": "2026"}
        assert _skill_composite(skill, [], 2026) == 70.0

    def test_missing_fields_renormalize_weights(self):
        # Proficiency alone: weight 0.4 over (0.4 + 0.1 certs).
        assert _skill_composite({"name": "Python", "proficiency": 4}, [], 2026) == 64.0

    def test_no_evidence_returns_none(self):
        assert _skill_composite({"name": "Python"}, [], 2026) is None

    def test_certification_boosts_score(self):
        skill = {"name": "AWS", "proficiency": 3, "years_experience": 2, "last_used": "2025"}
        without = _skill_composite(skill, [], 2026)
        with_cert = _skill_composite(skill, ["AWS Certified Solutions Architect"], 2026)
        assert with_cert > without


class TestPercentileMapping:
    def test_mid_score_maps_to_mid_percentile(self):
        assert _score_to_percentile(50) == 50

    def test_monotonic_increasing(self):
        low = _score_to_percentile(20)
        mid = _score_to_percentile(60)
        high = _score_to_percentile(90)
        assert low < mid < high
        assert 0 < low < high < 100


class TestEntryYears:
    def test_year_range(self):
        assert _entry_years({"years": "2019 - 2023"}, 2026) == 4.0
        assert _entry_years({"years": "2019–2023"}, 2026) == 4.0

    def test_duration_in_words(self):
        assert _entry_years({"years": "3 years"}, 2026) == 3.0

    def test_present_year_uses_current_year(self):
        assert _entry_years({"years": "2020 - Present"}, 2026) == 6.0

    def test_missing_or_unparseable_defaults_to_one(self):
        assert _entry_years({}, 2026) == 1.0
        assert _entry_years({"years": "somewhere"}, 2026) == 1.0


class TestDomainPercentile:
    def test_blends_skills_and_experience(self):
        assert _domain_percentile(78.0, 67.5, True) == 75

    def test_title_only_gets_partial_credit(self):
        assert _domain_percentile(None, 67.5, True) == 47

    def test_no_evidence_is_none(self):
        assert _domain_percentile(None, 5, False) is None


class TestComputeMarketPosition:
    def test_full_profile_produces_ranked_skills_and_domains(self):
        result = compute_market_position(
            skills=[
                {"name": "Python", "proficiency": 4, "years_experience": 3, "last_used": "2026"},
                {"name": "Kubernetes", "proficiency": 2, "years_experience": 1, "last_used": "2023"},
                {"name": "React", "proficiency": 3, "years_experience": 2, "last_used": "2025"},
            ],
            certifications=[],
            work_experience=[{"role": "Backend Engineer", "years": "2019 - 2023"}],
            current_year=2026,
        )

        assert [s["skill"] for s in result["skills"]] == ["Python", "React", "Kubernetes"]
        python = result["skills"][0]
        assert python["percentile"] == 78
        assert python["level"] == "advanced"
        assert result["skills"][2]["level"] == "beginner"

        domains = {d["domain"]: d for d in result["domains"]}
        assert domains["Backend"]["percentile"] == 68
        assert domains["Backend"]["readiness"] == "adequate"
        assert domains["Backend"]["seniority"] == "mid"
        assert domains["Frontend"]["percentile"] == 44
        assert domains["Cloud & DevOps"]["percentile"] == 20
        assert domains["Cloud & DevOps"]["readiness"] == "underqualified"
        assert domains["System Design"]["percentile"] == 20
        assert "Data & ML" not in domains, "Domains without any evidence are omitted"
        assert result["note"] is None

    def test_full_profile_identifies_current_role_and_specialization(self):
        result = compute_market_position(
            skills=[
                {"name": "Python", "proficiency": 4, "years_experience": 3, "last_used": "2026"},
                {"name": "Kubernetes", "proficiency": 2, "years_experience": 1, "last_used": "2023"},
                {"name": "React", "proficiency": 3, "years_experience": 2, "last_used": "2025"},
            ],
            certifications=[],
            work_experience=[{"role": "Backend Engineer", "years": "2019 - 2023"}],
            current_year=2026,
        )
        assert result["current_role"] == "Mid Backend Engineer"
        assert result["specialization"] == ["Python"]

    def test_full_profile_recommends_best_fit_roles(self):
        result = compute_market_position(
            skills=[
                {"name": "Python", "proficiency": 4, "years_experience": 3, "last_used": "2026"},
                {"name": "React", "proficiency": 3, "years_experience": 2, "last_used": "2025"},
                {"name": "Kubernetes", "proficiency": 2, "years_experience": 1, "last_used": "2023"},
            ],
            certifications=[],
            work_experience=[{"role": "Backend Engineer", "years": "2019 - 2023"}],
            current_year=2026,
        )
        roles = result["recommended_roles"]
        assert len(roles) == 5
        assert [row["role"] for row in roles] == [
            "Python Developer",
            "React Developer",
            "API Developer",
            "Backend Engineer",
            "Database Engineer",
        ]
        top = roles[0]
        assert top["domain"] == "Backend"
        assert top["seniority"] == "mid"
        assert top["match_score"] == 76
        assert top["reason"] == "Matches your Python"
        assert roles[1]["reason"] == "Matches your React"
        assert all(0 <= row["match_score"] <= 100 for row in roles)

    def test_verdict_names_role_then_strong_then_gates_then_picks(self):
        result = compute_market_position(
            skills=[
                {"name": "Python", "proficiency": 3, "years_experience": 3, "last_used": "2026"},
                {"name": "Kubernetes", "proficiency": 1},
            ],
            certifications=[],
            work_experience=[{"role": "Backend Engineer", "years": "2019 - 2023"}],
            current_year=2026,
        )
        verdict = result["verdict"]
        assert verdict.startswith("You're a Mid Backend Engineer specializing in Python.")
        assert "You're strong for Junior/Mid Backend roles" in verdict
        assert "You're underqualified for Senior roles requiring" in verdict
        assert "Kubernetes" in verdict
        assert "Best next picks: Python Developer" in verdict

    def test_verdict_only_underqualified_when_nothing_strong(self):
        result = compute_market_position(
            skills=[{"name": "Kubernetes", "proficiency": 1}],
            certifications=[],
            work_experience=[],
            current_year=2026,
        )
        assert result["current_role"] == "Junior DevOps Engineer"
        assert result["specialization"] == []
        assert result["recommended_roles"] == []
        assert "You're underqualified for Senior roles requiring" in result["verdict"]

    def test_verdict_adequate_profile_gets_position_and_picks(self):
        result = compute_market_position(
            skills=[{"name": "Python", "proficiency": 2, "years_experience": 3, "last_used": "2026"}],
            certifications=[],
            work_experience=[{"role": "Backend Engineer", "years": "2019 - 2023"}],
            current_year=2026,
        )
        assert result["current_role"] == "Mid Backend Engineer"
        assert "Best next picks:" in result["verdict"]
        assert "underqualified" not in result["verdict"]

    def test_projects_only_identifies_role(self):
        result = compute_market_position(
            skills=[],
            certifications=[],
            work_experience=[],
            projects=[
                {
                    "name": "React portfolio",
                    "description": ["Built a dashboard UI"],
                    "languages": ["JavaScript", "TypeScript"],
                }
            ],
            current_year=2026,
        )
        domains = {d["domain"]: d for d in result["domains"]}
        assert domains["Frontend"]["percentile"] == 10
        assert result["current_role"] == "Junior Frontend Developer"
        assert result["specialization"] == []

    def test_projects_boost_domain_percentile(self):
        result = compute_market_position(
            skills=[
                {"name": "Python", "proficiency": 4, "years_experience": 3, "last_used": "2026"},
            ],
            certifications=[],
            work_experience=[{"role": "Backend Engineer", "years": "2019 - 2023"}],
            projects=[
                {
                    "name": "FastAPI microservice",
                    "description": ["Deployed with Kubernetes"],
                    "languages": ["Python"],
                }
            ],
            current_year=2026,
        )
        backend = next(row for row in result["domains"] if row["domain"] == "Backend")
        assert backend["percentile"] == 71
        assert backend["seniority"] == "senior"

    def test_empty_profile_has_note_and_developing_verdict(self):
        result = compute_market_position([], [], [], current_year=2026)
        assert result["skills"] == []
        assert result["domains"] == []
        assert result["current_role"] is None
        assert result["specialization"] == []
        assert result["recommended_roles"] == []
        assert result["note"]
        assert "developing" in result["verdict"]

    def test_skills_capped_at_max(self):
        many = [
            {"name": f"Skill-{i}", "proficiency": 4, "years_experience": 2, "last_used": "2026"}
            for i in range(20)
        ]
        result = compute_market_position(many, [], [], current_year=2026)
        assert len(result["skills"]) == 12

    def test_skill_without_evidence_is_excluded(self):
        result = compute_market_position(
            skills=[{"name": "Python"}, {"name": "React", "proficiency": 3, "last_used": "2025"}],
            certifications=[],
            work_experience=[],
            current_year=2026,
        )
        names = [row["skill"] for row in result["skills"]]
        assert names == ["React"]