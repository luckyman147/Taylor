"""Tests for MCP database migration (ADDITIVE columns, backfill)."""

import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app.db_engine import init_models_sync


@pytest.fixture
def fresh_db():
    """Create a fresh database and run migration."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)

    engine = create_engine(f"sqlite:///{db_path}", future=True)
    init_models_sync(engine)

    yield engine

    engine.dispose()
    db_path.unlink(missing_ok=True)


@pytest.fixture
def old_schema_db():
    """Create a database with the old schema (no new MCP columns)."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)

    engine = create_engine(f"sqlite:///{db_path}", future=True)

    # Create old schema tables
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE mcp_servers (
                server_id TEXT PRIMARY KEY,
                name TEXT,
                display_name TEXT,
                url TEXT,
                transport TEXT,
                server_type TEXT,
                enabled BOOLEAN,
                status TEXT,
                error_message TEXT,
                tools_json TEXT,
                last_connected_at TEXT,
                health_last_success TEXT,
                health_last_failure TEXT,
                health_consecutive_failures INTEGER,
                health_avg_latency_ms REAL,
                health_total_calls INTEGER,
                health_success_calls INTEGER,
                created_at TEXT,
                updated_at TEXT
            )
        """))
        conn.execute(text("""
            CREATE TABLE mcp_credentials (
                credential_id TEXT PRIMARY KEY,
                server_id TEXT,
                auth_type TEXT,
                auth_config TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """))
        # Insert test data
        conn.execute(text("""
            INSERT INTO mcp_servers VALUES (
                'mcp_test1', 'test_server', 'Test', 'http://test.com',
                'streamable-http', 'custom', 1, 'unknown', NULL, NULL,
                NULL, NULL, NULL, 0, 0.0, 0, 0, '2024-01-01', '2024-01-01'
            )
        """))

    yield engine

    engine.dispose()
    db_path.unlink(missing_ok=True)


class TestFreshDBMigration:
    """Test migration on a fresh database."""

    def test_mcp_servers_has_user_id(self, fresh_db):
        with fresh_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_servers)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "user_id" in col_names

    def test_mcp_servers_has_server_kind(self, fresh_db):
        with fresh_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_servers)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "server_kind" in col_names

    def test_mcp_servers_has_last_error_code(self, fresh_db):
        with fresh_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_servers)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "last_error_code" in col_names

    def test_mcp_credentials_has_per_type_columns(self, fresh_db):
        with fresh_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_credentials)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "encrypted_api_key" in col_names
            assert "encrypted_access_token" in col_names
            assert "oauth_client_id" in col_names

    def test_mcp_tools_table_exists(self, fresh_db):
        with fresh_db.connect() as conn:
            tables = conn.execute(text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_tools'"
            )).fetchone()
            assert tables is not None

    def test_mcp_tools_has_required_columns(self, fresh_db):
        with fresh_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_tools)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "id" in col_names
            assert "server_id" in col_names
            assert "public_name" in col_names
            assert "input_schema" in col_names
            assert "enabled" in col_names


class TestAlterTableMigration:
    """Test ALTER TABLE migration on existing database."""

    def test_adds_user_id_column(self, old_schema_db):
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_servers)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "user_id" in col_names

    def test_adds_server_kind_column(self, old_schema_db):
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_servers)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "server_kind" in col_names

    def test_backfills_server_kind_from_custom(self, old_schema_db):
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            row = conn.execute(text(
                "SELECT server_kind FROM mcp_servers WHERE server_id='mcp_test1'"
            )).fetchone()
            assert row[0] == "remote"

    def test_preserves_existing_data(self, old_schema_db):
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            row = conn.execute(text(
                "SELECT name, url FROM mcp_servers WHERE server_id='mcp_test1'"
            )).fetchone()
            assert row[0] == "test_server"
            assert row[1] == "http://test.com"

    def test_adds_credential_columns(self, old_schema_db):
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            cols = conn.execute(text("PRAGMA table_info(mcp_credentials)")).fetchall()
            col_names = [c[1] for c in cols]
            assert "encrypted_api_key" in col_names
            assert "oauth_token_url" in col_names

    def test_creates_mcp_tools_table(self, old_schema_db):
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            tables = conn.execute(text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_tools'"
            )).fetchone()
            assert tables is not None

    def test_idempotent_migration(self, old_schema_db):
        """Running migration twice should not fail."""
        init_models_sync(old_schema_db)
        init_models_sync(old_schema_db)
        with old_schema_db.connect() as conn:
            row = conn.execute(text(
                "SELECT name FROM mcp_servers WHERE server_id='mcp_test1'"
            )).fetchone()
            assert row[0] == "test_server"
