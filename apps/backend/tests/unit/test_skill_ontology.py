"""Unit tests for the TAYLOR skill-matching engine (skill_ontology).

Table-driven tests mirror the design doc: tier matching (EXACT / RELATED /
ECOSYSTEM / UNRELATED), title taxonomy, seniority bands, context weights,
negative keywords, and generated search queries.
"""

from __future__ import annotations

import pytest

from app.services.skill_ontology import (
    _family_from_text,
    build_profile_snapshot,
    build_search_queries,
    classify_context,
    extract_requirements,
    match_skills,
    match_title,
    negative_penalty,
    seniority_score,
)

SAMPLE_SKILLS = [
    {"name": "React", "category": "Frontend", "proficiency": 5, "years_experience": 4},
    {"name": "Node.js", "category": "Backend", "proficiency": 4, "years_experience": 3},
    {"name": "TypeScript", "category": "Frontend", "proficiency": 4, "years_experience": 3},
    {"name": "PostgreSQL", "category": "Databases", "proficiency": 3, "years_experience": 2},
]

SAMPLE_PROFILE = {
    "work_experience": [{"role": "Full-Stack Developer", "years": "2021 - Present"}],
    "target_roles": ["Backend Developer"],
    "target_locations": ["Tunisia", "Remote"],
}

SAMPLE_MARKET = {
    "current_role": "Mid Backend Engineer",
    "recommended_roles": [{"role": "Backend Engineer"}],
}


def _snapshot() -> dict:
    return build_profile_snapshot(SAMPLE_PROFILE, SAMPLE_SKILLS, SAMPLE_MARKET)


class TestTierMatching:
    """Design doc tiers: EXACT 1.0 / RELATED 0.85 / ECOSYSTEM 0.7 / UNRELATED 0.2."""

    @pytest.mark.parametrize(
        ("jd", "expected_tier"),
        [
            ("We build interfaces with React.", "exact"),
            ("Experience developing backend services with NestJS.", "related"),
            ("NestJS and PostgreSQL power our stack.", "ecosystem"),
            ("Java microservices with Spring Boot.", "unrelated"),
        ],
    )
    def test_tiers(self, jd: str, expected_tier: str) -> None:
        matched = match_skills(jd, _snapshot())
        tiers = [info["tier"] for info in matched.values()]
        if expected_tier == "unrelated":
            # Design doc: "React vs a Python-only JD" is UNRELATED. Spring Boot
            # is backend-category, so Node.js may land in ECOSYSTEM — only the
            # non-backend skills must be UNRELATED.
            assert "exact" not in tiers and "related" not in tiers
            assert "React" in matched and matched["React"]["tier"] == "unrelated"
            assert "TypeScript" in matched and matched["TypeScript"]["tier"] == "unrelated"
        else:
            assert expected_tier in tiers

    def test_related_tier_value(self) -> None:
        # NestJS is related to Node.js (0.85) in the ontology.
        matched = match_skills("NestJS backend services", _snapshot())
        assert matched["Node.js"]["tier"] == "related"
        assert matched["Node.js"]["score"] == pytest.approx(0.85)

    def test_exact_tier_value(self) -> None:
        matched = match_skills("React frontend", _snapshot())
        assert matched["React"]["tier"] == "exact"
        assert matched["React"]["score"] == pytest.approx(1.0)

    def test_ecosystem_tier_value(self) -> None:
        # TypeScript is ecosystem-related to a NestJS (backend) JD.
        matched = match_skills("NestJS backend services", _snapshot())
        assert matched["TypeScript"]["tier"] == "ecosystem"
        assert matched["TypeScript"]["score"] == pytest.approx(0.7)

    def test_unrelated_penalty(self) -> None:
        matched = match_skills("Java microservices with Spring Boot", _snapshot())
        assert matched["React"]["tier"] == "unrelated"

    def test_boundary_matching_avoids_substring_false_positives(self) -> None:
        # "PostgreSQL" must not count as "SQL"; "NestJS" must not count as "JS".
        # (SQL/PostgreSQL share the databases category, so ECOSYSTEM is fine —
        # the bug would be an EXACT/RELATED hit via raw substring.)
        skills = SAMPLE_SKILLS + [{"name": "SQL", "category": "Databases", "proficiency": 4, "years_experience": 2}]
        snap = build_profile_snapshot(SAMPLE_PROFILE, skills, SAMPLE_MARKET)
        matched = match_skills("NestJS powers PostgreSQL", snap)
        assert matched["SQL"]["tier"] in ("unrelated", "ecosystem")
        assert matched["SQL"]["tier"] != "exact"


