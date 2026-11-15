"""Integration tests for the lead-scraper API (real isolated DB, mocked sources)."""

import json

from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


PEOPLE_HITS = [
    {
        "name": "Jane Doe",
        "lead_type": "person",
        "linkedin_url": "https://www.linkedin.com/in/jane-doe",
        "title": "CTO",
        "company": "Acme",
        "source": "linkedin",
        "sources": ["linkedin"],
    },
    {
        "name": "Jane Doe",
        "lead_type": "person",
        "linkedin_url": "https://linkedin.com/in/jane-doe/",
        "source": "exa",
        "sources": ["exa"],
    },
]

COMPANY_HITS = [
    {
        "name": "Bright Recruiting Agency",
        "lead_type": "company",
        "website": "https://brightrecruiting.example",
        "source": "web",
        "sources": ["web"],
    },
]


def _patch_sources(monkeypatch, people=None, companies=None, web=None):
    import app.services.lead_scraper as lead_scraper_module

    people = PEOPLE_HITS[:1] if people is None else people
    web = COMPANY_HITS if web is None else web

    async def fake_linkedin(request, emit=None):
        return list(people), {"available": True, "details": "Connected"}

    async def fake_exa(request, emit=None):
        return list(companies or [])

    async def fake_web(request, emit=None):
        return list(web)

    monkeypatch.setattr(lead_scraper_module, "_search_linkedin", fake_linkedin)
    monkeypatch.setattr(lead_scraper_module, "_search_exa", fake_exa)
    monkeypatch.setattr(lead_scraper_module, "_search_web", fake_web)
    return lead_scraper_module


class TestSearch:
    async def test_search_dedupes_and_persists(self, isolated_db, monkeypatch):
        _patch_sources(monkeypatch, people=PEOPLE_HITS, web=[])
        payload = {"keywords": "CTO", "lead_types": ["person"], "enrich_contacts": False}
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["dedup_stats"]["raw"] == 2
        assert body["dedup_stats"]["new_inserted"] == 1
        assert len(body["leads"]) == 1
        lead = body["leads"][0]
        assert lead["name"] == "Jane Doe"
        assert lead["suggested_type"] == "contact"
        assert set(lead["sources"]) == {"linkedin", "exa"}
        assert lead["status"] == "new"

    async def test_search_marks_agency(self, isolated_db, monkeypatch):
        _patch_sources(monkeypatch, people=[], web=COMPANY_HITS)
        payload = {"keywords": "recruiting", "lead_types": ["company", "agency"], "enrich_contacts": False}
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json=payload)
        body = resp.json()
        assert len(body["leads"]) == 1
        assert body["leads"][0]["suggested_type"] == "agency"

    async def test_second_search_does_not_duplicate(self, isolated_db, monkeypatch):
        _patch_sources(monkeypatch, people=PEOPLE_HITS, web=[])
        payload = {"keywords": "CTO", "lead_types": ["person"], "enrich_contacts": False}
        async with _client() as client:
            first = await client.post("/api/v1/leads/search", json=payload)
            second = await client.post("/api/v1/leads/search", json=payload)
        assert first.json()["dedup_stats"]["new_inserted"] == 1
        assert second.json()["dedup_stats"]["new_inserted"] == 0
        assert second.json()["dedup_stats"]["already_in_db"] >= 1
        leads = await isolated_db.list_leads()
        assert len(leads) == 1

    async def test_search_requires_keywords(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json={"keywords": ""})
        assert resp.status_code == 422

    async def test_search_filters_out_location_mismatches(self, isolated_db, monkeypatch):
        mismatched = [{**PEOPLE_HITS[0], "location": "Paris, France"}]
        _patch_sources(monkeypatch, people=mismatched, web=[])
        payload = {
            "keywords": "CTO",
            "lead_types": ["person"],
            "locations": ["Tunis"],
            "enrich_contacts": False,
        }
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json=payload)
        body = resp.json()
        assert body["leads"] == []
        assert body["dedup_stats"]["new_inserted"] == 0

    async def test_search_keeps_location_matches(self, isolated_db, monkeypatch):
        matched = [{**PEOPLE_HITS[0], "location": "Tunis, Tunisia"}]
        _patch_sources(monkeypatch, people=matched, web=[])
        payload = {
            "keywords": "CTO",
            "lead_types": ["person"],
            "locations": ["Tunisia"],
            "enrich_contacts": False,
        }
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json=payload)
        body = resp.json()
        assert len(body["leads"]) == 1
        assert body["leads"][0]["location"] == "Tunis, Tunisia"

    async def test_search_with_target_purpose_refines_source_queries(
        self, isolated_db, monkeypatch
    ):
        module = _patch_sources(monkeypatch, people=[], web=[])
        seen_keywords: dict[str, str] = {}

        async def fake_linkedin(request, emit=None):
            seen_keywords["value"] = request.keywords
            return list(PEOPLE_HITS[:1]), {"available": True, "details": "Connected"}

        async def fake_complete_json(prompt, **kwargs):
            return {"keywords": "fintech CTO startups"}

        monkeypatch.setattr(module, "_search_linkedin", fake_linkedin)
        monkeypatch.setattr(module, "complete_json", fake_complete_json)
        payload = {
            "keywords": "CTO",
            "target": "CTOs at fintech startups",
            "purpose": "selling an ATS",
            "lead_types": ["person"],
            "enrich_contacts": False,
        }
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json=payload)
        assert resp.status_code == 200
        assert seen_keywords["value"] == "fintech CTO startups"
        assert len(resp.json()["leads"]) == 1

    async def test_search_with_context_and_no_llm_still_searches(
        self, isolated_db, monkeypatch
    ):
        module = _patch_sources(monkeypatch, people=PEOPLE_HITS[:1], web=[])

        async def boom(prompt, **kwargs):
            raise RuntimeError("no llm configured")

        monkeypatch.setattr(module, "complete_json", boom)
        payload = {
            "keywords": "CTO",
            "target": "fintech CTOs",
            "purpose": "selling an ATS",
            "lead_types": ["person"],
            "enrich_contacts": False,
        }
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search", json=payload)
        assert resp.status_code == 200
        assert len(resp.json()["leads"]) == 1


