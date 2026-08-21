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
