"""SQLAlchemy (SQLite) data layer for Resume Matcher.

This is a behavior-preserving replacement for the original TinyDB wrapper. The
``Database`` facade keeps the same method names/signatures and returns **plain
dicts** (never ORM rows), so the ~50 call sites only needed ``await`` added.

Two engines back one SQLite file:
- an **async** engine (``aiosqlite``) for the document tables and applications;
- a **sync** engine for the encrypted ``api_keys`` table, which is read on the
  synchronous LLM hot path (``get_llm_config`` → ``resolve_api_key``).
"""

import asyncio
import hashlib
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db_engine import init_models_sync, make_async_engine, make_sync_engine
from app.models import (
    ApiKey,
    Application,
    CareerCertification,
    CareerProfile,
    CareerSkill,
    Company,
    Contact,
    Improvement,
    Job,
    Resume,
)

logger = logging.getLogger(__name__)

# Columns that are first-class on the jobs table; everything else the pipeline
# attaches dynamically is stored in ``metadata_json`` (see Job model).
_JOB_CORE_FIELDS = frozenset({"job_id", "content", "resume_id", "created_at"})

# Application status columns (stable keys, decoupled from i18n labels).
APPLICATION_STATUSES: tuple[str, ...] = (
    "saved",
    "applied",
    "no_response",
    "response",
    "interview",
    "accepted",
    "rejected",
)


def _now() -> str:
    """Current UTC time as an ISO-8601 string (TinyDB-era format)."""
    return datetime.now(timezone.utc).isoformat()