class TestSearchStream:
    async def test_stream_emits_progress_and_result(self, isolated_db, monkeypatch):
        _patch_sources(monkeypatch, people=PEOPLE_HITS[:1], web=[])
        payload = {
            "keywords": "CTO",
            "lead_types": ["person"],
            "enrich_contacts": False,
        }
        async with _client() as client:
            resp = await client.post("/api/v1/leads/search?stream=true", json=payload)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        assert events, "stream contained no events"
        phases = [e["phase"] for e in events]
        assert phases[0] == "searching"
        assert "categorize" in phases
        assert "dedupe" in phases
        assert "persisted" in phases
        assert phases[-1] == "done"
        final = events[-1]["result"]
        assert final["dedup_stats"]["new_inserted"] == 1
        assert final["leads"][0]["name"] == "Jane Doe"

    async def test_stream_reports_error_event(self, isolated_db, monkeypatch):
        import app.routers.leads as leads_router

        async def boom(request, emit=None):
            raise RuntimeError("search exploded")

        monkeypatch.setattr(leads_router, "search_leads", boom)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/leads/search?stream=true", json={"keywords": "CTO"}
            )
        events = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        assert events[-1]["phase"] == "error"
        assert "Lead search failed" in events[-1]["detail"]


class TestListAndTriage:
    async def _seed(self, isolated_db):
        lead, _ = await isolated_db.create_lead(
            search_id="s1",
            name="Jane Doe",
            lead_type="person",
            title="CTO",
            source="linkedin",
            sources=["linkedin"],
            suggested_type="contact",
            category_source="heuristic",
        )
        return lead

    async def test_list_and_filter(self, isolated_db):
        await self._seed(isolated_db)
        await isolated_db.create_lead(
            search_id="s1", name="Acme", lead_type="company", source="web"
        )
        async with _client() as client:
            all_resp = await client.get("/api/v1/leads")
            person_resp = await client.get("/api/v1/leads", params={"lead_type": "person"})
        assert len(all_resp.json()["leads"]) == 2
        assert len(person_resp.json()["leads"]) == 1

    async def test_patch_status(self, isolated_db):
        lead = await self._seed(isolated_db)
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/leads/{lead['lead_id']}", json={"status": "contacted"}
            )
        assert resp.status_code == 200
        assert resp.json()["status"] == "contacted"

    async def test_patch_category_override_sets_user_source(self, isolated_db):
        lead = await self._seed(isolated_db)
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/leads/{lead['lead_id']}", json={"suggested_type": "company"}
            )
        body = resp.json()
        assert body["suggested_type"] == "company"
        assert body["category_source"] == "user"
        assert body["category_confidence"] == 1.0

    async def test_patch_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.patch("/api/v1/leads/nope", json={"status": "contacted"})
        assert resp.status_code == 404

    async def test_delete(self, isolated_db):
        lead = await self._seed(isolated_db)
        async with _client() as client:
            resp = await client.delete(f"/api/v1/leads/{lead['lead_id']}")
        assert resp.status_code == 200
        assert await isolated_db.get_lead(lead["lead_id"]) is None