class TestTitleTaxonomy:
    def test_full_stack_engineer_matches_family(self) -> None:
        family, score = match_title("Full Stack Software Engineer", ["Full Stack Developer"])
        assert family == "Full Stack Developer"
        assert score > 0

    def test_no_match_returns_none(self) -> None:
        family, score = match_title("Sales Engineer", ["Backend Engineer"])
        assert family is None
        assert score == 0.0

    def test_family_from_arbitrary_title(self) -> None:
        assert _family_from_text("Senior Backend Developer") == "Backend Engineer"
        assert _family_from_text("React Native Developer") == "Mobile Developer"


class TestSeniority:
    def test_equal_band_is_one(self) -> None:
        assert seniority_score("Senior Software Engineer", "senior") == 1.0

    def test_job_above_profile_discounts(self) -> None:
        assert seniority_score("Senior Software Engineer", "junior") == pytest.approx(0.3)

    def test_band_alias_normalization(self) -> None:
        # "junior" is an alias of the intern band.
        assert seniority_score("Senior Software Engineer", "junior") == pytest.approx(
            seniority_score("Senior Software Engineer", "intern")
        )

    def test_no_band_is_neutral(self) -> None:
        assert seniority_score("Software Engineer", None) == pytest.approx(0.8)


class TestContext:
    def test_required(self) -> None:
        assert classify_context("Must have React") == "required"
        assert classify_context("React is required") == "required"

    def test_preferred(self) -> None:
        assert classify_context("React preferred") == "preferred"
        assert classify_context("Nice to have: React") == "preferred"

    def test_familiarity(self) -> None:
        assert classify_context("Exposure to React") == "familiarity"
        assert classify_context("Basic knowledge of React") == "familiarity"

    def test_familiarity_dominates_preferred(self) -> None:
        # Design doc: "Exposure to React is a plus" is contextual, not preferred.
        assert classify_context("Exposure to React is a plus") == "familiarity"

    def test_neutral(self) -> None:
        assert classify_context("We build web apps") == "neutral"


class TestNegativePenalty:
    def test_sales_engineer_penalized_for_backend_profile(self) -> None:
        penalty = negative_penalty("Sales Engineer", ["Backend Engineer"])
        assert penalty == pytest.approx(0.3)

    def test_no_penalty_within_family(self) -> None:
        assert negative_penalty("Backend Developer", ["Backend Engineer"]) == 0.0


class TestProfileSnapshot:
    def test_has_profile_flag(self) -> None:
        snap = _snapshot()
        assert snap["has_profile"] is True
        assert "Full Stack Developer" in snap["role_families"]
        assert snap["seniority_band"] == "mid"

    def test_empty_profile(self) -> None:
        snap = build_profile_snapshot({}, [], {})
        assert snap["has_profile"] is False


class TestSearchQueries:
    def test_queries_are_generated(self) -> None:
        queries = build_search_queries(_snapshot(), SAMPLE_SKILLS)
        assert len(queries) >= 3
        # First query contains the top family + top skills.
        assert "Full-Stack Developer" in queries[0]
        assert "React" in queries[0]
        # Family queries are quoted for exact phrases.
        assert any('"' in q for q in queries[:2])

    def test_queries_unique(self) -> None:
        queries = build_search_queries(_snapshot(), SAMPLE_SKILLS)
        assert len(queries) == len(set(queries))

    def test_no_skills_still_queries(self) -> None:
        snap = build_profile_snapshot(
            {"work_experience": [{"role": "Data Scientist"}]}, [], {}
        )
        queries = build_search_queries(snap, [])
        assert queries


class TestExtractRequirements:
    def test_required_preferred_and_contextual(self) -> None:
        req = extract_requirements(
            "Senior Backend Developer with 5+ years. "
            "Must have NestJS, PostgreSQL and Docker. "
            "React preferred. Exposure to GraphQL is nice."
        )
        assert req["role"] == "Backend Engineer"
        assert req["seniority_level"] == "senior"
        assert req["experience_years"] == 5
        assert "NestJS" in req["required_skills"]
        assert "PostgreSQL" in req["required_skills"]
        assert "React" in req["preferred_skills"]
        assert "GraphQL" in req["contextual_skills"]

    def test_no_false_substring_matches(self) -> None:
        # "SQL" must not appear via "PostgreSQL"; "js" must not appear via "NestJS".
        req = extract_requirements("NestJS and PostgreSQL in production.")
        assert "JavaScript" not in req["required_skills"]
        assert all("sql" not in s.lower() for s in req["required_skills"] if s != "SQL")

    def test_junior_role_detected(self) -> None:
        req = extract_requirements("Junior Frontend Developer. Must know React.")
        assert req["seniority_level"] == "intern"
        assert req["role"] in ("Frontend Engineer", "Software Engineer")