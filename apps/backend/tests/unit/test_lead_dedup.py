"""Unit tests for the three-tier lead dedup engine."""

import pytest

from app.services.lead_dedup import (
    LeadDeduper,
    canonical_linkedin_url,
    jaccard,
    merge_records,
    name_tokens,
    normalize_company_name,
    normalize_email,
    normalize_name,
)


class TestNormalizeEmail:
    def test_lowercases_and_strips_mailto(self):
        assert normalize_email("mailto:Jane.Doe@Acme.COM") == "jane.doe@acme.com"

    def test_empty_and_none(self):
        assert normalize_email("") is None
        assert normalize_email(None) is None
        assert normalize_email("   ") is None

    def test_strips_trailing_punctuation(self):
        assert normalize_email("jane@acme.com,") == "jane@acme.com"


class TestCanonicalLinkedinUrl:
    def test_strips_query_and_trailing_slash(self):
        a = canonical_linkedin_url("https://www.linkedin.com/in/jane-doe?trk=xyz")
        b = canonical_linkedin_url("https://linkedin.com/in/jane-doe/")
        assert a == b == "https://www.linkedin.com/in/jane-doe"

    def test_case_insensitive_slug(self):
        assert (
            canonical_linkedin_url("https://linkedin.com/in/Jane-Doe")
            == "https://www.linkedin.com/in/jane-doe"
        )

    def test_company_urls(self):
        assert (
            canonical_linkedin_url("https://www.linkedin.com/company/acme-corp/")
            == "https://www.linkedin.com/company/acme-corp"
        )

    def test_non_linkedin_kept_lightly(self):
        assert canonical_linkedin_url("https://Example.com/About/") == "https://example.com/About"

    def test_none_and_empty(self):
        assert canonical_linkedin_url(None) is None
        assert canonical_linkedin_url("  ") is None


class TestNormalizeName:
    def test_casefold_and_collapse(self):
        assert normalize_name("  Jane   DOE ") == "jane doe"

    def test_strips_suffix(self):
        assert normalize_name("John Smith Jr.") == "john smith"

    def test_strips_punctuation(self):
        assert normalize_name("O'Brien, Jane") == "o'brien jane"


class TestNormalizeCompanyName:
    def test_strips_legal_suffix(self):
        assert normalize_company_name("Acme Corp.") == "acme"
        assert normalize_company_name("Acme GmbH") == "acme"

    def test_strips_pipe_location(self):
        assert normalize_company_name("Acme | Tunis") == "acme"


class TestJaccard:
    def test_identical(self):
        assert jaccard({"a", "b"}, {"a", "b"}) == 1.0

    def test_disjoint(self):
        assert jaccard({"a"}, {"b"}) == 0.0

    def test_empty(self):
        assert jaccard(set(), {"a"}) == 0.0


class TestMergeRecords:
    def test_backfills_missing_fields_and_unions_sources(self):
        primary = {"name": "Jane", "title": None, "sources": ["linkedin"]}
        secondary = {"name": "Jane", "title": "CTO", "sources": ["exa", "web"]}
        merged = merge_records(primary, secondary)
        assert merged["title"] == "CTO"
        assert merged["sources"] == ["linkedin", "exa", "web"]

    def test_longer_description_wins(self):
        primary = {"name": "A", "description": "short"}
        secondary = {"name": "A", "description": "a much longer description"}
        assert merge_records(primary, secondary)["description"] == "a much longer description"