class TestSave:
    async def _seed_person(self, isolated_db):
        lead, _ = await isolated_db.create_lead(
            search_id="s1",
            name="Jane Doe",
            lead_type="person",
            email="jane@acme.com",
            company="Acme Corp",
            linkedin_url="https://www.linkedin.com/in/jane-doe",
            source="linkedin",
            suggested_type="contact",
        )
        return lead

    async def test_save_as_contact(self, isolated_db):
        lead = await self._seed_person(isolated_db)
        async with _client() as client:
            resp = await client.post(
                f"/api/v1/leads/{lead['lead_id']}/save", json={"target": "contact"}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "saved"
        assert body["contact_id"]
        contacts = await isolated_db.list_contacts()
        assert contacts[0]["name"] == "Jane Doe"

    async def test_save_as_contact_with_linked_company(self, isolated_db):
        lead = await self._seed_person(isolated_db)
        async with _client() as client:
            resp = await client.post(
                f"/api/v1/leads/{lead['lead_id']}/save",
                json={"target": "contact", "create_linked_company": True},
            )
        body = resp.json()
        assert body["contact_id"]
        assert body["company_id"]
        companies = await isolated_db.list_companies()
        assert companies[0]["name"] == "Acme Corp"

    async def test_save_as_company(self, isolated_db):
        lead, _ = await isolated_db.create_lead(
            search_id="s1",
            name="Bright Recruiting Agency",
            lead_type="company",
            suggested_type="agency",
            source="web",
        )
        async with _client() as client:
            resp = await client.post(
                f"/api/v1/leads/{lead['lead_id']}/save", json={"target": "company"}
            )
        assert resp.status_code == 200
        companies = await isolated_db.list_companies()
        assert companies[0]["name"] == "Bright Recruiting Agency"
        assert companies[0]["company_type"] == "agency"

    async def test_save_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/leads/nope/save", json={"target": "contact"}
            )
        assert resp.status_code == 404

    async def test_bulk_save(self, isolated_db):
        a = await self._seed_person(isolated_db)
        b, _ = await isolated_db.create_lead(
            search_id="s1", name="John Roe", lead_type="person", source="linkedin"
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/leads/bulk-save",
                json={"lead_ids": [a["lead_id"], b["lead_id"], "ghost"], "target": "contact"},
            )
        body = resp.json()
        assert body["affected"] == 2
        assert any("ghost" in d for d in body["details"])


