"""Tests for lead_scraper parsing helpers and LinkedIn profile parsers."""

from __future__ import annotations

from typing import Any

import pytest

from app.schemas.leads import LeadSearchRequest
from app.services.lead_scraper import (
    _make_search_id,
    _safe_name_from_title,
    _scrape_contacts_from_text,
    _search_linkedin,
    build_search_query,
    filter_by_location,
    location_matches,
    parse_company_snippet,
    parse_person_snippet,
    parse_snippet_fields,
)
from app.services.mcp.linkedin import (
    LinkedInAdapter,
    _is_error_page,
    _profile_slug,
)


class TestSafeNameFromTitle:
    def test_strips_linkedin_suffix(self) -> None:
        assert _safe_name_from_title("Jane Doe - Acme | LinkedIn") == "Jane Doe"

    def test_strips_comma_title(self) -> None:
        assert _safe_name_from_title("Jane Doe, CEO at Acme") == "Jane Doe"

    def test_plain_name_passthrough(self) -> None:
        assert _safe_name_from_title("Jane Doe") == "Jane Doe"

    def test_empty(self) -> None:
        assert _safe_name_from_title("") == ""


class TestParseSnippetFields:
    def test_person_role_at_company_location(self) -> None:
        fields = parse_snippet_fields(
            "Jane Doe - Software Engineer at Acme - Tunis, Tunisia"
        )
        assert fields["title"] == "Software Engineer"
        assert fields["company"] == "Acme"
        assert fields["location"] == "Tunis, Tunisia"

    def test_company_with_employees(self) -> None:
        fields = parse_snippet_fields(
            "Acme Corp - Software company · Paris · 11-50 employees"
        )
        assert fields.get("company") == "Software company"
        assert fields.get("location") == "Paris"

    def test_no_separator_returns_empty(self) -> None:
        assert parse_snippet_fields("Jane Doe") == {}

    def test_empty_text(self) -> None:
        assert parse_snippet_fields("") == {}

    def test_title_without_at_keyword(self) -> None:
        fields = parse_snippet_fields("Jane Doe - Founder - Berlin, Germany")
        assert fields.get("title") == "Founder"
        assert fields.get("location") == "Berlin, Germany"


class TestContactInfoParser:
    def test_extracts_email_and_phone(self) -> None:
        text = "Connect\nEmail: jane.doe@acme.com\nPhone: +1 555 123 4567"
        email, phone = LinkedInAdapter._parse_contact_info(text)
        assert email == "jane.doe@acme.com"
        assert phone == "+1 555 123 4567"

    def test_filters_image_emails(self) -> None:
        text = "logo.png support@acme.com"
        email, _ = LinkedInAdapter._parse_contact_info(text)
        assert email == "support@acme.com"

    def test_rejects_short_phones(self) -> None:
        text = "Phone: 12345"
        _, phone = LinkedInAdapter._parse_contact_info(text)
        assert phone is None

    def test_empty(self) -> None:
        assert LinkedInAdapter._parse_contact_info("") == (None, None)