class TestLeadDeduper:
    def test_tier1_email(self):
        deduper = LeadDeduper()
        merged, stats = deduper.dedupe(
            [
                {"name": "Jane Doe", "email": "jane@acme.com", "lead_type": "person", "source": "linkedin"},
                {"name": "J. Doe", "email": "Jane@Acme.com", "lead_type": "person", "source": "exa"},
            ]
        )
        assert len(merged) == 1
        assert stats["raw"] == 2
        assert stats["merged"] == 1

    def test_tier1_linkedin_url(self):
        deduper = LeadDeduper()
        merged, _ = deduper.dedupe(
            [
                {
                    "name": "Jane Doe",
                    "linkedin_url": "https://linkedin.com/in/jane-doe?trk=x",
                    "lead_type": "person",
                    "source": "linkedin",
                },
                {
                    "name": "Someone Else",
                    "linkedin_url": "https://www.linkedin.com/in/jane-doe/",
                    "lead_type": "person",
                    "source": "exa",
                },
            ]
        )
        assert len(merged) == 1
        assert merged[0]["name"] in ("Jane Doe", "Someone Else")
        assert set(merged[0]["sources"]) == {"linkedin", "exa"}

    def test_tier2_exact_name(self):
        deduper = LeadDeduper()
        merged, _ = deduper.dedupe(
            [
                {"name": "Acme Corp", "lead_type": "company", "source": "exa"},
                {"name": "acme corp", "lead_type": "company", "source": "web"},
            ]
        )
        assert len(merged) == 1

    def test_tier3_fuzzy_same_company(self):
        # Token order differs so tier 2 (exact string) misses; tier 3 catches.
        deduper = LeadDeduper()
        merged, _ = deduper.dedupe(
            [
                {"name": "Jean Pierre Dupont", "company": "Acme", "lead_type": "person", "source": "linkedin"},
                {"name": "Pierre Dupont Jean", "company": "Acme Corp", "lead_type": "person", "source": "exa"},
            ]
        )
        assert len(merged) == 1

    def test_tier3_different_companies_not_merged(self):
        deduper = LeadDeduper()
        merged, _ = deduper.dedupe(
            [
                {"name": "Jon Smith", "company": "Acme", "lead_type": "person"},
                {"name": "Jon Smith", "company": "Globex", "lead_type": "person"},
            ]
        )
        assert len(merged) == 2

    def test_different_lead_types_not_merged(self):
        deduper = LeadDeduper()
        merged, _ = deduper.dedupe(
            [
                {"name": "Acme", "lead_type": "company"},
                {"name": "Acme", "lead_type": "person"},
            ]
        )
        assert len(merged) == 2

    def test_existing_db_match_marked_already_in_db(self):
        existing = [
            {
                "lead_id": "db-1",
                "name": "Jane Doe",
                "email": "jane@acme.com",
                "lead_type": "person",
                "source": "linkedin",
            }
        ]
        deduper = LeadDeduper(existing=existing)
        merged, stats = deduper.dedupe(
            [{"name": "Jane Doe", "email": "jane@acme.com", "lead_type": "person", "source": "exa"}]
        )
        assert merged == []
        assert stats["already_in_db"] == 1

    def test_existing_db_backfills_missing_email(self):
        db_row = {
            "lead_id": "db-1",
            "name": "Jane Doe",
            "email": None,
            "linkedin_url": "https://www.linkedin.com/in/jane-doe",
            "lead_type": "person",
            "source": "linkedin",
            "sources": ["linkedin"],
        }
        deduper = LeadDeduper(existing=[db_row])
        merged, stats = deduper.dedupe(
            [
                {
                    "name": "Jane Doe",
                    "linkedin_url": "https://linkedin.com/in/jane-doe/",
                    "email": "jane@acme.com",
                    "lead_type": "person",
                    "source": "exa",
                }
            ]
        )
        assert merged == []
        assert stats["already_in_db"] == 1
        assert db_row["email"] == "jane@acme.com"

    def test_blank_names_skipped(self):
        deduper = LeadDeduper()
        merged, stats = deduper.dedupe(
            [
                {"name": "   ", "lead_type": "person", "source": "web"},
                {"name": "Jane", "lead_type": "person", "source": "web"},
            ]
        )
        assert len(merged) == 1
        assert stats["raw"] == 2


def test_name_tokens():
    assert name_tokens("Jane Doe") == {"jane", "doe"}
    assert name_tokens("") == set()