class Database:
    """Async SQLAlchemy facade for resume matcher data."""

    # Serializes concurrent master-resume promotion. Stays the *primary*
    # mechanism for the single-master invariant (the partial unique index is a
    # storage-level backstop).
    _master_resume_lock = asyncio.Lock()

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or settings.sqlite_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._async_engine = None
        self._async_session_factory: async_sessionmaker[AsyncSession] | None = None
        self._sync_engine = None
        self._sync_session_factory: sessionmaker[Session] | None = None
        self._initialized = False

    # -- engine / session plumbing ------------------------------------------

    def _ensure_initialized(self) -> None:
        """Create engines and tables once (idempotent).

        Tables are created via the **sync** engine so both the sync (api_keys)
        and async (docs) paths see them immediately, without needing an event
        loop. Both engines point at the same file.
        """
        if self._initialized:
            return
        self._sync_engine = make_sync_engine(self.db_path)
        self._sync_session_factory = sessionmaker(self._sync_engine, expire_on_commit=False)
        init_models_sync(self._sync_engine)
        self._async_engine = make_async_engine(self.db_path)
        self._async_session_factory = async_sessionmaker(
            self._async_engine, expire_on_commit=False
        )
        self._initialized = True

    @property
    def _session(self) -> async_sessionmaker[AsyncSession]:
        self._ensure_initialized()
        assert self._async_session_factory is not None
        return self._async_session_factory

    @property
    def _sync(self) -> sessionmaker[Session]:
        self._ensure_initialized()
        assert self._sync_session_factory is not None
        return self._sync_session_factory

    async def close(self) -> None:
        """Dispose engines and release file handles."""
        if self._async_engine is not None:
            await self._async_engine.dispose()
            self._async_engine = None
            self._async_session_factory = None
        if self._sync_engine is not None:
            self._sync_engine.dispose()
            self._sync_engine = None
            self._sync_session_factory = None
        self._initialized = False

    # -- row -> dict converters ---------------------------------------------

    @staticmethod
    def _resume_to_dict(row: Resume) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "resume_id": row.resume_id,
            "content": row.content,
            "content_type": row.content_type,
            "filename": row.filename,
            "is_master": row.is_master,
            "parent_id": row.parent_id,
            "processed_data": row.processed_data,
            "processing_status": row.processing_status,
            "cover_letter": row.cover_letter,
            "outreach_message": row.outreach_message,
            "interview_prep": row.interview_prep,
            "title": row.title,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
        # Preserve TinyDB absence semantics: omit the key entirely when None.
        if row.original_markdown is not None:
            doc["original_markdown"] = row.original_markdown
        return doc

    @staticmethod
    def _job_to_dict(row: Job) -> dict[str, Any]:
        doc: dict[str, Any] = {
            "job_id": row.job_id,
            "content": row.content,
            "resume_id": row.resume_id,
            "created_at": row.created_at,
        }
        meta = row.metadata_json or {}
        if isinstance(meta, dict):
            doc.update(meta)  # flatten dynamic fields to top level
        return doc

    @staticmethod
    def _improvement_to_dict(row: Improvement) -> dict[str, Any]:
        return {
            "request_id": row.request_id,
            "original_resume_id": row.original_resume_id,
            "tailored_resume_id": row.tailored_resume_id,
            "job_id": row.job_id,
            "improvements": row.improvements,
            "created_at": row.created_at,
        }

    @staticmethod
    def _application_to_dict(row: Application) -> dict[str, Any]:
        return {
            "application_id": row.application_id,
            "job_id": row.job_id,
            "resume_id": row.resume_id,
            "master_resume_id": row.master_resume_id,
            "status": row.status,
            "company": row.company,
            "role": row.role,
            "applied_at": row.applied_at,
            "notes": row.notes,
            "rejection_reason": row.rejection_reason,
            "interview_rounds": row.interview_rounds,
            "position": row.position,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _company_to_dict(row: Company) -> dict[str, Any]:
        return {
            "company_id": row.company_id,
            "name": row.name,
            "email": row.email,
            "phone": row.phone,
            "address": row.address,
            "website": row.website,
            "company_size": row.company_size,
            "company_type": row.company_type,
            "linkedin_url": row.linkedin_url,
            "industry": row.industry,
            "status": row.status,
            "year_founded": row.year_founded,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _contact_to_dict(row: Contact) -> dict[str, Any]:
        return {
            "contact_id": row.contact_id,
            "name": row.name,
            "company": row.company,
            "location": row.location,
            "goal": row.goal,
            "status": row.status,
            "relationship": row.relationship,
            "follow_up_date": row.follow_up_date,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _career_profile_to_dict(row: CareerProfile) -> dict[str, Any]:
        return {
            "profile_id": row.profile_id,
            "name": row.name,
            "title": row.title,
            "email": row.email,
            "phone": row.phone,
            "location": row.location,
            "website": row.website,
            "linkedin": row.linkedin,
            "github": row.github,
            "summary": row.summary,
            "career_goals": row.career_goals,
            "target_roles": row.target_roles,
            "target_locations": row.target_locations,
            "target_salary_min": row.target_salary_min,
            "target_salary_max": row.target_salary_max,
            "work_experience": row.work_experience or [],
            "languages": row.languages or [],
            "awards": row.awards or [],
            "source_resume_id": row.source_resume_id,
            "source_resume_title": row.source_resume_title,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _career_skill_to_dict(row: CareerSkill) -> dict[str, Any]:
        return {
            "skill_id": row.skill_id,
            "name": row.name,
            "category": row.category,
            "proficiency": row.proficiency,
            "years_experience": row.years_experience,
            "last_used": row.last_used,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    @staticmethod
    def _career_certification_to_dict(row: CareerCertification) -> dict[str, Any]:
        return {
            "certification_id": row.certification_id,
            "name": row.name,
            "issuer": row.issuer,
            "date_obtained": row.date_obtained,
            "url": row.url,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    # -- Resume operations --------------------------------------------------

    async def create_resume(
        self,
        content: str,
        content_type: str = "md",
        filename: str | None = None,
        is_master: bool = False,
        parent_id: str | None = None,
        processed_data: dict[str, Any] | None = None,
        processing_status: str = "pending",
        cover_letter: str | None = None,
        outreach_message: str | None = None,
        title: str | None = None,
        original_markdown: str | None = None,
        interview_prep: str | None = None,
    ) -> dict[str, Any]:
        """Create a new resume entry.

        processing_status: "pending", "processing", "ready", "failed"
        """
        resume_id = str(uuid4())
        now = _now()
        async with self._session() as session:
            session.add(
                Resume(
                    resume_id=resume_id,
                    content=content,
                    content_type=content_type,
                    filename=filename,
                    is_master=is_master,
                    parent_id=parent_id,
                    processed_data=processed_data,
                    processing_status=processing_status,
                    cover_letter=cover_letter,
                    outreach_message=outreach_message,
                    interview_prep=interview_prep,
                    title=title,
                    original_markdown=original_markdown,
                    created_at=now,
                    updated_at=now,
                )
            )
            await session.commit()

        doc: dict[str, Any] = {
            "resume_id": resume_id,
            "content": content,
            "content_type": content_type,
            "filename": filename,
            "is_master": is_master,
            "parent_id": parent_id,
            "processed_data": processed_data,
            "processing_status": processing_status,
            "cover_letter": cover_letter,
            "outreach_message": outreach_message,
            "interview_prep": interview_prep,
            "title": title,
            "created_at": now,
            "updated_at": now,
        }
        if original_markdown is not None:
            doc["original_markdown"] = original_markdown
        return doc

    async def create_resume_atomic_master(
        self,
        content: str,
        content_type: str = "md",
        filename: str | None = None,
        processed_data: dict[str, Any] | None = None,
        processing_status: str = "pending",
        cover_letter: str | None = None,
        outreach_message: str | None = None,
        original_markdown: str | None = None,
        title: str | None = None,
        interview_prep: str | None = None,
        as_master: bool = False,
    ) -> dict[str, Any]:
        """Create a new resume with atomic master assignment.

        Multi-master model: when ``as_master`` is True the resume is always
        created as a master (no demotion of existing masters). Otherwise the
        first resume auto-becomes master; if the current master is stuck
        ``failed``/``processing`` it is demoted so this upload can take over.
        Uses an asyncio.Lock to prevent race conditions when multiple uploads
        happen concurrently.
        """
        async with self._master_resume_lock:
            if as_master:
                is_master = True
            else:
                current_master = await self.get_master_resume()
                is_master = current_master is None

                # Recovery: if the current master is stuck failed/processing,
                # demote it so this upload can become the new master.
                if current_master and current_master.get("processing_status") in (
                    "failed",
                    "processing",
                ):
                    async with self._session() as session:
                        row = await session.get(Resume, current_master["resume_id"])
                        if row is not None:
                            row.is_master = False
                            await session.commit()
                    is_master = True

            return await self.create_resume(
                content=content,
                content_type=content_type,
                filename=filename,
                is_master=is_master,
                processed_data=processed_data,
                processing_status=processing_status,
                cover_letter=cover_letter,
                outreach_message=outreach_message,
                interview_prep=interview_prep,
                original_markdown=original_markdown,
                title=title,
            )

    async def get_resume(self, resume_id: str) -> dict[str, Any] | None:
        """Get resume by ID."""
        async with self._session() as session:
            row = await session.get(Resume, resume_id)
            return self._resume_to_dict(row) if row else None

    async def get_master_resume(self) -> dict[str, Any] | None:
        """Get the master resume if exists."""
        async with self._session() as session:
            result = await session.execute(
                select(Resume).where(Resume.is_master.is_(True))
            )
            row = result.scalars().first()
            return self._resume_to_dict(row) if row else None

    async def update_resume(self, resume_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        """Update resume by ID.

        Raises:
            ValueError: If resume not found.
        """
        async with self._session() as session:
            row = await session.get(Resume, resume_id)
            if row is None:
                raise ValueError(f"Resume not found: {resume_id}")
            for key, value in updates.items():
                if hasattr(row, key):
                    setattr(row, key, value)
                else:
                    logger.warning("Ignoring unknown resume field on update: %s", key)
            row.updated_at = _now()
            await session.commit()
            return self._resume_to_dict(row)

    async def delete_resume(self, resume_id: str) -> bool:
        """Delete resume by ID."""
        async with self._session() as session:
            row = await session.get(Resume, resume_id)
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    async def list_resumes(self) -> list[dict[str, Any]]:
        """List all resumes."""
        async with self._session() as session:
            result = await session.execute(select(Resume).order_by(Resume.created_at))
            return [self._resume_to_dict(row) for row in result.scalars().all()]

    async def set_master_resume(self, resume_id: str) -> bool:
        """Set a resume as master (no unsetting of other masters).

        Multi-master model: this is a promote-only helper; other masters keep
        their flag. Returns False if the resume doesn't exist.
        """
        async with self._session() as session:
            target = await session.get(Resume, resume_id)
            if target is None:
                logger.warning("Cannot set master: resume %s not found", resume_id)
                return False

            target.is_master = True
            await session.commit()
            return True

    # -- Job operations -----------------------------------------------------

    async def create_job(self, content: str, resume_id: str | None = None) -> dict[str, Any]:
        """Create a new job description entry."""
        job_id = str(uuid4())
        now = _now()
        async with self._session() as session:
            session.add(
                Job(job_id=job_id, content=content, resume_id=resume_id, created_at=now, metadata_json={})
            )
            await session.commit()
        return {
            "job_id": job_id,
            "content": content,
            "resume_id": resume_id,
            "created_at": now,
        }

    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        """Get job by ID (dynamic fields flattened to top level)."""
        async with self._session() as session:
            row = await session.get(Job, job_id)
            return self._job_to_dict(row) if row else None

    async def update_job(
        self, job_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update a job by ID.

        Core columns are set directly; every other key is merged into
        ``metadata_json`` so dynamic pipeline fields (``preview_hash``,
        ``job_keywords``, ``company``/``role``, …) round-trip through
        ``get_job`` as top-level keys.
        """
        async with self._session() as session:
            row = await session.get(Job, job_id)
            if row is None:
                return None
            meta = dict(row.metadata_json or {})
            for key, value in updates.items():
                if key in _JOB_CORE_FIELDS:
                    setattr(row, key, value)
                else:
                    meta[key] = value
            # Reassign so SQLAlchemy detects the JSON mutation.
            row.metadata_json = meta
            await session.commit()
            return self._job_to_dict(row)

    async def delete_job(self, job_id: str) -> bool:
        """Delete a job by ID (used to clean up an orphaned manual-add job)."""
        async with self._session() as session:
            row = await session.get(Job, job_id)
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    # -- Improvement operations ---------------------------------------------

    async def create_improvement(
        self,
        original_resume_id: str,
        tailored_resume_id: str,
        job_id: str,
        improvements: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Create an improvement result entry."""
        request_id = str(uuid4())
        now = _now()
        async with self._session() as session:
            session.add(
                Improvement(
                    request_id=request_id,
                    original_resume_id=original_resume_id,
                    tailored_resume_id=tailored_resume_id,
                    job_id=job_id,
                    improvements=improvements,
                    created_at=now,
                )
            )
            await session.commit()
        return {
            "request_id": request_id,
            "original_resume_id": original_resume_id,
            "tailored_resume_id": tailored_resume_id,
            "job_id": job_id,
            "improvements": improvements,
            "created_at": now,
        }

    async def get_improvement_by_tailored_resume(
        self, tailored_resume_id: str
    ) -> dict[str, Any] | None:
        """Get improvement record by tailored resume ID."""
        async with self._session() as session:
            result = await session.execute(
                select(Improvement).where(
                    Improvement.tailored_resume_id == tailored_resume_id
                )
            )
            row = result.scalars().first()
            return self._improvement_to_dict(row) if row else None

    # -- Application (tracker) operations -----------------------------------

    async def _next_position(self, session: AsyncSession, status: str) -> int:
        result = await session.execute(
            select(func.count())
            .select_from(Application)
            .where(Application.status == status)
        )
        return int(result.scalar() or 0)

    async def _renumber(self, session: AsyncSession, status: str) -> None:
        """Renumber a column's positions to a contiguous 0..n-1 sequence."""
        result = await session.execute(
            select(Application)
            .where(Application.status == status)
            .order_by(Application.position, Application.created_at)
        )
        for index, row in enumerate(result.scalars().all()):
            if row.position != index:
                row.position = index

    async def create_application(
        self,
        job_id: str,
        resume_id: str,
        master_resume_id: str | None = None,
        status: str = "applied",
        company: str | None = None,
        role: str | None = None,
        applied_at: str | None = None,
        notes: str | None = None,
        rejection_reason: str | None = None,
        interview_rounds: int | None = None,
    ) -> dict[str, Any]:
        """Create a tracker card, deduped on (job_id, resume_id).

        If a card for the same job+resume already exists it is returned as-is
        (survives double-submit / retried confirms).
        """
        async with self._session() as session:
            existing = await session.execute(
                select(Application).where(
                    Application.job_id == job_id, Application.resume_id == resume_id
                )
            )
            found = existing.scalars().first()
            if found is not None:
                return self._application_to_dict(found)

            now = _now()
            if applied_at is None and status != "saved":
                applied_at = now
            position = await self._next_position(session, status)
            row = Application(
                application_id=str(uuid4()),
                job_id=job_id,
                resume_id=resume_id,
                master_resume_id=master_resume_id,
                status=status,
                company=company,
                role=role,
                applied_at=applied_at,
                notes=notes,
                rejection_reason=rejection_reason,
                interview_rounds=interview_rounds,
                position=position,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            try:
                await session.commit()
            except IntegrityError:
                # A concurrent create won the (job_id, resume_id) unique
                # constraint — return the existing card instead of duplicating.
                await session.rollback()
                dup = await session.execute(
                    select(Application).where(
                        Application.job_id == job_id,
                        Application.resume_id == resume_id,
                    )
                )
                found = dup.scalars().first()
                if found is not None:
                    logger.debug(
                        "Deduped concurrent application create for job=%s resume=%s",
                        job_id,
                        resume_id,
                    )
                    return self._application_to_dict(found)
                raise
            return self._application_to_dict(row)

    async def list_applications(self, status: str | None = None) -> list[dict[str, Any]]:
        """List applications ordered by (status, position)."""
        async with self._session() as session:
            stmt = select(Application)
            if status is not None:
                stmt = stmt.where(Application.status == status)
            stmt = stmt.order_by(Application.status, Application.position)
            result = await session.execute(stmt)
            return [self._application_to_dict(row) for row in result.scalars().all()]

    async def get_application(self, application_id: str) -> dict[str, Any] | None:
        """Get an application by ID."""
        async with self._session() as session:
            row = await session.get(Application, application_id)
            return self._application_to_dict(row) if row else None

    async def update_application(
        self, application_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update an application; renumber columns when status/position change.

        ``position`` is interpreted as the desired index within the (possibly
        new) ``status`` column; siblings are renumbered server-side so the
        column stays a contiguous 0..n-1 sequence.
        """
        async with self._session() as session:
            row = await session.get(Application, application_id)
            if row is None:
                return None

            old_status = row.status
            new_status = updates.get("status", old_status)
            target_position = updates.get("position", None)

            for key in ("company", "role", "applied_at", "notes", "rejection_reason", "interview_rounds"):
                if key in updates:
                    setattr(row, key, updates[key])

            moved = "status" in updates or "position" in updates
            if moved:
                row.status = new_status
                # Park it out of the way, renumber both columns, then reinsert.
                row.position = 10_000_000
                await session.flush()
                if old_status != new_status:
                    await self._renumber(session, old_status)
                # Renumber the target column excluding this row, then splice in.
                siblings = await session.execute(
                    select(Application)
                    .where(
                        Application.status == new_status,
                        Application.application_id != application_id,
                    )
                    .order_by(Application.position, Application.created_at)
                )
                ordered = list(siblings.scalars().all())
                if target_position is None or target_position > len(ordered):
                    target_position = len(ordered)
                if target_position < 0:
                    target_position = 0
                ordered.insert(target_position, row)
                for index, item in enumerate(ordered):
                    item.position = index

            row.updated_at = _now()
            await session.commit()
            return self._application_to_dict(row)

    async def bulk_update_applications(
        self, application_ids: list[str], status: str
    ) -> int:
        """Move many applications to the end of ``status``. Returns count moved."""
        moved = 0
        async with self._session() as session:
            affected_old: set[str] = set()
            for application_id in application_ids:
                row = await session.get(Application, application_id)
                if row is None:
                    continue
                affected_old.add(row.status)
                row.status = status
                row.position = 20_000_000 + moved  # provisional, renumbered below
                row.updated_at = _now()
                moved += 1
            await session.flush()
            for old_status in affected_old - {status}:
                await self._renumber(session, old_status)
            await self._renumber(session, status)
            await session.commit()
        return moved

    async def delete_application(self, application_id: str) -> bool:
        """Delete an application; renumber its column."""
        async with self._session() as session:
            row = await session.get(Application, application_id)
            if row is None:
                return False
            status = row.status
            await session.delete(row)
            await session.flush()
            await self._renumber(session, status)
            await session.commit()
            return True

    async def bulk_delete_applications(self, application_ids: list[str]) -> int:
        """Delete many applications; renumber affected columns. Returns count."""
        deleted = 0
        async with self._session() as session:
            affected: set[str] = set()
            for application_id in application_ids:
                row = await session.get(Application, application_id)
                if row is None:
                    continue
                affected.add(row.status)
                await session.delete(row)
                deleted += 1
            await session.flush()
            for status in affected:
                await self._renumber(session, status)
            await session.commit()
        return deleted

    # -- Company (tracker) operations ---------------------------------------

    async def create_company(
        self,
        name: str,
        email: str | None = None,
        phone: str | None = None,
        address: str | None = None,
        website: str | None = None,
        company_size: str | None = None,
        company_type: str | None = None,
        linkedin_url: str | None = None,
        industry: str | None = None,
        status: str | None = None,
        year_founded: int | None = None,
    ) -> dict[str, Any]:
        """Create a company, deduped on name (case-insensitive).

        If a company with the same lowercased name already exists it is
        returned as-is (survives double-submit); the caller decides whether to
        treat that as a conflict or a no-op.
        """
        async with self._session() as session:
            existing = await session.execute(
                select(Company).where(func.lower(Company.name) == name.lower())
            )
            found = existing.scalars().first()
            if found is not None:
                return self._company_to_dict(found)

            now = _now()
            row = Company(
                company_id=str(uuid4()),
                name=name,
                email=email,
                phone=phone,
                address=address,
                website=website,
                company_size=company_size,
                company_type=company_type,
                linkedin_url=linkedin_url,
                industry=industry,
                status=status,
                year_founded=year_founded,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            try:
                await session.commit()
            except IntegrityError:
                # A concurrent create won the name unique constraint — return
                # the existing row instead of duplicating.
                await session.rollback()
                dup = await session.execute(
                    select(Company).where(func.lower(Company.name) == name.lower())
                )
                found = dup.scalars().first()
                if found is not None:
                    logger.debug("Deduped concurrent company create for name=%s", name)
                    return self._company_to_dict(found)
                raise
            return self._company_to_dict(row)

    async def list_companies(self) -> list[dict[str, Any]]:
        """List all companies ordered by name (case-insensitive)."""
        async with self._session() as session:
            stmt = select(Company).order_by(func.lower(Company.name), Company.created_at)
            result = await session.execute(stmt)
            return [self._company_to_dict(row) for row in result.scalars().all()]

    async def get_company(self, company_id: str) -> dict[str, Any] | None:
        """Get a company by ID."""
        async with self._session() as session:
            row = await session.get(Company, company_id)
            return self._company_to_dict(row) if row else None

    async def get_company_by_name(self, name: str) -> dict[str, Any] | None:
        """Get a company by name (case-insensitive)."""
        async with self._session() as session:
            result = await session.execute(
                select(Company).where(func.lower(Company.name) == name.lower())
            )
            row = result.scalars().first()
            return self._company_to_dict(row) if row else None

    async def update_company(
        self, company_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update a company's editable fields. Returns None when not found."""
        async with self._session() as session:
            row = await session.get(Company, company_id)
            if row is None:
                return None

            new_name = updates.get("name")
            if new_name is not None and new_name.lower() != row.name.lower():
                conflict = await session.execute(
                    select(Company).where(
                        func.lower(Company.name) == new_name.lower(),
                        Company.company_id != company_id,
                    )
                )
                if conflict.scalars().first() is not None:
                    raise ValueError(f"Company with name {new_name!r} already exists")

            for key in (
                "name",
                "email",
                "phone",
                "address",
                "website",
                "company_size",
                "company_type",
                "linkedin_url",
                "industry",
                "status",
                "year_founded",
            ):
                if key in updates:
                    setattr(row, key, updates[key])

            row.updated_at = _now()
            try:
                await session.commit()
            except IntegrityError:
                # Renaming to a name that already exists — surface as a
                # conflict to the caller.
                await session.rollback()
                raise ValueError(f"Company with name {updates.get('name')!r} already exists")
            return self._company_to_dict(row)

    async def delete_company(self, company_id: str) -> bool:
        """Delete a company. Returns False when not found."""
        async with self._session() as session:
            row = await session.get(Company, company_id)
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    async def bulk_delete_companies(self, company_ids: list[str]) -> int:
        """Delete many companies (missing ids are skipped). Returns count."""
        deleted = 0
        async with self._session() as session:
            for company_id in company_ids:
                row = await session.get(Company, company_id)
                if row is None:
                    continue
                await session.delete(row)
                deleted += 1
            await session.commit()
        return deleted

    # -- Contact (tracker) operations --------------------------------------

    async def create_contact(
        self,
        name: str,
        company: str | None = None,
        location: str | None = None,
        goal: str | None = None,
        status: str | None = None,
        relationship: str | None = None,
        follow_up_date: str | None = None,
    ) -> dict[str, Any]:
        """Create a contact, deduped on name (case-insensitive).

        If a contact with the same lowercased name already exists it is
        returned as-is (survives double-submit); the caller decides whether to
        treat that as a conflict or a no-op.
        """
        async with self._session() as session:
            existing = await session.execute(
                select(Contact).where(func.lower(Contact.name) == name.lower())
            )
            found = existing.scalars().first()
            if found is not None:
                return self._contact_to_dict(found)

            now = _now()
            row = Contact(
                contact_id=str(uuid4()),
                name=name,
                company=company,
                location=location,
                goal=goal,
                status=status,
                relationship=relationship,
                follow_up_date=follow_up_date,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            try:
                await session.commit()
            except IntegrityError:
                # A concurrent create won the name unique constraint — return
                # the existing row instead of duplicating.
                await session.rollback()
                dup = await session.execute(
                    select(Contact).where(func.lower(Contact.name) == name.lower())
                )
                found = dup.scalars().first()
                if found is not None:
                    logger.debug("Deduped concurrent contact create for name=%s", name)
                    return self._contact_to_dict(found)
                raise
            return self._contact_to_dict(row)

    async def list_contacts(self) -> list[dict[str, Any]]:
        """List all contacts ordered by name (case-insensitive)."""
        async with self._session() as session:
            stmt = select(Contact).order_by(func.lower(Contact.name), Contact.created_at)
            result = await session.execute(stmt)
            return [self._contact_to_dict(row) for row in result.scalars().all()]

    async def get_contact(self, contact_id: str) -> dict[str, Any] | None:
        """Get a contact by ID."""
        async with self._session() as session:
            row = await session.get(Contact, contact_id)
            return self._contact_to_dict(row) if row else None

    async def get_contact_by_name(self, name: str) -> dict[str, Any] | None:
        """Get a contact by name (case-insensitive)."""
        async with self._session() as session:
            result = await session.execute(
                select(Contact).where(func.lower(Contact.name) == name.lower())
            )
            row = result.scalars().first()
            return self._contact_to_dict(row) if row else None

    async def update_contact(
        self, contact_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update a contact's editable fields. Returns None when not found."""
        async with self._session() as session:
            row = await session.get(Contact, contact_id)
            if row is None:
                return None

            new_name = updates.get("name")
            if new_name is not None and new_name.lower() != row.name.lower():
                conflict = await session.execute(
                    select(Contact).where(
                        func.lower(Contact.name) == new_name.lower(),
                        Contact.contact_id != contact_id,
                    )
                )
                if conflict.scalars().first() is not None:
                    raise ValueError(f"Contact with name {new_name!r} already exists")

            for key in (
                "name",
                "company",
                "location",
                "goal",
                "status",
                "relationship",
                "follow_up_date",
            ):
                if key in updates:
                    setattr(row, key, updates[key])

            row.updated_at = _now()
            try:
                await session.commit()
            except IntegrityError:
                # Renaming to a name that already exists — surface as a
                # conflict to the caller.
                await session.rollback()
                raise ValueError(f"Contact with name {updates.get('name')!r} already exists")
            return self._contact_to_dict(row)

    async def delete_contact(self, contact_id: str) -> bool:
        """Delete a contact. Returns False when not found."""
        async with self._session() as session:
            row = await session.get(Contact, contact_id)
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    async def bulk_delete_contacts(self, contact_ids: list[str]) -> int:
        """Delete many contacts (missing ids are skipped). Returns count."""
        deleted = 0
        async with self._session() as session:
            for contact_id in contact_ids:
                row = await session.get(Contact, contact_id)
                if row is None:
                    continue
                await session.delete(row)
                deleted += 1
            await session.commit()
        return deleted

    # -- Career profile operations ------------------------------------------

    async def get_career_profile(self) -> dict[str, Any] | None:
        """Get the single career profile row, if any."""
        async with self._session() as session:
            result = await session.execute(select(CareerProfile))
            row = result.scalars().first()
            return self._career_profile_to_dict(row) if row else None

    async def create_career_profile(self) -> dict[str, Any]:
        """Create an empty career profile row (idempotent)."""
        async with self._session() as session:
            result = await session.execute(select(CareerProfile))
            existing = result.scalars().first()
            if existing is not None:
                return self._career_profile_to_dict(existing)
            now = _now()
            row = CareerProfile(
                profile_id=str(uuid4()),
                career_goals=[],
                target_roles=[],
                target_locations=[],
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            await session.commit()
            return self._career_profile_to_dict(row)

    async def update_career_profile(self, updates: dict[str, Any]) -> dict[str, Any]:
        """Update the career profile row (creating it first when absent)."""
        profile = await self.get_career_profile()
        if profile is None:
            profile = await self.create_career_profile()

        editable = (
            "name",
            "title",
            "email",
            "phone",
            "location",
            "website",
            "linkedin",
            "github",
            "summary",
            "career_goals",
            "target_roles",
            "target_locations",
            "target_salary_min",
            "target_salary_max",
            "work_experience",
            "languages",
            "awards",
            "source_resume_id",
            "source_resume_title",
        )
        async with self._session() as session:
            row = await session.get(CareerProfile, profile["profile_id"])
            if row is None:
                raise ValueError(f"Career profile not found: {profile['profile_id']}")
            for key in editable:
                if key in updates:
                    setattr(row, key, updates[key])
            row.updated_at = _now()
            await session.commit()
            return self._career_profile_to_dict(row)

    # -- Career skills ------------------------------------------------------

    async def create_career_skill(
        self,
        name: str,
        category: str | None = None,
        proficiency: int | None = None,
        years_experience: int | None = None,
        last_used: str | None = None,
    ) -> dict[str, Any]:
        """Create a skill, deduped on name (case-insensitive).

        If a skill with the same lowercased name already exists it is returned
        as-is; the caller decides whether to treat that as a conflict or a
        no-op.
        """
        async with self._session() as session:
            existing = await session.execute(
                select(CareerSkill).where(func.lower(CareerSkill.name) == name.lower())
            )
            found = existing.scalars().first()
            if found is not None:
                return self._career_skill_to_dict(found)

            now = _now()
            row = CareerSkill(
                skill_id=str(uuid4()),
                name=name,
                category=category,
                proficiency=proficiency,
                years_experience=years_experience,
                last_used=last_used,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                dup = await session.execute(
                    select(CareerSkill).where(
                        func.lower(CareerSkill.name) == name.lower()
                    )
                )
                found = dup.scalars().first()
                if found is not None:
                    logger.debug("Deduped concurrent skill create for name=%s", name)
                    return self._career_skill_to_dict(found)
                raise
            return self._career_skill_to_dict(row)

    async def list_career_skills(self) -> list[dict[str, Any]]:
        """List all skills ordered by name (case-insensitive)."""
        async with self._session() as session:
            result = await session.execute(
                select(CareerSkill).order_by(func.lower(CareerSkill.name))
            )
            return [self._career_skill_to_dict(row) for row in result.scalars().all()]

    async def get_career_skill(self, skill_id: str) -> dict[str, Any] | None:
        """Get a skill by ID."""
        async with self._session() as session:
            row = await session.get(CareerSkill, skill_id)
            return self._career_skill_to_dict(row) if row else None

    async def get_career_skill_by_name(self, name: str) -> dict[str, Any] | None:
        """Get a skill by name (case-insensitive)."""
        async with self._session() as session:
            result = await session.execute(
                select(CareerSkill).where(func.lower(CareerSkill.name) == name.lower())
            )
            row = result.scalars().first()
            return self._career_skill_to_dict(row) if row else None

    async def update_career_skill(
        self, skill_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update a skill's editable fields. Returns None when not found.

        Raises ValueError when renaming onto an existing skill name.
        """
        async with self._session() as session:
            row = await session.get(CareerSkill, skill_id)
            if row is None:
                return None

            new_name = updates.get("name")
            if new_name is not None and new_name.lower() != row.name.lower():
                conflict = await session.execute(
                    select(CareerSkill).where(
                        func.lower(CareerSkill.name) == new_name.lower(),
                        CareerSkill.skill_id != skill_id,
                    )
                )
                if conflict.scalars().first() is not None:
                    raise ValueError(f"Skill with name {new_name!r} already exists")

            for key in ("name", "category", "proficiency", "years_experience", "last_used"):
                if key in updates:
                    setattr(row, key, updates[key])

            row.updated_at = _now()
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                raise ValueError(f"Skill with name {updates.get('name')!r} already exists")
            return self._career_skill_to_dict(row)

    async def delete_career_skill(self, skill_id: str) -> bool:
        """Delete a skill. Returns False when not found."""
        async with self._session() as session:
            row = await session.get(CareerSkill, skill_id)
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    # -- Career certifications ----------------------------------------------

    async def create_career_certification(
        self,
        name: str,
        issuer: str | None = None,
        date_obtained: str | None = None,
        url: str | None = None,
    ) -> dict[str, Any]:
        """Create a certification entry."""
        now = _now()
        async with self._session() as session:
            row = CareerCertification(
                certification_id=str(uuid4()),
                name=name,
                issuer=issuer,
                date_obtained=date_obtained,
                url=url,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            await session.commit()
            return self._career_certification_to_dict(row)

    async def list_career_certifications(self) -> list[dict[str, Any]]:
        """List all certifications ordered by name."""
        async with self._session() as session:
            result = await session.execute(
                select(CareerCertification).order_by(CareerCertification.name)
            )
            return [
                self._career_certification_to_dict(row) for row in result.scalars().all()
            ]

    async def update_career_certification(
        self, certification_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Update a certification's editable fields. Returns None when not found."""
        async with self._session() as session:
            row = await session.get(CareerCertification, certification_id)
            if row is None:
                return None
            for key in ("name", "issuer", "date_obtained", "url"):
                if key in updates:
                    setattr(row, key, updates[key])
            row.updated_at = _now()
            await session.commit()
            return self._career_certification_to_dict(row)

    async def delete_career_certification(self, certification_id: str) -> bool:
        """Delete a certification. Returns False when not found."""
        async with self._session() as session:
            row = await session.get(CareerCertification, certification_id)
            if row is None:
                return False
            await session.delete(row)
            await session.commit()
            return True

    # -- Encrypted API key store (sync; read on the LLM hot path) -----------

    def get_api_key_ciphertexts(self) -> dict[str, str]:
        """Return ``{provider: ciphertext}`` for all stored keys (sync)."""
        with self._sync() as session:
            rows = session.execute(select(ApiKey)).scalars().all()
            return {row.provider: row.ciphertext for row in rows}

    def set_api_key_ciphertext(self, provider: str, ciphertext: str) -> None:
        """Upsert one provider's ciphertext (sync)."""
        with self._sync() as session:
            row = session.get(ApiKey, provider)
            if row is None:
                session.add(
                    ApiKey(provider=provider, ciphertext=ciphertext, updated_at=_now())
                )
            else:
                row.ciphertext = ciphertext
                row.updated_at = _now()
            session.commit()

    def delete_api_key(self, provider: str) -> None:
        """Delete one provider's key (sync)."""
        with self._sync() as session:
            row = session.get(ApiKey, provider)
            if row is not None:
                session.delete(row)
                session.commit()

    def clear_api_keys(self) -> None:
        """Delete all stored keys (sync)."""
        with self._sync() as session:
            session.execute(delete(ApiKey))
            session.commit()

    def replace_api_keys(self, ciphertexts: dict[str, str]) -> None:
        """Atomically replace the whole key store (clear + insert in one txn).

        A single transaction means a failure mid-write can't leave the store
        half-cleared and wipe a user's previously saved keys.
        """
        with self._sync() as session:
            session.execute(delete(ApiKey))
            now = _now()
            for provider, ciphertext in ciphertexts.items():
                if ciphertext:
                    session.add(
                        ApiKey(provider=provider, ciphertext=ciphertext, updated_at=now)
                    )
            session.commit()

    # -- Stats / maintenance ------------------------------------------------

    async def get_stats(self) -> dict[str, Any]:
        """Get database statistics."""
        async with self._session() as session:
            resumes = await session.scalar(select(func.count()).select_from(Resume))
            jobs = await session.scalar(select(func.count()).select_from(Job))
            improvements = await session.scalar(
                select(func.count()).select_from(Improvement)
            )
            master = await session.execute(
                select(func.count()).select_from(Resume).where(Resume.is_master.is_(True))
            )
            master_resume_count = int(master.scalar_one() or 0)
            return {
                "total_resumes": int(resumes or 0),
                "total_jobs": int(jobs or 0),
                "total_improvements": int(improvements or 0),
                "has_master_resume": master_resume_count > 0,
                "master_resume_count": master_resume_count,
            }

    async def reset_database(self) -> None:
        """Reset by truncating user-document tables and clearing uploads.

        Clears resumes/jobs/improvements **and** tracker applications (leaving
        orphaned cards after a full data reset would be a bug). Encrypted
        ``api_keys`` are preserved — matching the pre-existing behavior where a
        reset never wiped the user's stored credentials.
        """
        async with self._session() as session:
            await session.execute(delete(Application))
            await session.execute(delete(Improvement))
            await session.execute(delete(Job))
            await session.execute(delete(Resume))
            await session.execute(delete(CareerProfile))
            await session.execute(delete(CareerSkill))
            await session.execute(delete(CareerCertification))
            await session.commit()

        uploads_dir = settings.data_dir / "uploads"
        if uploads_dir.exists():
            shutil.rmtree(uploads_dir)
            uploads_dir.mkdir(parents=True, exist_ok=True)

    # -- scraped jobs (drafts) -----------------------------------------------

    async def save_scraped_jobs(
        self, search_id: str, resume_id: str, jobs: list[dict[str, Any]]
    ) -> int:
        """Bulk-save scraped job listings. Returns count saved."""
        from app.models import ScrapedJob

        saved = 0
        async with self._session() as session:
            for job_data in jobs:
                existing = await session.execute(
                    select(ScrapedJob).where(
                        ScrapedJob.url == job_data.get("url", ""),
                        ScrapedJob.search_id == search_id,
                    )
                )
                if existing.first():
                    continue

                job = ScrapedJob(
                    job_id=str(uuid4()),
                    search_id=search_id,
                    resume_id=resume_id,
                    title=job_data.get("title", ""),
                    company=job_data.get("company", ""),
                    location=job_data.get("location", ""),
                    url=job_data.get("url", ""),
                    source=job_data.get("source", ""),
                    description=job_data.get("description"),
                    posted_date=job_data.get("posted_date"),
                    relevance_score=job_data.get("relevance_score", 0.0),
                    remote=job_data.get("remote", False),
                    easy_apply=job_data.get("easy_apply", False),
                    job_type=job_data.get("job_type"),
                    experience_level=job_data.get("experience_level"),
                    salary=job_data.get("salary"),
                    languages=job_data.get("languages", []),
                )
                session.add(job)
                saved += 1
            await session.commit()
        return saved

    async def get_scraped_jobs(
        self, resume_id: str, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Get all scraped job drafts for a resume."""
        from app.models import ScrapedJob

        async with self._session() as session:
            result = await session.execute(
                select(ScrapedJob)
                .where(ScrapedJob.resume_id == resume_id)
                .order_by(ScrapedJob.created_at.desc())
                .limit(limit)
            )
            rows = result.scalars().all()
            return [
                {
                    "job_id": row.job_id,
                    "search_id": row.search_id,
                    "title": row.title,
                    "company": row.company,
                    "location": row.location,
                    "url": row.url,
                    "source": row.source,
                    "description": row.description,
                    "posted_date": row.posted_date,
                    "relevance_score": row.relevance_score,
                    "remote": row.remote,
                    "easy_apply": row.easy_apply,
                    "job_type": row.job_type,
                    "experience_level": row.experience_level,
                    "salary": row.salary,
                    "languages": row.languages,
                    "applied": row.applied,
                    "applied_resume_id": row.applied_resume_id,
                    "archived": row.archived,
                    "created_at": row.created_at,
                }
                for row in rows
            ]

    async def list_scraped_jobs_for_analysis(self) -> list[dict[str, Any]]:
        """List all non-archived scraped jobs across resumes (career analysis).

        Powers the skill-ROI engine and career-memory aggregation; archived
        drafts are excluded because the user has already dismissed them.
        """
        from app.models import ScrapedJob

        async with self._session() as session:
            result = await session.execute(
                select(ScrapedJob)
                .where(ScrapedJob.archived == False)  # noqa: E712
                .order_by(ScrapedJob.created_at.desc())
            )
            rows = result.scalars().all()
            return [
                {
                    "job_id": row.job_id,
                    "title": row.title,
                    "company": row.company,
                    "location": row.location,
                    "description": row.description,
                    "salary": row.salary,
                    "experience_level": row.experience_level,
                    "job_type": row.job_type,
                    "languages": row.languages,
                }
                for row in rows
            ]

    async def delete_scraped_job(self, job_id: str) -> bool:
        """Delete a single scraped job draft."""
        from app.models import ScrapedJob

        async with self._session() as session:
            result = await session.execute(
                delete(ScrapedJob).where(ScrapedJob.job_id == job_id)
            )
            await session.commit()
            return result.rowcount > 0

    async def clear_scraped_jobs(self, resume_id: str) -> int:
        """Delete all non-archived scraped job drafts for a resume."""
        from app.models import ScrapedJob

        async with self._session() as session:
            result = await session.execute(
                delete(ScrapedJob).where(
                    ScrapedJob.resume_id == resume_id,
                    ScrapedJob.archived == False,  # noqa: E712
                )
            )
            await session.commit()
            return result.rowcount

    async def set_scraped_job_archived(self, job_id: str, archived: bool) -> bool:
        """Set the archived flag on a scraped job draft."""
        from app.models import ScrapedJob

        async with self._session() as session:
            result = await session.execute(
                select(ScrapedJob).where(ScrapedJob.job_id == job_id)
            )
            row = result.scalar_one_or_none()
            if not row:
                return False
            row.archived = archived
            await session.commit()
            return True

    async def mark_scraped_job_applied(self, job_id: str, resume_id: str) -> bool:
        """Mark a scraped job draft as applied with the tailored resume ID."""
        from app.models import ScrapedJob

        async with self._session() as session:
            result = await session.execute(
                select(ScrapedJob).where(ScrapedJob.job_id == job_id)
            )
            row = result.scalar_one_or_none()
            if not row:
                return False
            row.applied = True
            row.applied_resume_id = resume_id
            await session.commit()
            return True

    async def career_data_fingerprint(self) -> str:
        """Fingerprint of every table feeding the career-memory bundle.

        Any write that affects the memory (applications, scraped jobs, career
        profile/skills/certifications, contacts, resumes, API keys) changes the
        row counts or the latest ``updated_at``, so the stamp changes and the
        in-process career caches rebuild. Queries go through the ORM models
        (row count + latest timestamp, preferring ``updated_at`` when the
        table has it) so tables without an ``updated_at`` column still count.
        """
        from app.models import (  # local import: avoids module-cycle surprises
            ApiKey,
            Application,
            CareerCertification,
            CareerProfile,
            CareerSkill,
            Contact,
            Resume,
            ScrapedJob,
        )

        table_models = (
            ("applications", Application, "updated_at"),
            ("scraped_jobs", ScrapedJob, "created_at"),
            ("career_profiles", CareerProfile, "updated_at"),
            ("career_skills", CareerSkill, "updated_at"),
            ("career_certifications", CareerCertification, "updated_at"),
            ("contacts", Contact, "updated_at"),
            ("resumes", Resume, "updated_at"),
            ("api_keys", ApiKey, "updated_at"),
        )
        parts: list[str] = []
        async with self._session() as session:
            for name, model, ts_col in table_models:
                count, latest = (
                    await session.execute(
                        select(func.count(), func.max(getattr(model, ts_col)))
                    )
                ).one()
                parts.append(f"{name}:{count}:{latest}")
        return hashlib.sha256("|".join(parts).encode()).hexdigest()


# Global database instance
db = Database()
