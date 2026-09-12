"""Integration tests for the contact-tracker API (real isolated DB)."""

import io
import json

from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


PAYLOAD = {
    "name": "Jane Doe",
    "email": "jane.doe@acme.com",
    "company": "Acme Corp",
    "location": "Tunis",
    "goal": "request_referral",
    "status": "follow_up",
    "relationship": "recruiter",
    "follow_up_date": "2026-09-01",
}


class TestList:
    async def test_empty_list(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/contacts")
        assert resp.status_code == 200
        assert resp.json() == {"contacts": []}

    async def test_list_orders_by_name_case_insensitive(self, isolated_db):
        await isolated_db.create_contact(name="Zoe Adams")
        await isolated_db.create_contact(name="amy smith")
        async with _client() as client:
            resp = await client.get("/api/v1/contacts")
        names = [c["name"] for c in resp.json()["contacts"]]
        assert names == ["amy smith", "Zoe Adams"]


class TestCreate:
    async def test_create_full_payload(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/contacts", json=PAYLOAD)
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Jane Doe"
        assert body["email"] == "jane.doe@acme.com"
        assert body["company"] == "Acme Corp"
        assert body["location"] == "Tunis"
        assert body["goal"] == "request_referral"
        assert body["status"] == "follow_up"
        assert body["relationship"] == "recruiter"
        assert body["follow_up_date"] == "2026-09-01"

    async def test_create_minimal_payload(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/contacts", json={"name": "Solo"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Solo"
        assert body["email"] is None
        assert body["goal"] is None
        assert body["status"] is None

    async def test_create_accepts_contacted_status_and_email(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts", json={"name": "Recruiter X", "email": "r@acme.com", "status": "contacted"}
            )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == "r@acme.com"
        assert body["status"] == "contacted"

    async def test_create_requires_name(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/contacts", json={"company": "Acme Corp"})
        assert resp.status_code == 422

    async def test_create_duplicate_name_is_idempotent(self, isolated_db):
        async with _client() as client:
            first = await client.post("/api/v1/contacts", json={"name": "Jane Doe"})
            second = await client.post("/api/v1/contacts", json={"name": "jane doe"})
        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["contact_id"] == second.json()["contact_id"]

    async def test_create_rejects_invalid_enum_value(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts", json={"name": "Jane", "goal": "not-a-goal"}
            )
        assert resp.status_code == 422

    async def test_create_rejects_invalid_follow_up_date(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts", json={"name": "Jane", "follow_up_date": "09/01/26"}
            )
        assert resp.status_code == 422


class TestDetail:
    async def test_get_contact(self, isolated_db):
        created = await isolated_db.create_contact(name="Jane Doe")
        async with _client() as client:
            resp = await client.get(f"/api/v1/contacts/{created['contact_id']}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Jane Doe"

    async def test_get_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/contacts/nope")
        assert resp.status_code == 404


class TestUpdate:
    async def test_partial_update(self, isolated_db):
        created = await isolated_db.create_contact(name="Jane Doe", goal="networking")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/contacts/{created['contact_id']}",
                json={
                    "company": "Beta Inc",
                    "goal": "informational_interview",
                    "status": "meeting_scheduled",
                    "follow_up_date": "2026-10-15",
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["company"] == "Beta Inc"
        assert body["goal"] == "informational_interview"
        assert body["status"] == "meeting_scheduled"
        assert body["follow_up_date"] == "2026-10-15"
        assert body["name"] == "Jane Doe"  # untouched fields preserved

    async def test_update_clears_fields_with_null(self, isolated_db):
        created = await isolated_db.create_contact(name="Jane Doe", company="Acme Corp")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/contacts/{created['contact_id']}",
                json={"company": None, "goal": None},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["company"] is None
        assert body["goal"] is None

    async def test_update_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.patch("/api/v1/contacts/nope", json={"company": "X"})
        assert resp.status_code == 404

    async def test_update_email_and_contacted_status(self, isolated_db):
        created = await isolated_db.create_contact(name="Jane Doe", status="to_contact")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/contacts/{created['contact_id']}",
                json={"email": "jane@example.org", "status": "contacted"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == "jane@example.org"
        assert body["status"] == "contacted"
        assert body["name"] == "Jane Doe"

    async def test_rename_to_duplicate_returns_409(self, isolated_db):
        a = await isolated_db.create_contact(name="Jane Doe")
        await isolated_db.create_contact(name="Beth Kim")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/contacts/{a['contact_id']}",
                json={"name": "beth kim"},
            )
        assert resp.status_code == 409


class TestDelete:
    async def test_delete_contact(self, isolated_db):
        created = await isolated_db.create_contact(name="Jane Doe")
        async with _client() as client:
            resp = await client.delete(f"/api/v1/contacts/{created['contact_id']}")
        assert resp.status_code == 200
        assert resp.json()["affected"] == 1
        assert await isolated_db.get_contact(created["contact_id"]) is None

    async def test_delete_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.delete("/api/v1/contacts/nope")
        assert resp.status_code == 404

    async def test_bulk_delete(self, isolated_db):
        first = await isolated_db.create_contact(name="Jane Doe")
        second = await isolated_db.create_contact(name="Beth Kim")
        third = await isolated_db.create_contact(name="Zoe Adams")
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts/bulk-delete",
                json={"contact_ids": [first["contact_id"], second["contact_id"], "missing"]},
            )
        assert resp.status_code == 200
        assert resp.json()["affected"] == 2
        assert await isolated_db.get_contact(first["contact_id"]) is None
        assert await isolated_db.get_contact(second["contact_id"]) is None
        assert await isolated_db.get_contact(third["contact_id"]) is not None


CSV_HEADER = "name,email,company,location,goal,status,relationship,follow_up_date"


class TestImport:
    async def _upload(self, client: AsyncClient, filename: str, content: bytes):
        return await client.post(
            "/api/v1/contacts/import",
            files={"file": (filename, content)},
        )

    async def test_import_csv_creates_contacts(self, isolated_db):
        csv_content = (
            f"{CSV_HEADER}\n"
            "Jane Doe,jane@acme.com,Acme Corp,Tunis,request_referral,follow_up,recruiter,2026-09-01\n"
            "Beth Kim,,,,networking,to_contact,friend,\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "contacts.csv", csv_content)
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 2
        assert body["skipped"] == 0
        assert body["errors"] == []
        jane = await isolated_db.get_contact_by_name("Jane Doe")
        assert jane["email"] == "jane@acme.com"
        assert jane["company"] == "Acme Corp"
        assert jane["goal"] == "request_referral"
        assert jane["status"] == "follow_up"
        assert jane["relationship"] == "recruiter"
        assert jane["follow_up_date"] == "2026-09-01"

    async def test_import_skips_existing_names_case_insensitive(self, isolated_db):
        await isolated_db.create_contact(name="Jane Doe")
        csv_content = (
            f"{CSV_HEADER}\n"
            "jane doe,hr@acme.test,,,,,,\n"
            "New Person,,,,,,,\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "contacts.csv", csv_content)
        body = resp.json()
        assert body["created"] == 1
        assert body["skipped"] == 1
        jane = await isolated_db.get_contact_by_name("Jane Doe")
        assert jane["company"] is None

    async def test_import_reports_per_row_errors(self, isolated_db):
        csv_content = (
            f"{CSV_HEADER}\n"
            ",,Acme Corp,,,,,\n"
            "Bad Goal,,,,not-a-goal,,,\n"
            "Bad Status,,,,,not-a-status,,\n"
            "Bad Relation,,,,,,not-a-relation,\n"
            "Bad Date,,,,,,,2026-13-45\n"
            "Good Person,,,,networking,to_contact,friend,2026-01-10\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "contacts.csv", csv_content)
        body = resp.json()
        assert body["created"] == 1
        assert body["skipped"] == 0
        rows = [e["row"] for e in body["errors"]]
        assert rows == [2, 3, 4, 5, 6]
        assert body["errors"][0]["name"] is None  # missing-name row

    async def test_import_accepts_friendly_values(self, isolated_db):
        csv_content = (
            f"{CSV_HEADER}\n"
            "Recruiter Pal,recruiter@x.com,,,networking,follow-up,Alumni,2026-08-01\n"
            "Hiring Mgr,hiring@x.com,,,informational interview,Meeting Scheduled,Hiring Manager,20/08/2026\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "contacts.csv", csv_content)
        body = resp.json()
        assert body["created"] == 2
        assert body["errors"] == []
        first = await isolated_db.get_contact_by_name("Recruiter Pal")
        assert first["email"] == "recruiter@x.com"
        assert first["status"] == "follow_up"
        assert first["relationship"] == "alumni"
        second = await isolated_db.get_contact_by_name("Hiring Mgr")
        assert second["goal"] == "informational_interview"
        assert second["status"] == "meeting_scheduled"
        assert second["relationship"] == "hiring_manager"
        assert second["follow_up_date"] == "2026-08-20"

    async def test_import_excel_xlsx(self, isolated_db):
        from openpyxl import Workbook

        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Name", "Company", "Location", "Goal"])
        sheet.append(["Xlsx Person", "Fintech Co", "Paris", "research_career"])
        sheet.append(["Xlsx Two", "", "", ""])
        buffer = io.BytesIO()
        workbook.save(buffer)
        async with _client() as client:
            resp = await self._upload(client, "contacts.xlsx", buffer.getvalue())
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 2
        assert body["errors"] == []
        xlsx = await isolated_db.get_contact_by_name("Xlsx Person")
        assert xlsx["company"] == "Fintech Co"
        assert xlsx["goal"] == "research_career"

    async def test_import_rejects_unsupported_extension(self, isolated_db):
        async with _client() as client:
            resp = await self._upload(client, "contacts.txt", b"name\nJane\n")
        assert resp.status_code == 422

    async def test_import_with_mapping_uses_mapped_columns_only(self, isolated_db):
        csv_content = (
            "Full Name,Organization,City,Objective\n"
            "Mapped Person,Acme Corp,Tunis,request_referral\n"
        ).encode("utf-8")
        mapping = json.dumps(
            {"name": "Full Name", "company": "Organization", "location": "City"}
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts/import",
                files={
                    "file": ("contacts.csv", csv_content),
                    "mapping": (None, mapping),
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 1
        assert body["errors"] == []
        mapped = await isolated_db.get_contact_by_name("Mapped Person")
        assert mapped["company"] == "Acme Corp"
        assert mapped["location"] == "Tunis"
        # Unmapped fields stay empty even if a header would have matched.
        assert mapped["goal"] is None

    async def test_import_mapping_rejects_invalid_json(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts/import",
                files={
                    "file": ("contacts.csv", b"name\nAcme\n"),
                    "mapping": (None, "not-json"),
                },
            )
        assert resp.status_code == 422

    async def test_import_headers_endpoint(self, isolated_db):
        csv_content = (
            "Full Name,Organization,Follow-up\nAcme,Acme Corp,2026-09-01\n".encode("utf-8")
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/contacts/import/headers",
                files={"file": ("contacts.csv", csv_content)},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["headers"] == ["Full Name", "Organization", "Follow-up"]
        assert body["detected"]["name"] == "Full Name"
        assert body["detected"]["company"] == "Organization"
        assert body["detected"]["follow_up_date"] == "Follow-up"
        # No rows were written.
        assert await isolated_db.list_contacts() == []

    async def test_import_semicolon_csv_detects_columns(self, isolated_db):
        csv_content = (
            "Nom;Entreprise;Ville\n"
            '"Jane Doe";Acme Corp;Tunis\n'
        ).encode("utf-8")
        async with _client() as client:
            headers_resp = await client.post(
                "/api/v1/contacts/import/headers",
                files={"file": ("contacts.csv", csv_content)},
            )
        assert headers_resp.status_code == 200
        assert headers_resp.json()["headers"] == ["Nom", "Entreprise", "Ville"]
        mapping = json.dumps({"name": "Nom", "company": "Entreprise", "location": "Ville"})
        async with _client() as client:
            import_resp = await client.post(
                "/api/v1/contacts/import",
                files={
                    "file": ("contacts.csv", csv_content),
                    "mapping": (None, mapping),
                },
            )
        assert import_resp.status_code == 200
        body = import_resp.json()
        assert body["created"] == 1
        assert body["errors"] == []
        jane = await isolated_db.get_contact_by_name("Jane Doe")
        assert jane["company"] == "Acme Corp"
        assert jane["location"] == "Tunis"