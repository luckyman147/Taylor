"""Tests for company city/country columns (additive migration + address backfill)."""

import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app.db_engine import init_models_sync
from app.import_utils import split_address_into_city_country


class TestSplitAddress:
    """Pure parser for guessing (city, country) out of a free-text address."""

    def test_three_segments_splits_city_and_country(self):
        assert split_address_into_city_country("1 Infinite Loop, Cupertino, USA") == (
            "Cupertino",
            "USA",
        )

    def test_city_country_pair(self):
        assert split_address_into_city_country("Tunis, Tunisia") == ("Tunis", "Tunisia")

    def test_two_word_city_with_country(self):
        assert split_address_into_city_country("New York, USA") == ("New York", "USA")

    def test_street_city_pair_yields_city_only(self):
        assert split_address_into_city_country("14 Rue de la Source, Tunis") == ("Tunis", None)

    def test_semicolon_separator(self):
        assert split_address_into_city_country("Berlin; Germany") == ("Berlin", "Germany")

    def test_single_segment_yields_nothing(self):
        assert split_address_into_city_country("Berlin") == (None, None)

    def test_empty_yields_nothing(self):
        assert split_address_into_city_country("") == (None, None)

    def test_surrounding_whitespace_is_trimmed(self):
        assert split_address_into_city_country(" Paris , France ") == ("Paris", "France")


@pytest.fixture
def old_schema_companies_db():
    """A database whose companies table predates the city/country columns."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)

    engine = create_engine(f"sqlite:///{db_path}", future=True)
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE companies (
                company_id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                email TEXT,
                phone TEXT,
                address TEXT,
                website TEXT,
                company_size TEXT,
                company_type TEXT,
                linkedin_url TEXT,
                industry TEXT,
                status TEXT,
                year_founded INTEGER,
                description TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """))
        conn.execute(
            text(
                "INSERT INTO companies (company_id, name, address, created_at, updated_at) "
                "VALUES (:id, :name, :address, '2024-01-01', '2024-01-01')"
            ),
            {"id": "c1", "name": "Street Co", "address": "14 Rue de la Source, Tunis"},
        )
        conn.execute(
            text(
                "INSERT INTO companies (company_id, name, address, created_at, updated_at) "
                "VALUES (:id, :name, :address, '2024-01-01', '2024-01-01')"
            ),
            {"id": "c2", "name": "Pair Co", "address": "Tunis, Tunisia"},
        )
        conn.execute(
            text(
                "INSERT INTO companies (company_id, name, address, created_at, updated_at) "
                "VALUES (:id, :name, :address, '2024-01-01', '2024-01-01')"
            ),
            {"id": "c3", "name": "NoAddress Co", "address": None},
        )
        conn.execute(
            text(
                "INSERT INTO companies (company_id, name, address, created_at, updated_at) "
                "VALUES (:id, :name, :address, '2024-01-01', '2024-01-01')"
            ),
            {"id": "c4", "name": "Single Co", "address": "Berlin"},
        )

    yield engine

    engine.dispose()
    db_path.unlink(missing_ok=True)


class TestCityCountryMigration:
    """ALTER TABLE + one-time backfill from legacy free-text addresses."""

    def test_adds_city_and_country_columns(self, old_schema_companies_db):
        init_models_sync(old_schema_companies_db)
        with old_schema_companies_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(companies)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "city" in col_names
            assert "country" in col_names

    def test_backfills_city_from_street_city_address(self, old_schema_companies_db):
        init_models_sync(old_schema_companies_db)
        with old_schema_companies_db.connect() as conn:
            row = conn.execute(
                text("SELECT city, country FROM companies WHERE company_id = 'c1'")
            ).fetchone()
            assert row[0] == "Tunis"
            assert row[1] is None

    def test_backfills_city_and_country_pair(self, old_schema_companies_db):
        init_models_sync(old_schema_companies_db)
        with old_schema_companies_db.connect() as conn:
            row = conn.execute(
                text("SELECT city, country FROM companies WHERE company_id = 'c2'")
            ).fetchone()
            assert row[0] == "Tunis"
            assert row[1] == "Tunisia"

    def test_rows_without_usable_address_stay_empty(self, old_schema_companies_db):
        init_models_sync(old_schema_companies_db)
        with old_schema_companies_db.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT company_id, city, country FROM companies "
                    "WHERE company_id IN ('c3', 'c4')"
                )
            ).fetchall()
            assert all(row[1] is None and row[2] is None for row in rows)

    def test_preserves_existing_columns_and_is_idempotent(self, old_schema_companies_db):
        init_models_sync(old_schema_companies_db)
        with old_schema_companies_db.begin() as conn:
            conn.execute(
                text("UPDATE companies SET city = 'Hand-edited' WHERE company_id = 'c2'")
            )
        # Second run must not clobber the manual edit (backfill only fires
        # when the columns are missing, i.e. the first migration run).
        init_models_sync(old_schema_companies_db)
        with old_schema_companies_db.connect() as conn:
            row = conn.execute(
                text("SELECT name, city FROM companies WHERE company_id = 'c2'")
            ).fetchone()
            assert row[0] == "Pair Co"
            assert row[1] == "Hand-edited"
