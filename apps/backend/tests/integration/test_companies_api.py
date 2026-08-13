"""Integration tests for the company-tracker API (real isolated DB)."""

import io
import json

from httpx import ASGITransport, AsyncClient

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


PAYLOAD = {
    "name": "Acme Corp",
    "email": "jobs@acme.test",
    "phone": "+216 71 234 567",
    "address": "14 Rue de la Source, Tunis",
    "website": "https://acme.test",
    "company_size": "51-200",
    "company_type": "enterprise",
    "linkedin_url": "https://linkedin.com/company/acme",
    "industry": "SaaS",
    "year_founded": 1999,
}


class TestList:
    async def test_empty_list(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/companies")
        assert resp.status_code == 200
        assert resp.json() == {"companies": []}

    async def test_list_orders_by_name_case_insensitive(self, isolated_db):
        await isolated_db.create_company(name="Zebra Inc")
        await isolated_db.create_company(name="apple inc")
        async with _client() as client:
            resp = await client.get("/api/v1/companies")
        names = [c["name"] for c in resp.json()["companies"]]
        assert names == ["apple inc", "Zebra Inc"]


class TestCreate:
    async def test_create_full_payload(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/companies", json=PAYLOAD)
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Acme Corp"
        assert body["company_size"] == "51-200"
        assert body["company_type"] == "enterprise"
        assert body["year_founded"] == 1999
        assert body["email"] == "jobs@acme.test"
        assert body["phone"] == "+216 71 234 567"
        assert body["address"] == "14 Rue de la Source, Tunis"

    async def test_create_minimal_payload(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/companies", json={"name": "Solo"})
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Solo"
        assert body["company_size"] is None
        assert body["company_type"] is None

    async def test_create_requires_name(self, isolated_db):
        async with _client() as client:
            resp = await client.post("/api/v1/companies", json={"email": "x@y.test"})
        assert resp.status_code == 422

    async def test_create_duplicate_name_is_idempotent(self, isolated_db):
        async with _client() as client:
            first = await client.post("/api/v1/companies", json={"name": "Acme Corp"})
            second = await client.post("/api/v1/companies", json={"name": "acme corp"})
        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["company_id"] == second.json()["company_id"]


class TestDetail:
    async def test_get_company(self, isolated_db):
        created = await isolated_db.create_company(name="Acme Corp")
        async with _client() as client:
            resp = await client.get(f"/api/v1/companies/{created['company_id']}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Acme Corp"

    async def test_get_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.get("/api/v1/companies/nope")
        assert resp.status_code == 404


class TestUpdate:
    async def test_partial_update(self, isolated_db):
        created = await isolated_db.create_company(name="Acme Corp", industry="AI")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/companies/{created['company_id']}",
                json={
                    "industry": "SaaS",
                    "company_size": "1000+",
                    "phone": "+216 71 234 567",
                    "address": "14 Rue de la Source, Tunis",
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["industry"] == "SaaS"
        assert body["company_size"] == "1000+"
        assert body["phone"] == "+216 71 234 567"
        assert body["address"] == "14 Rue de la Source, Tunis"
        assert body["name"] == "Acme Corp"  # untouched fields preserved

    async def test_update_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.patch("/api/v1/companies/nope", json={"industry": "X"})
        assert resp.status_code == 404

    async def test_rename_to_duplicate_returns_409(self, isolated_db):
        a = await isolated_db.create_company(name="Acme Corp")
        await isolated_db.create_company(name="Beta Inc")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/companies/{a['company_id']}",
                json={"name": "beta inc"},
            )
        assert resp.status_code == 409

    async def test_rejects_invalid_year(self, isolated_db):
        created = await isolated_db.create_company(name="Acme Corp")
        async with _client() as client:
            resp = await client.patch(
                f"/api/v1/companies/{created['company_id']}",
                json={"year_founded": 1500},
            )
        assert resp.status_code == 422


class TestDelete:
    async def test_delete_company(self, isolated_db):
        created = await isolated_db.create_company(name="Acme Corp")
        async with _client() as client:
            resp = await client.delete(f"/api/v1/companies/{created['company_id']}")
        assert resp.status_code == 200
        assert resp.json()["affected"] == 1
        assert await isolated_db.get_company(created["company_id"]) is None

    async def test_delete_missing_returns_404(self, isolated_db):
        async with _client() as client:
            resp = await client.delete("/api/v1/companies/nope")
        assert resp.status_code == 404


CSV_HEADER = "name,email,website,company_size,company_type,linkedin_url,industry,year_founded"


class TestImport:
    async def _upload(self, client: AsyncClient, filename: str, content: bytes):
        return await client.post(
            "/api/v1/companies/import",
            files={"file": (filename, content)},
        )

    async def test_import_csv_creates_companies(self, isolated_db):
        csv_content = (
            f"{CSV_HEADER}\n"
            'Acme Corp,jobs@acme.test,https://acme.test,51-200,enterprise,https://linkedin.com/company/acme,SaaS,1999\n'
            "Beta Inc,,,1-10,startup,,,2021\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "companies.csv", csv_content)
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 2
        assert body["skipped"] == 0
        assert body["errors"] == []
        acme = await isolated_db.get_company_by_name("Acme Corp")
        assert acme["email"] == "jobs@acme.test"
        assert acme["company_size"] == "51-200"
        assert acme["year_founded"] == 1999

    async def test_import_skips_existing_names_case_insensitive(self, isolated_db):
        await isolated_db.create_company(name="Acme Corp")
        csv_content = (
            f"{CSV_HEADER}\n"
            "acme corp,hr@acme.test,,,,,,\n"
            "New Co,,,,,,,\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "companies.csv", csv_content)
        body = resp.json()
        assert body["created"] == 1
        assert body["skipped"] == 1
        # Existing row untouched, new row created.
        acme = await isolated_db.get_company_by_name("Acme Corp")
        assert acme["email"] is None

    async def test_import_reports_per_row_errors(self, isolated_db):
        csv_content = (
            f"{CSV_HEADER}\n"
            ",,,enterprise,,,\n"
            "Bad Size,,,999-999,,,,\n"
            "Bad Type,,,,government-ish,,,\n"
            "Bad Year,,,,,,,abc\n"
            "Good Co,,,11-50,startup,,,2020\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "companies.csv", csv_content)
        body = resp.json()
        assert body["created"] == 1
        assert body["skipped"] == 0
        rows = [e["row"] for e in body["errors"]]
        assert rows == [2, 3, 4, 5]
        assert body["errors"][0]["name"] is None  # missing-name row

    async def test_import_accepts_friendly_size_values(self, isolated_db):
        csv_content = (
            f"{CSV_HEADER}\n"
            "Friendly Co,,,51-200 employees,,,,\n"
            "Plain Co,,,1000+,,,,\n"
            "Strict Co,,,201-1000,enterprise,,,2010\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "companies.csv", csv_content)
        body = resp.json()
        assert body["created"] == 3
        assert body["errors"] == []
        friendly = await isolated_db.get_company_by_name("Friendly Co")
        assert friendly["company_size"] == "51-200"

    async def test_import_excel_xlsx(self, isolated_db):
        from openpyxl import Workbook

        workbook = Workbook()
        sheet = workbook.active
        sheet.append(["Company Name", "Email", "Industry", "Founded"])
        sheet.append(["Xlsx Corp", "x@y.test", "Fintech", "2015"])
        sheet.append(["Xlsx Two", "", "Health", ""])
        buffer = io.BytesIO()
        workbook.save(buffer)
        async with _client() as client:
            resp = await self._upload(client, "companies.xlsx", buffer.getvalue())
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 2
        assert body["errors"] == []
        xlsx = await isolated_db.get_company_by_name("Xlsx Corp")
        assert xlsx["industry"] == "Fintech"
        assert xlsx["year_founded"] == 2015

    async def test_import_rejects_unsupported_extension(self, isolated_db):
        async with _client() as client:
            resp = await self._upload(client, "companies.txt", b"name\nAcme\n")
        assert resp.status_code == 422

    async def test_import_rejects_empty_file(self, isolated_db):
        async with _client() as client:
            resp = await self._upload(client, "companies.csv", b"")

    async def test_import_phone_address_via_aliases(self, isolated_db):
        csv_content = (
            "name,phone,address\n"
            "Acme Corp,+216 71 234 567,\"14 Rue de la Source, Tunis\"\n"
        ).encode("utf-8")
        async with _client() as client:
            resp = await self._upload(client, "companies.csv", csv_content)
        assert resp.status_code == 200
        assert resp.json()["created"] == 1
        acme = await isolated_db.get_company_by_name("Acme Corp")
        assert acme["phone"] == "+216 71 234 567"
        assert acme["address"] == "14 Rue de la Source, Tunis"

    async def test_import_with_mapping_uses_mapped_columns_only(self, isolated_db):
        csv_content = (
            "Company Name,Phone Number,Office Location\n"
            'Mapped Co,+1 555 0100,"100 Main St, Suite 1"\n'
        ).encode("utf-8")
        mapping = json.dumps(
            {"name": "Company Name", "phone": "Phone Number", "address": "Office Location"}
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/companies/import",
                files={
                    "file": ("companies.csv", csv_content),
                    "mapping": (None, mapping),
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["created"] == 1
        assert body["errors"] == []
        mapped = await isolated_db.get_company_by_name("Mapped Co")
        assert mapped["phone"] == "+1 555 0100"
        assert mapped["address"] == "100 Main St, Suite 1"
        # Unmapped fields stay empty even if a header would have matched.
        assert mapped["email"] is None
        assert mapped["website"] is None

    async def test_import_mapping_only_imports_mapped_fields(self, isolated_db):
        # The CSV has an email column but the mapping does not map it.
        csv_content = (
            "Company Name,email\n"
            "Partial Co,secret@example.test\n"
        ).encode("utf-8")
        mapping = json.dumps({"name": "Company Name"})
        async with _client() as client:
            resp = await client.post(
                "/api/v1/companies/import",
                files={
                    "file": ("companies.csv", csv_content),
                    "mapping": (None, mapping),
                },
            )
        assert resp.status_code == 200
        assert resp.json()["created"] == 1
        partial = await isolated_db.get_company_by_name("Partial Co")
        assert partial["email"] is None

    async def test_import_mapping_rejects_invalid_json(self, isolated_db):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/companies/import",
                files={
                    "file": ("companies.csv", b"name\nAcme\n"),
                    "mapping": (None, "not-json"),
                },
            )
        assert resp.status_code == 422

    async def test_import_headers_endpoint(self, isolated_db):
        csv_content = "Company Name,Phone Number,Website URL\nAcme,123,https://acme.test\n".encode(
            "utf-8"
        )
        async with _client() as client:
            resp = await client.post(
                "/api/v1/companies/import/headers",
                files={"file": ("companies.csv", csv_content)},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["headers"] == ["Company Name", "Phone Number", "Website URL"]
        assert body["detected"]["name"] == "Company Name"
        assert body["detected"]["phone"] == "Phone Number"
        assert body["detected"]["website"] == "Website URL"
        # No rows were written.
        assert await isolated_db.list_companies() == []

    async def test_import_semicolon_csv_detects_columns(self, isolated_db):
        # Excel locale exports use ';' as the delimiter — columns must be
        # detected and imported as if they were comma-separated.
        csv_content = (
            "Société;Téléphone;Adresse\n"
            '"Acme SARL";+216 71 234 567;"14 Rue de la Source, Tunis"\n'
        ).encode("utf-8")
        async with _client() as client:
            headers_resp = await client.post(
                "/api/v1/companies/import/headers",
                files={"file": ("companies.csv", csv_content)},
            )
        assert headers_resp.status_code == 200
        assert headers_resp.json()["headers"] == ["Société", "Téléphone", "Adresse"]
        mapping = json.dumps(
            {"name": "Société", "phone": "Téléphone", "address": "Adresse"}
        )
        async with _client() as client:
            import_resp = await client.post(
                "/api/v1/companies/import",
                files={
                    "file": ("companies.csv", csv_content),
                    "mapping": (None, mapping),
                },
            )
        assert import_resp.status_code == 200
        body = import_resp.json()
        assert body["created"] == 1
        assert body["errors"] == []
        acme = await isolated_db.get_company_by_name("Acme SARL")
        assert acme["phone"] == "+216 71 234 567"
        assert acme["address"] == "14 Rue de la Source, Tunis"