class TestCriteria:
    async def test_recommend_with_mocked_llm(self, isolated_db, monkeypatch):
        import app.services.lead_scraper as lead_scraper_module

        async def fake_complete_json(prompt, **kwargs):
            return {
                "keywords": ["recruiting agency"],
                "titles": ["Head of Talent"],
                "industries": ["HR"],
                "locations": ["Tunis"],
                "company_types": ["agency"],
                "lead_types": ["person", "agency"],
                "seniorities": ["director"],
                "recency_hint": None,
                "rationale": "test",
            }

        monkeypatch.setattr(lead_scraper_module, "complete_json", fake_complete_json)
        async with _client() as client:
            resp = await client.post("/api/v1/leads/recommend-criteria", json={})
        assert resp.status_code == 200
        body = resp.json()
        assert body["criteria"]["keywords"] == ["recruiting agency"]
        assert "person" in body["criteria"]["lead_types"]

    async def test_recommend_survives_llm_failure(self, isolated_db, monkeypatch):
        import app.services.lead_scraper as lead_scraper_module

        async def boom(prompt, **kwargs):
            raise RuntimeError("LLM down")

        monkeypatch.setattr(lead_scraper_module, "complete_json", boom)
        async with _client() as client:
            resp = await client.post("/api/v1/leads/recommend-criteria", json={})
        assert resp.status_code == 200
        assert resp.json()["criteria"]["rationale"] is not None

    async def test_tracked_names_excluded(self, isolated_db, monkeypatch):
        import app.services.lead_scraper as lead_scraper_module

        await isolated_db.create_contact(name="Known Person")
        await isolated_db.create_company(name="Known Co")

        seen: dict = {}

        async def fake_complete_json(prompt, **kwargs):
            seen["prompt"] = prompt
            return {"keywords": ["x"], "lead_types": ["person"]}

        monkeypatch.setattr(lead_scraper_module, "complete_json", fake_complete_json)
        async with _client() as client:
            resp = await client.post("/api/v1/leads/recommend-criteria", json={})
        assert resp.status_code == 200
        tracked = resp.json()["tracked_names"]
        assert "Known Person" in tracked
        assert "Known Co" in tracked
        assert "Known Person" in seen["prompt"]

    async def test_recommend_uses_goal_and_niche(self, isolated_db, monkeypatch):
        import app.services.lead_scraper as lead_scraper_module

        seen: dict = {}

        async def fake_complete_json(prompt, **kwargs):
            seen["prompt"] = prompt
            return {"keywords": ["fintech CTO"], "lead_types": ["person"]}

        monkeypatch.setattr(lead_scraper_module, "complete_json", fake_complete_json)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/leads/recommend-criteria",
                json={"goal": "selling an ATS", "niche": "fintech startups"},
            )
        assert resp.status_code == 200
        assert "selling an ATS" in seen["prompt"]
        assert "fintech startups" in seen["prompt"]

    async def test_recommend_optimizes_current_params(self, isolated_db, monkeypatch):
        import app.services.lead_scraper as lead_scraper_module

        seen: dict = {}

        async def fake_complete_json(prompt, **kwargs):
            seen["prompt"] = prompt
            return {
                "keywords": ["tech recruiting agency Tunisia"],
                "lead_types": ["agency"],
                "target": "senior recruiters at Tunisian tech agencies",
                "purpose": "outreach for ATS partnership",
                "rationale": "sharpened from the current params",
            }

        monkeypatch.setattr(lead_scraper_module, "complete_json", fake_complete_json)
        async with _client() as client:
            resp = await client.post(
                "/api/v1/leads/recommend-criteria",
                json={
                    "goal": "sell ATS",
                    "current": {
                        "keywords": "recruiting",
                        "target": "recruiters",
                        "locations": ["Tunis"],
                        "lead_types": ["agency"],
                    },
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["criteria"]["target"] == "senior recruiters at Tunisian tech agencies"
        assert body["criteria"]["purpose"] == "outreach for ATS partnership"
        assert body["criteria"]["rationale"] == "sharpened from the current params"
        assert '"keywords": "recruiting"' in seen["prompt"]
        assert '"locations": ["Tunis"]' in seen["prompt"]
        assert '"lead_types": ["agency"]' in seen["prompt"]

    async def test_recommend_without_current_params_says_none(self, isolated_db, monkeypatch):
        import app.services.lead_scraper as lead_scraper_module

        seen: dict = {}

        async def fake_complete_json(prompt, **kwargs):
            seen["prompt"] = prompt
            return {"keywords": ["x"], "lead_types": ["person"]}

        monkeypatch.setattr(lead_scraper_module, "complete_json", fake_complete_json)
        async with _client() as client:
            resp = await client.post("/api/v1/leads/recommend-criteria", json={})
        assert resp.status_code == 200
        assert "CURRENT SEARCH PARAMS" in seen["prompt"]
        assert "none" in seen["prompt"]


class TestDrafts:
    async def test_draft_crud_roundtrip(self, isolated_db):
        payload = {
            "name": "Fintech CTOs",
            "keywords": "fintech CTO",
            "target": "CTOs at fintech startups",
            "purpose": "selling an ATS",
            "locations": ["Tunis", "Paris"],
            "lead_types": ["person"],
            "sources": ["linkedin"],
            "enrich_contacts": False,
        }
        async with _client() as client:
            created = await client.put("/api/v1/leads/drafts", json=payload)
            assert created.status_code == 200
            draft = created.json()
            assert draft["name"] == "Fintech CTOs"
            assert draft["keywords"] == "fintech CTO"
            assert draft["target"] == "CTOs at fintech startups"
            assert draft["locations"] == ["Tunis", "Paris"]
            assert draft["lead_types"] == ["person"]
            assert draft["sources"] == ["linkedin"]
            assert draft["enrich_contacts"] is False

            # GET /leads/drafts must not be swallowed by GET /leads/{lead_id}.
            listed = await client.get("/api/v1/leads/drafts")
            assert listed.status_code == 200
            drafts = listed.json()["drafts"]
            assert [d["draft_id"] for d in drafts] == [draft["draft_id"]]
            assert drafts[0]["name"] == "Fintech CTOs"

            deleted = await client.delete(f"/api/v1/leads/drafts/{draft['draft_id']}")
            assert deleted.status_code == 200
            assert (await client.get("/api/v1/leads/drafts")).json()["drafts"] == []

    async def test_upsert_same_name_overwrites_in_place(self, isolated_db):
        async with _client() as client:
            first = (
                await client.put(
                    "/api/v1/leads/drafts", json={"name": "agency hunt", "keywords": "recruiting"}
                )
            ).json()
            second = (
                await client.put(
                    "/api/v1/leads/drafts",
                    json={
                        "name": "Agency Hunt",
                        "keywords": "marketing agency",
                        "locations": ["Tunis"],
                    },
                )
            ).json()
        assert second["draft_id"] == first["draft_id"]
        assert second["keywords"] == "marketing agency"
        assert second["locations"] == ["Tunis"]
        drafts = await isolated_db.list_lead_search_drafts()
        assert len(drafts) == 1

    async def test_delete_missing_draft_404(self, isolated_db):
        async with _client() as client:
            resp = await client.delete("/api/v1/leads/drafts/ghost")
        assert resp.status_code == 404

    async def test_draft_name_required(self, isolated_db):
        async with _client() as client:
            resp = await client.put("/api/v1/leads/drafts", json={"name": ""})
        assert resp.status_code == 422
