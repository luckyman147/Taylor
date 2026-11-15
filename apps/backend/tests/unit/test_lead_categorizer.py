"""Unit tests for lead categorization heuristics."""

from app.services.lead_categorizer import (
    apply_ai_classification,
    apply_heuristics,
    heuristic_suggest,
    is_generic_email,
    looks_like_agency,
)


class TestLooksLikeAgency:
    def test_agency_name(self):
        assert looks_like_agency("Bright Recruiting Agency")

    def test_staffing(self):
        assert looks_like_agency("Quick Staffing Group")

    def test_plain_company(self):
        assert not looks_like_agency("Acme Manufacturing")


class TestIsGenericEmail:
    def test_info_is_generic(self):
        assert is_generic_email("info@acme.com")

    def test_personal_not_generic(self):
        assert not is_generic_email("jane.doe@acme.com")


class TestHeuristicSuggest:
    def test_person_with_linkedin(self):
        suggested, confidence, source = heuristic_suggest(
            {"lead_type": "person", "linkedin_url": "https://linkedin.com/in/x", "name": "X"}
        )
        assert suggested == "contact"
        assert source == "heuristic"
        assert confidence >= 0.8

    def test_company_with_industry(self):
        suggested, confidence, _ = heuristic_suggest(
            {"lead_type": "company", "name": "Acme", "industry": "Manufacturing"}
        )
        assert suggested == "company"
        assert confidence >= 0.8

    def test_agency_by_name(self):
        suggested, _, _ = heuristic_suggest(
            {"lead_type": "company", "name": "Kick Recruiting Agency"}
        )
        assert suggested == "agency"

    def test_bare_name_is_unsure(self):
        suggested, _, source = heuristic_suggest({"lead_type": "company", "name": "Vento"})
        assert suggested == "unsure"
        assert source == "unsure"

    def test_person_with_founder_title_at_agency_stays_contact(self):
        suggested, _, _ = heuristic_suggest(
            {
                "lead_type": "person",
                "name": "Jane Doe",
                "title": "Founder, Bright Recruiting Agency",
                "linkedin_url": "https://linkedin.com/in/jane",
            }
        )
        assert suggested == "contact"


class TestApplyHeuristics:
    def test_tags_and_collects_unsure(self):
        records = [
            {"name": "Jane", "lead_type": "person", "linkedin_url": "https://linkedin.com/in/j"},
            {"name": "Vento", "lead_type": "company"},
        ]
        tagged, unsure = apply_heuristics(records)
        assert tagged[0]["suggested_type"] == "contact"
        assert tagged[1]["suggested_type"] == "unsure"
        assert len(unsure) == 1


class TestApplyAiClassification:
    def test_fills_unsure_from_ai(self):
        records = [
            {
                "name": "Vento",
                "lead_type": "company",
                "suggested_type": "unsure",
                "category_source": "unsure",
            }
        ]
        apply_ai_classification(records, {"vento": "company"})
        assert records[0]["suggested_type"] == "company"
        assert records[0]["category_source"] == "ai"

    def test_invalid_pick_ignored(self):
        records = [
            {
                "name": "Vento",
                "lead_type": "company",
                "suggested_type": "unsure",
                "category_source": "unsure",
            }
        ]
        apply_ai_classification(records, {"vento": "banana"})
        assert records[0]["suggested_type"] == "unsure"

    def test_already_certain_not_overwritten(self):
        records = [
            {
                "name": "Jane",
                "lead_type": "person",
                "suggested_type": "contact",
                "category_source": "heuristic",
            }
        ]
        apply_ai_classification(records, {"jane": "company"})
        assert records[0]["suggested_type"] == "contact"
