"""SQLite engine/session plumbing for the SQLAlchemy data layer.

Every ``Database`` instance owns its own engines (one async for the document
tables, one sync for the encrypted ``api_keys`` table read on the synchronous
LLM hot path) built from these factories. Keeping construction here lets tests
spin up fully isolated engines against a temp-file database.
"""

from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.import_utils import split_address_into_city_country
from app.models import Base

__all__ = ["Base", "make_async_engine", "make_sync_engine", "init_models_sync"]


def _apply_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
    """Set per-connection SQLite PRAGMAs.

    WAL improves concurrent read/write between the async (doc tables) and sync
    (api_keys) engines pointed at the same file; ``busy_timeout`` rides out the
    brief lock contention that creates; ``foreign_keys`` enforces relational
    integrity (off by default in SQLite).
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


def _url(path: Path, *, driver: str) -> str:
    """Build a SQLite URL. Absolute paths yield the required four slashes."""
    return f"sqlite+{driver}:///{path}" if driver else f"sqlite:///{path}"


def make_async_engine(path: Path) -> AsyncEngine:
    """Create the async engine (``aiosqlite``) for the document tables."""
    engine = create_async_engine(_url(path, driver="aiosqlite"), future=True)
    event.listen(engine.sync_engine, "connect", _apply_sqlite_pragmas)
    return engine


def make_sync_engine(path: Path) -> Engine:
    """Create the sync engine used for the encrypted api_keys table.

    Key reads happen synchronously (``get_llm_config`` → ``load_config_file`` →
    ``resolve_api_key``), so a sync engine avoids threading async through
    ``llm.py``. It points at the same file as the async engine.
    """
    engine = create_engine(_url(path, driver=""), future=True)
    event.listen(engine, "connect", _apply_sqlite_pragmas)
    return engine


def init_models_sync(engine: Engine) -> None:
    """Create all tables (idempotent) using a sync engine connection."""
    Base.metadata.create_all(engine)

    # ``create_all`` does not ALTER existing SQLite tables. Keep this additive
    # migration idempotent so older local databases can load resumes safely.
    with engine.begin() as conn:
        # Multi-master support: drop the partial unique index that enforced
        # the single-master invariant (removed from ``Resume.__table_args__``).
        conn.exec_driver_sql("DROP INDEX IF EXISTS ux_resumes_single_master")

        columns = conn.exec_driver_sql("PRAGMA table_info(resumes)").mappings().all()
        if columns and "interview_prep" not in {column["name"] for column in columns}:
            conn.exec_driver_sql("ALTER TABLE resumes ADD COLUMN interview_prep TEXT")
        if columns and "metadata_json" not in {column["name"] for column in columns}:
            conn.exec_driver_sql("ALTER TABLE resumes ADD COLUMN metadata_json JSON")

        # Add applied columns to scraped_jobs table
        scraped_columns = conn.exec_driver_sql("PRAGMA table_info(scraped_jobs)").mappings().all()
        if scraped_columns:
            scraped_col_names = {column["name"] for column in scraped_columns}
            if "applied" not in scraped_col_names:
                conn.exec_driver_sql("ALTER TABLE scraped_jobs ADD COLUMN applied BOOLEAN DEFAULT 0")
            if "applied_resume_id" not in scraped_col_names:
                conn.exec_driver_sql("ALTER TABLE scraped_jobs ADD COLUMN applied_resume_id TEXT")
            if "archived" not in scraped_col_names:
                conn.exec_driver_sql("ALTER TABLE scraped_jobs ADD COLUMN archived BOOLEAN DEFAULT 0")
            if "metadata_json" not in scraped_col_names:
                conn.exec_driver_sql("ALTER TABLE scraped_jobs ADD COLUMN metadata_json TEXT")

        # Add contact columns to companies table
        company_columns = conn.exec_driver_sql("PRAGMA table_info(companies)").mappings().all()
        if company_columns:
            company_col_names = {column["name"] for column in company_columns}
            if "phone" not in company_col_names:
                conn.exec_driver_sql("ALTER TABLE companies ADD COLUMN phone TEXT")
            if "address" not in company_col_names:
                conn.exec_driver_sql("ALTER TABLE companies ADD COLUMN address TEXT")
            if "status" not in company_col_names:
                conn.exec_driver_sql("ALTER TABLE companies ADD COLUMN status TEXT")
            if "description" not in company_col_names:
                conn.exec_driver_sql("ALTER TABLE companies ADD COLUMN description TEXT")
            if "city" not in company_col_names:
                conn.exec_driver_sql("ALTER TABLE companies ADD COLUMN city TEXT")
            if "country" not in company_col_names:
                conn.exec_driver_sql("ALTER TABLE companies ADD COLUMN country TEXT")
            # One-time backfill: guess city/country from legacy free-text
            # addresses when the columns were just added (fresh databases get
            # them from the model and have no rows to backfill).
            if "city" not in company_col_names or "country" not in company_col_names:
                stale = conn.exec_driver_sql(
                    "SELECT company_id, address FROM companies "
                    "WHERE address IS NOT NULL AND address != '' "
                    "AND city IS NULL AND country IS NULL"
                ).mappings().all()
                for row in stale:
                    city, country = split_address_into_city_country(row["address"])
                    if city or country:
                        conn.exec_driver_sql(
                            "UPDATE companies SET city = ?, country = ? WHERE company_id = ?",
                            (city, country, row["company_id"]),
                        )

        # Add email column to contacts table
        contact_columns = conn.exec_driver_sql("PRAGMA table_info(contacts)").mappings().all()
        if contact_columns:
            contact_col_names = {column["name"] for column in contact_columns}
            if "email" not in contact_col_names:
                conn.exec_driver_sql("ALTER TABLE contacts ADD COLUMN email TEXT")
            if "description" not in contact_col_names:
                conn.exec_driver_sql("ALTER TABLE contacts ADD COLUMN description TEXT")
            if "linkedin_url" not in contact_col_names:
                conn.exec_driver_sql("ALTER TABLE contacts ADD COLUMN linkedin_url TEXT")
            if "website_url" not in contact_col_names:
                conn.exec_driver_sql("ALTER TABLE contacts ADD COLUMN website_url TEXT")

        # Outreach-analytics columns on sent_emails (contact linkage, purpose,
        # mode, outcome). Additive + idempotent like every other block here.
        sent_email_columns = conn.exec_driver_sql("PRAGMA table_info(sent_emails)").mappings().all()
        if sent_email_columns:
            sent_col_names = {column["name"] for column in sent_email_columns}
            if "contact_id" not in sent_col_names:
                conn.exec_driver_sql("ALTER TABLE sent_emails ADD COLUMN contact_id TEXT")
            if "purpose" not in sent_col_names:
                conn.exec_driver_sql("ALTER TABLE sent_emails ADD COLUMN purpose TEXT")
            if "email_mode" not in sent_col_names:
                conn.exec_driver_sql("ALTER TABLE sent_emails ADD COLUMN email_mode TEXT")
            if "outcome" not in sent_col_names:
                conn.exec_driver_sql(
                    "ALTER TABLE sent_emails ADD COLUMN outcome TEXT DEFAULT 'pending'"
                )
            if "outcome_note" not in sent_col_names:
                conn.exec_driver_sql("ALTER TABLE sent_emails ADD COLUMN outcome_note TEXT")
            if "outcome_at" not in sent_col_names:
                conn.exec_driver_sql("ALTER TABLE sent_emails ADD COLUMN outcome_at TEXT")
            # Indexes for the analytics filters (create_all only covers new DBs).
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_sent_emails_contact_id ON sent_emails (contact_id)"
            )
            conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_sent_emails_outcome ON sent_emails (outcome)"
            )
            # One-time backfill: contact sends historically stored no contact
            # link and only company_name — match them by recipient email.
            if "contact_id" in sent_col_names:
                conn.exec_driver_sql(
                    "UPDATE sent_emails SET contact_id = ("
                    "  SELECT c.contact_id FROM contacts c"
                    "  WHERE lower(c.email) = lower(sent_emails.recipient_email)"
                    "  LIMIT 1"
                    ") WHERE contact_id IS NULL AND (company_id IS NULL OR company_id = '')"
                )
            # Normalize legacy rows to the default outcome.
            conn.exec_driver_sql(
                "UPDATE sent_emails SET outcome = 'pending' WHERE outcome IS NULL"
            )

        # Singleton table holding the latest AI outreach analysis (id is
        # always 1; each successful analysis upserts the row).
        conn.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS outreach_analysis ("
            "id INTEGER PRIMARY KEY,"
            "created_at TEXT NOT NULL,"
            "report_json TEXT NOT NULL,"
            "emails_analyzed INTEGER NOT NULL DEFAULT 0,"
            "fingerprint TEXT NOT NULL DEFAULT ''"
            ")"
        )

        # Rejection-learning columns on applications (career insights).
        application_columns = conn.exec_driver_sql("PRAGMA table_info(applications)").mappings().all()
        if application_columns:
            application_col_names = {column["name"] for column in application_columns}
            if "rejection_reason" not in application_col_names:
                conn.exec_driver_sql("ALTER TABLE applications ADD COLUMN rejection_reason TEXT")
            if "interview_rounds" not in application_col_names:
                conn.exec_driver_sql("ALTER TABLE applications ADD COLUMN interview_rounds INTEGER")

        # Career-profile columns (work experience + resume-import reference).
        profile_columns = conn.exec_driver_sql("PRAGMA table_info(career_profiles)").mappings().all()
        if profile_columns:
            profile_col_names = {column["name"] for column in profile_columns}
            if "work_experience" not in profile_col_names:
                conn.exec_driver_sql("ALTER TABLE career_profiles ADD COLUMN work_experience TEXT")
            if "source_resume_id" not in profile_col_names:
                conn.exec_driver_sql("ALTER TABLE career_profiles ADD COLUMN source_resume_id TEXT")
            if "source_resume_title" not in profile_col_names:
                conn.exec_driver_sql("ALTER TABLE career_profiles ADD COLUMN source_resume_title TEXT")
            if "languages" not in profile_col_names:
                conn.exec_driver_sql("ALTER TABLE career_profiles ADD COLUMN languages TEXT")
            if "awards" not in profile_col_names:
                conn.exec_driver_sql("ALTER TABLE career_profiles ADD COLUMN awards TEXT")
            if "email_signature" not in profile_col_names:
                conn.exec_driver_sql("ALTER TABLE career_profiles ADD COLUMN email_signature TEXT")
            # Pre-existing rows have NULL in the new JSON columns after ALTER;
            # normalize so the API never sees a None where a list is expected.
            for column in ("work_experience", "languages", "awards"):
                conn.exec_driver_sql(
                    f"UPDATE career_profiles SET {column} = '[]' WHERE {column} IS NULL"
                )

        # GitHub-imported projects: languages (JSON list) + README snapshot.
        project_columns = conn.exec_driver_sql("PRAGMA table_info(career_projects)").mappings().all()
        if project_columns:
            project_col_names = {column["name"] for column in project_columns}
            if "languages" not in project_col_names:
                conn.exec_driver_sql("ALTER TABLE career_projects ADD COLUMN languages TEXT")
            if "readme" not in project_col_names:
                conn.exec_driver_sql("ALTER TABLE career_projects ADD COLUMN readme TEXT")
            for column in ("languages",):
                conn.exec_driver_sql(
                    f"UPDATE career_projects SET {column} = '[]' WHERE {column} IS NULL"
                )

        # Career skills: embedding column for RAG.
        skill_columns = conn.exec_driver_sql("PRAGMA table_info(career_skills)").mappings().all()
        if skill_columns:
            skill_col_names = {column["name"] for column in skill_columns}
            if "embedding" not in skill_col_names:
                conn.exec_driver_sql("ALTER TABLE career_skills ADD COLUMN embedding TEXT")

        # Chat threads: skills column for base mode + skills architecture.
        thread_columns = conn.exec_driver_sql("PRAGMA table_info(chat_threads)").mappings().all()
        if thread_columns:
            thread_col_names = {column["name"] for column in thread_columns}
            if "skills" not in thread_col_names:
                conn.exec_driver_sql("ALTER TABLE chat_threads ADD COLUMN skills TEXT DEFAULT '[]'")
                # Migrate existing mode-based threads to new skills format
                conn.exec_driver_sql(
                    "UPDATE chat_threads SET skills = '[\"coach\"]' WHERE mode = 'coach'"
                )
                conn.exec_driver_sql(
                    "UPDATE chat_threads SET skills = '[\"recruiter\"]' WHERE mode = 'recruiter'"
                )
                conn.exec_driver_sql(
                    "UPDATE chat_threads SET skills = '[\"resume_analyst\"]' WHERE mode = 'resume_analyst'"
                )
                # Reset mode to 'ask' for skill-based threads
                conn.exec_driver_sql(
                    "UPDATE chat_threads SET mode = 'ask' WHERE mode IN ('coach', 'recruiter', 'resume_analyst')"
                )

        # Chat message versioning + persistent reasoning.
        chat_msg_columns = conn.exec_driver_sql("PRAGMA table_info(chat_messages)").mappings().all()
        if chat_msg_columns:
            chat_msg_col_names = {column["name"] for column in chat_msg_columns}
            if "parent_message_id" not in chat_msg_col_names:
                conn.exec_driver_sql("ALTER TABLE chat_messages ADD COLUMN parent_message_id TEXT")
            if "version" not in chat_msg_col_names:
                conn.exec_driver_sql("ALTER TABLE chat_messages ADD COLUMN version INTEGER DEFAULT 1")
            if "superseded" not in chat_msg_col_names:
                conn.exec_driver_sql("ALTER TABLE chat_messages ADD COLUMN superseded BOOLEAN DEFAULT 0")
            if "stream_events_json" not in chat_msg_col_names:
                conn.exec_driver_sql("ALTER TABLE chat_messages ADD COLUMN stream_events_json TEXT")

        # MCP ownership + per-type credential columns.
        mcp_server_columns = conn.exec_driver_sql("PRAGMA table_info(mcp_servers)").mappings().all()
        if mcp_server_columns:
            mcp_server_col_names = {column["name"] for column in mcp_server_columns}
            if "user_id" not in mcp_server_col_names:
                conn.exec_driver_sql("ALTER TABLE mcp_servers ADD COLUMN user_id TEXT")
            if "server_kind" not in mcp_server_col_names:
                conn.exec_driver_sql("ALTER TABLE mcp_servers ADD COLUMN server_kind TEXT DEFAULT 'remote'")
                # Backfill: builtin → managed, custom → remote
                conn.exec_driver_sql(
                    "UPDATE mcp_servers SET server_kind = 'managed' WHERE server_type = 'builtin'"
                )
                conn.exec_driver_sql(
                    "UPDATE mcp_servers SET server_kind = 'remote' WHERE server_type = 'custom'"
                )
            if "last_error_code" not in mcp_server_col_names:
                conn.exec_driver_sql("ALTER TABLE mcp_servers ADD COLUMN last_error_code TEXT")

        # MCP per-type credential columns (additive, keep auth_config for migration).
        mcp_cred_columns = conn.exec_driver_sql("PRAGMA table_info(mcp_credentials)").mappings().all()
        if mcp_cred_columns:
            mcp_cred_col_names = {column["name"] for column in mcp_cred_columns}
            for col in (
                "api_key_header_name", "encrypted_api_key", "encrypted_access_token",
                "encrypted_refresh_token", "encrypted_username", "encrypted_password",
                "encrypted_custom_headers", "oauth_authorization_url", "oauth_token_url",
                "oauth_client_id", "encrypted_client_secret", "oauth_scope",
                "token_expiry", "oauth_state_hash", "oauth_state_expires_at",
            ):
                if col not in mcp_cred_col_names:
                    conn.exec_driver_sql(f"ALTER TABLE mcp_credentials ADD COLUMN {col} TEXT")
