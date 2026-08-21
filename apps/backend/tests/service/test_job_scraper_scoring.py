"""Service tests for profile-driven job scoring + relevance filtering.

Mirrors the TAYLOR design doc training examples: match jobs >= 0.55, stretch
jobs 0.35-0.55 (primary role family only), everything below 0.35 hidden, and
``total_found`` reports the raw count before filtering.
"""

from __future__ import annotations

import pytest

from app.schemas.job_scraper import JobListing
from app.services.job_scraper import _score_jobs
from app.services.skill_ontology import build_profile_snapshot

SKILLS = [
    {"name": "React", "category": "Frontend", "proficiency": 5, "years_experience": 4},
    {"name": "Node.js", "category": "Backend", "proficiency": 4, "years_experience": 3},
    {"name": "TypeScript", "category": "Frontend", "proficiency": 4, "years_experience": 3},
    {"name": "PostgreSQL", "category": "Databases", "proficiency": 3, "years_experience": 2},
]

PROFILE = {
    "work_experience": [
        {"role": "Full-Stack Developer", "years": "2021 - Present"},
    ],
    "target_roles": ["Backend Developer"],
    "target_locations": ["Tunisia", "Remote"],
}

MARKET = {"current_role": "Mid Backend Engineer", "recommended_roles": [{"role": "Backend Engineer"}]}


def _bundle() -> dict:
    snapshot = build_profile_snapshot(PROFILE, SKILLS, MARKET)
    return {"snapshot": snapshot, "skills": SKILLS}


def _job(job_id: str, title: str, description: str, **kwargs) -> JobListing:
    defaults = {
        "company": "Acme",
        "location": "Tunis",
        "url": f"https://jobs/{job_id}",
        "source": "bayt",
    }
    defaults.update(kwargs)
    return JobListing(id=job_id, title=title, description=description, **defaults)


class TestScoreJobs:
    def test_match_job_visible(self) -> None:
        job = _job(
            "1",
            "Backend Developer",
            "Must have NestJS, PostgreSQL and Docker. 3+ years experience.",
        )
        visible, total = _score_jobs([job], _bundle())
        assert total == 1
        assert len(visible) == 1
        assert visible[0].relevance_score >= 0.55
        assert visible[0].is_stretch is False

    def test_senior_job_stretch_for_mid_profile(self) -> None:
        # Same family but senior level and no matching tech: mid profile lands
        # in the stretch band (0.35-0.55).
        job = _job("2", "Senior Full Stack Developer", "Lead our team and drive delivery.")
        visible, _ = _score_jobs([job], _bundle())
        assert len(visible) == 1
        scored = visible[0]
        assert scored.is_stretch is True
        assert 0.35 <= scored.relevance_score < 0.55

    def test_unrelated_job_hidden(self) -> None:
        # Sales role: negative penalty, no family match -> below 0.35.
        job = _job("3", "Sales Engineer", "Sell our SaaS product to enterprises.")
        visible, total = _score_jobs([job], _bundle())
        assert total == 1
        assert visible == []

    def test_off_family_job_hidden_even_if_mid_score(self) -> None:
        # Mid-score (0.35-0.55) but no primary-family hit: must stay hidden.
        job = _job("4", "Sales Engineer", "Manage our sales pipeline and reporting.")
        visible, _ = _score_jobs([job], _bundle())
        assert visible == []

    def test_remote_bonus_when_targeting_remote(self) -> None:
        plain = _job("5", "Backend Developer", "Must have NestJS and PostgreSQL.")
        remote = _job("6", "Backend Developer", "Must have NestJS and PostgreSQL.", remote=True)
        visible, _ = _score_jobs([plain, remote], _bundle())
        by_id = {j.id: j.relevance_score for j in visible}
        assert by_id["6"] > by_id["5"]

    def test_total_found_reports_raw_count(self) -> None:
        jobs = [
            _job("1", "Backend Developer", "Must have NestJS and PostgreSQL."),
            _job("3", "Sales Engineer", "Sell our SaaS product to enterprises."),
        ]
        visible, total = _score_jobs(jobs, _bundle())
        assert total == 2
        assert len(visible) == 1

    def test_no_profile_falls_back_to_keywords(self) -> None:
        from app.services.job_scraper import _score_relevance

        job = _job("7", "Backend Developer", "NestJS and PostgreSQL.")
        visible, total = _score_relevance([job], "backend developer nestjs postgresql")
        assert total == 1
        assert visible and visible[0].relevance_score >= 0.35