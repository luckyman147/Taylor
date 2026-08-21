"""Unit tests for the skill-gap / learning-resources feature.

Covers the pure math (missing-skill extraction, ROI action classification,
section partitioning, resource normalization) and the URL verifier (via
``respx``). The LLM call itself is only tested at the integration layer.
"""

import httpx
import pytest
import respx

from app.services.career_profile import (
    _normalize_resource_response,
    compute_skill_roi,
    missing_catalog_skills,
    partition_roi_rows,
)
from app.services.link_verifier import (
    _extract_title,
    verify_resource_link,
    verify_resource_links,
)

_JOBS = [
    {
        "title": "Senior Python Developer",
        "description": "Looking for a senior Python engineer with deep Django and SQL experience. Salary $130,000.",
        "salary": "$130,000",
    },
    {
        "title": "Platform Engineer",
        "description": "We run Kubernetes on AWS with Terraform. Go preferred.",
        "salary": "$120,000",
    },
    {
        "title": "Data Scientist",
        "description": "PyTorch and SQL expert wanted.",
        "salary": "$110,000",
    },
]


class TestMissingCatalogSkills:
    def test_finds_catalog_skills_missing_from_profile(self):
        profile_skills = [{"name": "Python", "proficiency": 4}]
        missing = missing_catalog_skills(_JOBS, profile_skills)
        assert "Python" not in missing
        assert "Kubernetes" in missing
        assert "Terraform" in missing

    def test_matches_aliases(self):
        missing = missing_catalog_skills(
            _JOBS, [{"name": "Python"}]
        )
        assert "Go" in missing  # matches via the "golang" alias
        assert "AWS" in missing  # matches via "amazon web services"/"aws"

    def test_ignores_jobs_without_description(self):
        jobs = [
            {"title": "K8s engineer", "description": None},
            {"title": "Whatever", "description": ""},
        ]
        assert missing_catalog_skills(jobs, []) == []

    def test_case_insensitive_profile_exclusion(self):
        jobs = [{"title": "X", "description": "Kubernetes wanted."}]
        assert missing_catalog_skills(jobs, [{"name": "kubernetes"}]) == []


class TestRoiActionClassification:
    def test_learn_for_missing_skills(self):
        rows, _note = compute_skill_roi(_JOBS, [{"name": "Python"}])
        actions = {row["skill"]: row["action"] for row in rows}
        assert actions["Kubernetes"] == "learn"
        assert actions["Terraform"] == "learn"

    def test_strengthen_for_weak_in_demand_profile_skill(self):
        profile_skills = [{"name": "Python", "proficiency": 1}]
        rows, _note = compute_skill_roi(_JOBS, profile_skills)
        python = next(row for row in rows if row["skill"] == "Python")
        assert python["action"] == "strengthen"
        assert python["existing_knowledge"] == 20
        assert python["in_profile"] is True

    def test_monitor_for_strong_or_unmatched_profile_skills(self):
        profile_skills = [{"name": "Python", "proficiency": 5}]
        rows, _note = compute_skill_roi(_JOBS, profile_skills)
        python = next(row for row in rows if row["skill"] == "Python")
        assert python["action"] == "monitor"
        assert python["existing_knowledge"] == 100


class TestPartitionRoiRows:
    def test_partitions_and_ranks(self):
        rows, _note = compute_skill_roi(
            _JOBS,
            [
                {"name": "Python", "proficiency": 1},
                {"name": "Rust", "proficiency": 4},
            ],
        )
        gaps, strengthen, rest = partition_roi_rows(rows)
        assert all(row["action"] == "learn" for row in gaps)
        assert all(row["action"] == "strengthen" for row in strengthen)
        assert {"Kubernetes", "Terraform", "AWS"} <= {row["skill"] for row in gaps}
        assert "Python" not in {row["skill"] for row in gaps}
        assert [row["skill"] for row in strengthen] == ["Python"]
        assert any(row["skill"] == "Rust" for row in rest)

    def test_strengthen_ranked_by_demand_then_weakness(self):
        jobs = [
            {"title": "A", "description": "Python, Java and Go wanted.", "salary": None},
            {"title": "B", "description": "Java wanted.", "salary": None},
        ]
        rows, _note = compute_skill_roi(
            jobs,
            [
                {"name": "Python", "proficiency": 1},
                {"name": "Java", "proficiency": 1},
                {"name": "Go", "proficiency": 2},
            ],
        )
        gaps, strengthen, _rest = partition_roi_rows(rows)
        assert [row["skill"] for row in strengthen] == ["Java", "Python", "Go"]

    def test_empty_inputs(self):
        gaps, strengthen, rest = partition_roi_rows([])
        assert gaps == [] and strengthen == [] and rest == []