class TestGetPersonProfileParsing:
    @pytest.mark.asyncio
    async def test_parses_location_email_phone(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_call_tool(
            self: Any, tool: str, arguments: dict[str, Any]
        ) -> list[dict[str, Any]]:
            return [
                {
                    "url": "https://www.linkedin.com/in/janedoe",
                    "sections": {
                        "profile": "Jane Doe\nSoftware Engineer at Acme\ntunis, tunisia",
                        "contact_info": "Email: jane@acme.com\nPhone: +216 71 123 456",
                        "experience": "Software Engineer at Acme\nAcme Corp · Full-time",
                        "about": "Builder of things.",
                    },
                }
            ]

        monkeypatch.setattr(LinkedInAdapter, "_call_tool", fake_call_tool)
        adapter = LinkedInAdapter()
        profile = await adapter.get_person_profile("janedoe")
        assert profile is not None
        assert profile["name"] == "Jane Doe"
        assert profile["location"] == "tunis, tunisia"
        assert profile["email"] == "jane@acme.com"
        assert profile["phone"] == "+216 71 123 456"
        assert profile["current_title"] == "Software Engineer at Acme"
        assert profile["current_company"] == "Acme Corp"

    @pytest.mark.asyncio
    async def test_long_line_three_is_not_location(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        long_line = "A" * 120

        async def fake_call_tool(
            self: Any, tool: str, arguments: dict[str, Any]
        ) -> list[dict[str, Any]]:
            return [
                {
                    "url": "https://www.linkedin.com/in/janedoe",
                    "sections": {
                        "profile": f"Jane Doe\nEngineer\n{long_line}",
                    },
                }
            ]

        monkeypatch.setattr(LinkedInAdapter, "_call_tool", fake_call_tool)
        adapter = LinkedInAdapter()
        profile = await adapter.get_person_profile("janedoe")
        assert profile is not None
        assert profile["location"] is None


class TestGetCompanyProfileParsing:
    @pytest.mark.asyncio
    async def test_parses_header_line(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_call_tool(
            self: Any, tool: str, arguments: dict[str, Any]
        ) -> list[dict[str, Any]]:
            return [
                {
                    "url": "https://www.linkedin.com/company/acme",
                    "sections": {
                        "about": (
                            "Acme Corp\n"
                            "Software · Tunis, Tunisia · 11-50 employees · 1,234 followers\n"
                            "We build software."
                        ),
                    },
                }
            ]

        monkeypatch.setattr(LinkedInAdapter, "_call_tool", fake_call_tool)
        adapter = LinkedInAdapter()
        profile = await adapter.get_company_profile("acme")
        assert profile is not None
        assert profile["name"] == "Acme Corp"
        assert profile["industry"] == "Software"
        assert profile["location"] == "Tunis, Tunisia"
        assert profile["company_size"] == "11-50 employees"
        assert profile["slug"] == "acme"

    @pytest.mark.asyncio
    async def test_header_fallback_scan(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_call_tool(
            self: Any, tool: str, arguments: dict[str, Any]
        ) -> list[dict[str, Any]]:
            return [
                {
                    "url": "https://www.linkedin.com/company/acme",
                    "sections": {
                        "about": (
                            "Acme Corp\n"
                            "Building software since 2001\n"
                            "Consulting · Berlin · 200+ employees"
                        ),
                    },
                }
            ]

        monkeypatch.setattr(LinkedInAdapter, "_call_tool", fake_call_tool)
        adapter = LinkedInAdapter()
        profile = await adapter.get_company_profile("acme")
        assert profile is not None
        assert profile["industry"] == "Consulting"
        assert profile["location"] == "Berlin"
        assert profile["company_size"] == "200+ employees"


class TestScrapeContactsFromText:
    def test_prefers_personal_over_generic(self) -> None:
        lead: dict[str, Any] = {
            "description": "Contact info@acme.com or jane.doe@acme.com for details.",
        }
        _scrape_contacts_from_text(lead)
        assert lead["email"] == "jane.doe@acme.com"

    def test_falls_back_to_generic(self) -> None:
        lead: dict[str, Any] = {"description": "Reach us at info@acme.com."}
        _scrape_contacts_from_text(lead)
        assert lead["email"] == "info@acme.com"

    def test_extracts_phone(self) -> None:
        lead: dict[str, Any] = {"description": "Call +1 555 987 6543 today."}
        _scrape_contacts_from_text(lead)
        assert lead["phone"] == "+1 555 987 6543"

    def test_does_not_overwrite_existing(self) -> None:
        lead: dict[str, Any] = {
            "email": "keep@me.com",
            "description": "other@example.com",
        }
        _scrape_contacts_from_text(lead)
        assert lead["email"] == "keep@me.com"

    def test_empty_description_noop(self) -> None:
        lead: dict[str, Any] = {"description": ""}
        _scrape_contacts_from_text(lead)
        assert lead.get("email") is None


class TestProfileSlug:
    def test_full_url(self) -> None:
        assert _profile_slug("https://www.linkedin.com/in/satyanadella") == "satyanadella"

    def test_url_with_trailing_slash_and_query(self) -> None:
        assert (
            _profile_slug("https://linkedin.com/in/janedoe/?miniProfileUrn=x")
            == "janedoe"
        )

    def test_bare_username_passthrough(self) -> None:
        assert _profile_slug("satyanadella") == "satyanadella"


class TestErrorPageDetection:
    def test_404_page(self) -> None:
        assert _is_error_page(
            "This page doesn’t exist\nPlease check your URL or return to LinkedIn home."
        )

    def test_authwall(self) -> None:
        assert _is_error_page("LinkedIn | Log In or Sign Up\nauthwall detected")

    def test_normal_profile_not_error(self) -> None:
        assert not _is_error_page("Jane Doe\nSoftware Engineer at Acme\nTunis, Tunisia")


class TestPersonProfileErrorPage:
    @pytest.mark.asyncio
    async def test_error_page_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_call_tool(
            self: Any, tool: str, arguments: dict[str, Any]
        ) -> list[dict[str, Any]]:
            return [
                {
                    "url": "https://www.linkedin.com/in/janedoe/",
                    "sections": {
                        "main_profile": (
                            "This page doesn’t exist\n"
                            "Please check your URL or return to LinkedIn home.\n"
                            "Go to your feed"
                        ),
                    },
                }
            ]

        monkeypatch.setattr(LinkedInAdapter, "_call_tool", fake_call_tool)
        adapter = LinkedInAdapter()
        profile = await adapter.get_person_profile(
            "https://www.linkedin.com/in/janedoe"
        )
        assert profile is None

    @pytest.mark.asyncio
    async def test_full_url_is_sent_as_slug(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: dict[str, Any] = {}

        async def fake_call_tool(
            self: Any, tool: str, arguments: dict[str, Any]
        ) -> list[dict[str, Any]]:
            seen.update(arguments)
            return []

        monkeypatch.setattr(LinkedInAdapter, "_call_tool", fake_call_tool)
        adapter = LinkedInAdapter()
        await adapter.get_person_profile("https://www.linkedin.com/in/Janedoe-42")
        assert seen["linkedin_username"] == "Janedoe-42"


class TestParsePersonSnippet:
    def test_headline_at_company_with_location_line(self) -> None:
        text = (
            "Software engineer at Sofrecom Tunisie\n\n"
            "Tunis, Tunisia (TN)\n"
            "...\n"
            "I build backend systems with Java."
        )
        fields = parse_person_snippet("Meher Ben Mahmoud", text)
        assert fields["title"] == "Software engineer"
        assert fields["company"] == "Sofrecom Tunisie"
        assert fields["location"] == "Tunis, Tunisia"

    def test_headline_without_at(self) -> None:
        text = "Software Engineer | Full Stack\n\nSousse, Tunisia (TN)\n...\nAbout text"
        fields = parse_person_snippet("Someone", text)
        assert fields["title"] == "Software Engineer"
        assert fields.get("company") is None
        assert fields["location"] == "Sousse, Tunisia"

    def test_falls_back_to_item_title(self) -> None:
        fields = parse_person_snippet("Jane Doe", "")
        assert fields["title"] == "Jane Doe"


class TestParseCompanySnippet:
    def test_industry_and_hq(self) -> None:
        text = (
            "# Genium\n\n"
            "Genium is a Software Development company. They offer delivery "
            "models and AI solutions. Headquartered in San Mateo, California."
        )
        fields = parse_company_snippet("Genium", text)
        assert fields["industry"] == "Software Development"
        assert fields["location"] == "San Mateo, California"

    def test_no_markers_returns_empty(self) -> None:
        fields = parse_company_snippet("Acme", "We build things.")
        assert fields.get("industry") is None


class TestLocationMatches:
    def test_no_requested_locations_matches_everything(self) -> None:
        assert location_matches(None, []) is True
        assert location_matches("Paris, France", []) is True

    def test_exact_city_match(self) -> None:
        assert location_matches("Tunis, Tunisia", ["Tunis"]) is True

    def test_country_matches_within_city_string(self) -> None:
        assert location_matches("Bizerte, Tunisia", ["Tunisia"]) is True

    def test_case_insensitive(self) -> None:
        assert location_matches("TUNIS, TUNISIA", ["tunis"]) is True

    def test_word_boundary_no_substring_false_positive(self) -> None:
        # "Tunis" must not match a location that only says "Tunisia".
        assert location_matches("Tunisia", ["Tunis"]) is False

    def test_mismatch_rejected(self) -> None:
        assert location_matches("Paris, France", ["Tunis"]) is False

    def test_unknown_location_rejected_when_requested(self) -> None:
        assert location_matches(None, ["Tunis"]) is False
        assert location_matches("", ["Tunis"]) is False

    def test_multi_location_any_match(self) -> None:
        assert location_matches("Sfax, Tunisia", ["Tunis", "Sfax"]) is True

    def test_comma_group_uses_any_part(self) -> None:
        assert location_matches("Berlin, Germany", ["Paris, Berlin"]) is True

    def test_remote_request_matches_remote_candidate(self) -> None:
        assert location_matches("Remote", ["Remote"]) is True
        assert location_matches("Paris, France", ["Remote"]) is False


class TestFilterByLocation:
    def test_empty_requests_passthrough(self) -> None:
        candidates = [{"name": "A", "location": None}]
        assert filter_by_location(candidates, []) == candidates

    def test_keeps_matches_drops_rest_in_order(self) -> None:
        candidates = [
            {"name": "A", "location": "Tunis, Tunisia"},
            {"name": "B", "location": "Paris, France"},
            {"name": "C", "location": None},
            {"name": "D", "location": "Bizerte, Tunisia"},
        ]
        kept = filter_by_location(candidates, ["Tunisia"])
        assert [c["name"] for c in kept] == ["A", "D"]


class TestPerLocationLinkedInQueries:
    @pytest.mark.asyncio
    async def test_one_query_per_location(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen_locations: list[str | None] = []

        async def fake_is_available(self: Any) -> bool:
            return True

        async def fake_search_people(
            self: Any, keywords: str, location: str | None = None, max_results: int = 25
        ) -> list[dict[str, Any]]:
            seen_locations.append(location)
            slug = (location or "none").lower()
            return [{"name": f"Person {slug}", "url": f"https://www.linkedin.com/in/{slug}"}]

        async def fake_get_person_profile(
            self: Any, username_or_url: str, sections: str = "experience,contact_info"
        ) -> dict[str, Any] | None:
            return None

        async def fake_search_companies(
            self: Any, keywords: str, max_results: int = 15
        ) -> list[dict[str, Any]]:
            return []

        monkeypatch.setattr(LinkedInAdapter, "is_available", fake_is_available)
        monkeypatch.setattr(LinkedInAdapter, "search_people", fake_search_people)
        monkeypatch.setattr(LinkedInAdapter, "get_person_profile", fake_get_person_profile)
        monkeypatch.setattr(LinkedInAdapter, "search_companies", fake_search_companies)

        req = LeadSearchRequest(
            keywords="CTO", locations=["Tunis", "Sfax"], lead_types=["person"]
        )
        candidates, status = await _search_linkedin(req)
        assert status["available"] is True
        assert seen_locations == ["Tunis", "Sfax"]
        assert len(candidates) == 2
        assert candidates[0]["location"] == "Tunis"
        assert candidates[1]["location"] == "Sfax"

    @pytest.mark.asyncio
    async def test_same_profile_across_locations_read_once(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        profile_calls: list[str] = []

        async def fake_is_available(self: Any) -> bool:
            return True

        async def fake_search_people(
            self: Any, keywords: str, location: str | None = None, max_results: int = 25
        ) -> list[dict[str, Any]]:
            # Every "location" returns the same person.
            return [{"name": "Jane Doe", "url": "https://www.linkedin.com/in/jane-doe"}]

        async def fake_get_person_profile(
            self: Any, username_or_url: str, sections: str = "experience,contact_info"
        ) -> dict[str, Any] | None:
            profile_calls.append(username_or_url)
            return None

        async def fake_search_companies(
            self: Any, keywords: str, max_results: int = 15
        ) -> list[dict[str, Any]]:
            return []

        monkeypatch.setattr(LinkedInAdapter, "is_available", fake_is_available)
        monkeypatch.setattr(LinkedInAdapter, "search_people", fake_search_people)
        monkeypatch.setattr(LinkedInAdapter, "get_person_profile", fake_get_person_profile)
        monkeypatch.setattr(LinkedInAdapter, "search_companies", fake_search_companies)

        req = LeadSearchRequest(
            keywords="CTO", locations=["Tunis", "Sfax"], lead_types=["person"]
        )
        candidates, _ = await _search_linkedin(req)
        assert len(candidates) == 1
        assert len(profile_calls) == 1


class TestSearchLeadsLocationGate:
    @pytest.mark.asyncio
    async def test_mismatch_dropped_and_filtering_event_emitted(
        self, isolated_db, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.services.lead_scraper as lead_scraper_module

        async def fake_linkedin(request, emit=None):
            people = [
                {
                    "name": "Paris Person",
                    "lead_type": "person",
                    "linkedin_url": "https://www.linkedin.com/in/paris-person",
                    "location": "Paris, France",
                    "source": "linkedin",
                    "sources": ["linkedin"],
                },
                {
                    "name": "Tunis Person",
                    "lead_type": "person",
                    "linkedin_url": "https://www.linkedin.com/in/tunis-person",
                    "location": "Tunis, Tunisia",
                    "source": "linkedin",
                    "sources": ["linkedin"],
                },
            ]
            return people, {"available": True, "details": "Connected"}

        async def fake_exa(request, emit=None):
            return []

        async def fake_web(request, emit=None):
            return []

        monkeypatch.setattr(lead_scraper_module, "_search_linkedin", fake_linkedin)
        monkeypatch.setattr(lead_scraper_module, "_search_exa", fake_exa)
        monkeypatch.setattr(lead_scraper_module, "_search_web", fake_web)

        events: list[dict[str, Any]] = []
        req = LeadSearchRequest(
            keywords="CTO",
            locations=["Tunis"],
            lead_types=["person"],
            enrich_contacts=False,
        )
        result = await lead_scraper_module.search_leads(req, emit=events.append)
        assert [lead.name for lead in result.leads] == ["Tunis Person"]
        phases = [e["phase"] for e in events]
        assert phases[0] == "searching"
        assert "filtering" in phases
        assert "categorize" in phases
        assert "dedupe" in phases
        assert "persisted" in phases
        filtering = next(e for e in events if e["phase"] == "filtering")
        assert filtering["done"] == 1
        assert filtering["total"] == 2

    @pytest.mark.asyncio
    async def test_no_locations_skips_gate(
        self, isolated_db, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.services.lead_scraper as lead_scraper_module

        async def fake_linkedin(request, emit=None):
            people = [
                {
                    "name": "Any Person",
                    "lead_type": "person",
                    "linkedin_url": "https://www.linkedin.com/in/any-person",
                    "source": "linkedin",
                    "sources": ["linkedin"],
                }
            ]
            return people, {"available": True, "details": "Connected"}

        async def fake_exa(request, emit=None):
            return []

        async def fake_web(request, emit=None):
            return []

        monkeypatch.setattr(lead_scraper_module, "_search_linkedin", fake_linkedin)
        monkeypatch.setattr(lead_scraper_module, "_search_exa", fake_exa)
        monkeypatch.setattr(lead_scraper_module, "_search_web", fake_web)

        events: list[dict[str, Any]] = []
        req = LeadSearchRequest(
            keywords="CTO", lead_types=["person"], enrich_contacts=False
        )
        result = await lead_scraper_module.search_leads(req, emit=events.append)
        assert len(result.leads) == 1
        assert not any(e["phase"] == "filtering" for e in events)


class TestBuildSearchQuery:
    @pytest.mark.asyncio
    async def test_no_context_returns_original_keywords(self) -> None:
        req = LeadSearchRequest(keywords="CTO")
        assert await build_search_query(req) == "CTO"

    @pytest.mark.asyncio
    async def test_llm_refined_query_receives_target_and_purpose(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.services.lead_scraper as lead_scraper_module

        seen: dict[str, str] = {}

        async def fake_complete_json(prompt: str, **kwargs: Any) -> dict[str, Any]:
            seen["prompt"] = prompt
            return {"keywords": "fintech CTO startup"}

        monkeypatch.setattr(lead_scraper_module, "complete_json", fake_complete_json)
        req = LeadSearchRequest(
            keywords="CTO",
            target="CTOs at 10-50 person fintech startups",
            purpose="selling an ATS to engineering leads",
        )
        refined = await build_search_query(req)
        assert refined == "fintech CTO startup"
        assert "CTOs at 10-50 person fintech startups" in seen["prompt"]
        assert "selling an ATS to engineering leads" in seen["prompt"]

    @pytest.mark.asyncio
    async def test_llm_failure_falls_back_to_keywords_plus_target(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.services.lead_scraper as lead_scraper_module

        async def boom(prompt: str, **kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("no llm")

        monkeypatch.setattr(lead_scraper_module, "complete_json", boom)
        req = LeadSearchRequest(keywords="CTO", target="fintech CTOs")
        assert await build_search_query(req) == "CTO fintech CTOs"

    @pytest.mark.asyncio
    async def test_empty_llm_result_falls_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.services.lead_scraper as lead_scraper_module

        async def empty(prompt: str, **kwargs: Any) -> dict[str, Any]:
            return {}

        monkeypatch.setattr(lead_scraper_module, "complete_json", empty)
        req = LeadSearchRequest(keywords="CTO", purpose="hiring engineers")
        assert await build_search_query(req) == "CTO"


class TestSearchIdContext:
    def test_purpose_changes_search_id(self) -> None:
        base = LeadSearchRequest(keywords="CTO")
        with_purpose = LeadSearchRequest(keywords="CTO", purpose="selling an ATS")
        assert _make_search_id(base) != _make_search_id(with_purpose)

    def test_target_changes_search_id(self) -> None:
        base = LeadSearchRequest(keywords="CTO")
        with_target = LeadSearchRequest(keywords="CTO", target="fintech CTOs")
        assert _make_search_id(base) != _make_search_id(with_target)

    def test_same_context_same_id(self) -> None:
        a = LeadSearchRequest(keywords="CTO", target="fintech CTOs", purpose="hiring")
        b = LeadSearchRequest(keywords="CTO", target="fintech CTOs", purpose="hiring")
        assert _make_search_id(a) == _make_search_id(b)
