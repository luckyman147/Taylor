"""SQLAlchemy ORM models for Resume Matcher.

A single declarative ``Base`` backs all tables (doc tables migrated from
TinyDB plus the new ``applications`` and ``api_keys`` tables). The facade in
``app/database.py`` converts ORM rows to plain dicts so the rest of the app
never sees ORM objects — preserving the TinyDB-era contracts.
"""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow_iso() -> str:
    """Return the current UTC time as an ISO-8601 string.

    Timestamps are stored as strings (not native datetimes) to preserve the
    TinyDB-era behavior: code compares them lexically and returns them to
    clients verbatim.
    """
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    """Declarative base shared by every table."""


class Resume(Base):
    """A resume document (master or tailored)."""

    __tablename__ = "resumes"

    resume_id: Mapped[str] = mapped_column(String, primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(String, default="md")
    filename: Mapped[str | None] = mapped_column(String, nullable=True)
    is_master: Mapped[bool] = mapped_column(Boolean, default=False)
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    processed_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    processing_status: Mapped[str] = mapped_column(String, default="pending")
    cover_letter: Mapped[str | None] = mapped_column(Text, nullable=True)
    outreach_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    interview_prep: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    # original_markdown has *absence* semantics in the TinyDB era: the key was
    # omitted entirely when None. The facade reproduces that by only emitting
    # the key when this column is non-null.
    original_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class Job(Base):
    """A job description.

    Only the stable columns are first-class; everything the pipeline attaches
    dynamically (``job_keywords``, ``job_keywords_hash``, ``preview_hash``,
    ``preview_hashes``, ``preview_prompt_id``, ``company``, ``role``) lives in
    ``metadata_json``. The facade flattens that map to top-level keys on read
    and merges non-core keys into it on update, reproducing TinyDB semantics.
    """

    __tablename__ = "jobs"

    job_id: Mapped[str] = mapped_column(String, primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    resume_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Improvement(Base):
    """A tailoring result linking an original resume, a tailored resume, and a job."""

    __tablename__ = "improvements"

    request_id: Mapped[str] = mapped_column(String, primary_key=True)
    original_resume_id: Mapped[str] = mapped_column(String)
    tailored_resume_id: Mapped[str] = mapped_column(String, index=True)
    job_id: Mapped[str] = mapped_column(String)
    improvements: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class Application(Base):
    """A Kanban application-tracker card."""

    __tablename__ = "applications"
    __table_args__ = (
        # Concurrency-safe dedupe: a card is unique per (job, applied resume).
        # The app-level select-then-insert relies on this to collapse races.
        UniqueConstraint("job_id", "resume_id", name="uq_application_job_resume"),
    )

    application_id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str] = mapped_column(String, index=True)
    # The applied/tailored resume shown in the modal and opened by "Edit".
    resume_id: Mapped[str] = mapped_column(String, index=True)
    # Optional base resume the tailored one descends from (powers "stack" grouping).
    master_resume_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="applied", index=True)
    company: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str | None] = mapped_column(String, nullable=True)
    applied_at: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rejection-learning fields (opt-in, powers career insights).
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    interview_rounds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class Company(Base):
    """A tracked company the user applies to.

    ``company_size`` / ``company_type`` store stable enum keys (decoupled from
    i18n labels); ``email`` / ``website`` / ``linkedin_url`` are stored as
    plain strings. ``name`` is unique (case-insensitively enforced by the
    facade) so a company can't be created twice.
    """

    __tablename__ = "companies"

    company_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    company_size: Mapped[str | None] = mapped_column(String, nullable=True)
    company_type: Mapped[str | None] = mapped_column(String, nullable=True)
    linkedin_url: Mapped[str | None] = mapped_column(String, nullable=True)
    industry: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    year_founded: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class Contact(Base):
    """A tracked networking contact.

    ``goal`` / ``status`` / ``relationship`` store stable enum keys (decoupled
    from i18n labels). ``name`` is unique (case-insensitively enforced by the
    facade) so a contact can't be created twice.
    """

    __tablename__ = "contacts"

    contact_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    company: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    goal: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    relationship: Mapped[str | None] = mapped_column(String, nullable=True)
    follow_up_date: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class ApiKey(Base):
    """An encrypted LLM provider API key.

    ``provider`` is the *key-store* provider name (e.g. ``google`` for the
    ``gemini`` LLM provider, via ``_PROVIDER_KEY_MAP``). Only ciphertext is
    stored; plaintext exists in memory only at call time.
    """

    __tablename__ = "api_keys"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class CareerProfile(Base):
    """The user's single-row career profile (My Profile page).

    ``career_goals`` / ``target_roles`` / ``target_locations`` store JSON lists
    of free-text strings. Personal info is seeded from the master resume's
    ``personalInfo`` but is editable here independently.
    """

    __tablename__ = "career_profiles"

    profile_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    linkedin: Mapped[str | None] = mapped_column(String, nullable=True)
    github: Mapped[str | None] = mapped_column(String, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    career_goals: Mapped[list] = mapped_column(JSON, default=list)
    target_roles: Mapped[list] = mapped_column(JSON, default=list)
    target_locations: Mapped[list] = mapped_column(JSON, default=list)
    target_salary_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_salary_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    work_experience: Mapped[list] = mapped_column(JSON, default=list)
    languages: Mapped[list] = mapped_column(JSON, default=list)
    awards: Mapped[list] = mapped_column(JSON, default=list)
    source_resume_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_resume_title: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class CareerSkill(Base):
    """A skill on the user's career profile.

    ``proficiency`` is 1-5; ``last_used`` is a "YYYY" or "YYYY-MM" string.
    ``name`` is unique (case-insensitively enforced by the facade) so a skill
    can't be added twice.
    """

    __tablename__ = "career_skills"

    skill_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    proficiency: Mapped[int | None] = mapped_column(Integer, nullable=True)
    years_experience: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_used: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class CareerCertification(Base):
    """A certification listed on the user's career profile."""

    __tablename__ = "career_certifications"

    certification_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    issuer: Mapped[str | None] = mapped_column(String, nullable=True)
    date_obtained: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)


class ScrapedJob(Base):
    """A scraped job listing saved as a draft."""

    __tablename__ = "scraped_jobs"

    job_id: Mapped[str] = mapped_column(String, primary_key=True)
    search_id: Mapped[str] = mapped_column(String, index=True)
    resume_id: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    company: Mapped[str] = mapped_column(String, default="")
    location: Mapped[str] = mapped_column(String, default="")
    url: Mapped[str] = mapped_column(String, default="")
    source: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    posted_date: Mapped[str | None] = mapped_column(String, nullable=True)
    relevance_score: Mapped[float] = mapped_column(default=0.0)
    remote: Mapped[bool] = mapped_column(Boolean, default=False)
    easy_apply: Mapped[bool] = mapped_column(Boolean, default=False)
    job_type: Mapped[str | None] = mapped_column(String, nullable=True)
    experience_level: Mapped[str | None] = mapped_column(String, nullable=True)
    salary: Mapped[str | None] = mapped_column(String, nullable=True)
    languages: Mapped[list] = mapped_column(JSON, default=list)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    applied_resume_id: Mapped[str | None] = mapped_column(String, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow_iso)