class TestNormalizeResourceResponse:
    def test_keeps_valid_entries(self):
        raw = {
            "Python": [
                {"title": "Python.org", "url": "https://python.org", "source": "docs"},
                {"title": "No URL", "source": "article"},
                "not a dict",
                {"title": "", "url": "https://x.dev", "source": "docs"},
                {"title": "5th", "url": "https://e.dev", "source": "video"},
            ],
            "Kubernetes": "not a list",
        }
        result = _normalize_resource_response(raw)
        assert [r["title"] for r in result["Python"]] == ["Python.org", "5th"]
        assert "Kubernetes" not in result

    def test_truncates_long_fields(self):
        raw = {
            "Go": [
                {
                    "title": "t" * 300,
                    "url": "u" * 600,
                    "source": "s" * 100,
                }
            ]
        }
        result = _normalize_resource_response(raw)
        entry = result["Go"][0]
        assert len(entry["title"]) == 200
        assert len(entry["url"]) == 500
        assert len(entry["source"]) == 40

    def test_empty_raw(self):
        assert _normalize_resource_response({}) == {}


class TestExtractTitle:
    def test_extracts_and_collapses(self):
        html = "<html><head>\n<title>  Real   Title  </title></head></html>"
        assert _extract_title(html) == "Real Title"

    def test_missing_title(self):
        assert _extract_title("<html><body>no title</body></html>") == ""

    def test_truncates(self):
        assert len(_extract_title(f"<title>{'x' * 500}</title>")) == 200


@respx.mock
class TestLinkVerifier:
    async def test_verifies_ok_link(self):
        respx.get("https://python.org/").mock(
            return_value=httpx.Response(
                200, text="<title>Welcome to Python.org</title>"
            )
        )
        result = await verify_resource_link("https://python.org/")
        assert result == {"title": "Welcome to Python.org", "url": "https://python.org/"}

    async def test_drops_non_2xx(self):
        respx.get("https://dead.test/").mock(return_value=httpx.Response(404))
        assert await verify_resource_link("https://dead.test/") is None

    async def test_drops_non_http_schemes(self):
        assert await verify_resource_link("file:///etc/passwd") is None
        assert await verify_resource_link("javascript:alert(1)") is None

    async def test_drops_network_failures(self):
        respx.get("https://boom.test/").mock(side_effect=httpx.ConnectError("no route"))
        assert await verify_resource_link("https://boom.test/") is None

    async def test_follows_redirects_and_reports_final_url(self):
        respx.get("https://short.test/").mock(
            return_value=httpx.Response(302, headers={"Location": "https://final.test/doc"})
        )
        respx.get("https://final.test/doc").mock(
            return_value=httpx.Response(200, text="<title>Final Doc</title>")
        )
        result = await verify_resource_link("https://short.test/")
        assert result == {"title": "Final Doc", "url": "https://final.test/doc"}

    async def test_verify_list_drops_dead_links(self):
        respx.get("https://good.test/").mock(
            return_value=httpx.Response(200, text="<title>Good</title>")
        )
        respx.get("https://bad.test/").mock(return_value=httpx.Response(500))
        resources = [
            {"title": "Good", "url": "https://good.test/", "source": "docs"},
            {"title": "Bad", "url": "https://bad.test/", "source": "course"},
            {"title": "Empty", "url": "  ", "source": "video"},
        ]
        verified = await verify_resource_links(resources)
        assert verified == [{"title": "Good", "url": "https://good.test/", "source": "docs"}]

    async def test_keeps_proposed_title_when_page_has_none(self):
        respx.get("https://plain.test/").mock(
            return_value=httpx.Response(200, text="<html>no title here</html>")
        )
        verified = await verify_resource_links(
            [{"title": "Proposed Title", "url": "https://plain.test/", "source": "docs"}]
        )
        assert verified[0]["title"] == "Proposed Title"
