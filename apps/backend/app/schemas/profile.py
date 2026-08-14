"""Pydantic schemas for the career profile (My Profile page)."""

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

_YEAR_MONTH_RE = re.compile(r"^\d{4}(-\d{2})?$")


class WorkExperienceItem(BaseModel):
    """One structured work experience entry (role/company/location/years + bullets)."""

    role: str = ""
    company: str | None = None
    location: str | None = None
    years: str | None = None
    description: list[str] = Field(default_factory=list)


class ProfileResponse(BaseModel):
    """The user's single-row career profile."""

    profile_id: str
    name: str | None = None
    title: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    website: str | None = None
    linkedin: str | None = None
    github: str | None = None
    summary: str | None = None
    career_goals: list[str] = Field(default_factory=list)
    target_roles: list[str] = Field(default_factory=list)
    target_locations: list[str] = Field(default_factory=list)
    target_salary_min: int | None = None
    target_salary_max: int | None = None
    work_experience: list[WorkExperienceItem] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    awards: list[str] = Field(default_factory=list)
    source_resume_id: str | None = None
    source_resume_title: str | None = None
    created_at: str
    updated_at: str


class ProfileUpdate(BaseModel):
    """Partial update — every field optional."""

    name: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    website: str | None = Field(default=None, max_length=500)
    linkedin: str | None = Field(default=None, max_length=500)
    github: str | None = Field(default=None, max_length=500)
    summary: str | None = Field(default=None, max_length=5000)
    career_goals: list[str] | None = Field(default=None, max_length=50)
    target_roles: list[str] | None = Field(default=None, max_length=50)
    target_locations: list[str] | None = Field(default=None, max_length=50)
    target_salary_min: int | None = Field(default=None, ge=0, le=9_999_999)
    target_salary_max: int | None = Field(default=None, ge=0, le=9_999_999)
    work_experience: list[WorkExperienceItem] | None = Field(default=None, max_length=100)
    languages: list[str] | None = Field(default=None, max_length=100)
    awards: list[str] | None = Field(default=None, max_length=100)

    @field_validator("career_goals", "target_roles", "target_locations", "languages", "awards")
    @classmethod
    def _validate_string_lists(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return [item.strip() for item in value if item.strip()]

    @field_validator("work_experience")
    @classmethod
    def _validate_work_experience(
        cls, value: list[WorkExperienceItem] | None
    ) -> list[WorkExperienceItem] | None:
        if value is None:
            return None
        cleaned: list[WorkExperienceItem] = []
        for item in value:
            role = item.role.strip()
            company = (item.company or "").strip()
            if not role and not company:
                continue
            cleaned.append(
                WorkExperienceItem(
                    role=role,
                    company=company or None,
                    location=(item.location or "").strip() or None,
                    years=(item.years or "").strip() or None,
                    description=[
                        bullet.strip() for bullet in item.description if bullet.strip()
                    ],
                )
            )
        return cleaned


class SeedFromResumeRequest(BaseModel):
    """Pick which resume to seed the profile from; ``None`` = the master resume."""

    resume_id: str | None = None


class SkillResponse(BaseModel):
    """A skill on the career profile."""

    skill_id: str
    name: str
    category: str | None = None
    proficiency: int | None = None
    years_experience: int | None = None
    last_used: str | None = None
    created_at: str
    updated_at: str


class SkillCreate(BaseModel):
    """Create a skill — only ``name`` is required."""

    name: str = Field(min_length=1, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    proficiency: int | None = Field(default=None, ge=1, le=5)
    years_experience: int | None = Field(default=None, ge=0, le=60)
    last_used: str | None = None

    @field_validator("last_used")
    @classmethod
    def _validate_last_used(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _YEAR_MONTH_RE.match(value.strip()):
            raise ValueError("last_used must be 'YYYY' or 'YYYY-MM'")
        return value.strip()


class SkillUpdate(BaseModel):
    """Partial update — every field optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    proficiency: int | None = Field(default=None, ge=1, le=5)
    years_experience: int | None = Field(default=None, ge=0, le=60)
    last_used: str | None = None

    @field_validator("last_used")
    @classmethod
    def _validate_last_used(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _YEAR_MONTH_RE.match(value.strip()):
            raise ValueError("last_used must be 'YYYY' or 'YYYY-MM'")
        return value.strip()


class CertificationResponse(BaseModel):
    """A certification on the career profile."""

    certification_id: str
    name: str
    issuer: str | None = None
    date_obtained: str | None = None
    url: str | None = None
    created_at: str
    updated_at: str


class CertificationCreate(BaseModel):
    """Create a certification — only ``name`` is required."""

    name: str = Field(min_length=1, max_length=200)
    issuer: str | None = Field(default=None, max_length=200)
    date_obtained: str | None = None
    url: str | None = Field(default=None, max_length=500)

    @field_validator("date_obtained")
    @classmethod
    def _validate_date_obtained(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _YEAR_MONTH_RE.match(value.strip()):
            raise ValueError("date_obtained must be 'YYYY' or 'YYYY-MM'")
        return value.strip()


class CertificationUpdate(BaseModel):
    """Partial update — every field optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    issuer: str | None = Field(default=None, max_length=200)
    date_obtained: str | None = None
    url: str | None = Field(default=None, max_length=500)

    @field_validator("date_obtained")
    @classmethod
    def _validate_date_obtained(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _YEAR_MONTH_RE.match(value.strip()):
            raise ValueError("date_obtained must be 'YYYY' or 'YYYY-MM'")
        return value.strip()


class ProfileBundleResponse(BaseModel):
    """Profile plus its skills and certifications."""

    profile: ProfileResponse
    skills: list[SkillResponse]
    certifications: list[CertificationResponse]


class CareerActionResponse(BaseModel):
    """Generic acknowledgement for destructive actions."""

    message: str
    affected: int


class FunnelStats(BaseModel):
    """Deterministic rejection-learning statistics over tracker applications."""

    total: int
    by_status: dict[str, int]
    rejected: int
    interviewed: int
    accepted: int
    rejection_rate: float
    applied_to_interview_rate: float
    interview_to_accepted_rate: float
    median_days_to_interview: float | None = None
    top_companies: list[dict[str, Any]] = Field(default_factory=list)
    rejection_reasons: list[dict[str, Any]] = Field(default_factory=list)


class CareerMemoryResponse(BaseModel):
    """The aggregated career-memory bundle served to the chat / insights LLM."""

    profile: ProfileResponse
    skills: list[SkillResponse]
    certifications: list[CertificationResponse]
    master_resume: dict[str, Any] | None = None
    funnel: FunnelStats
    rejected_applications: list[dict[str, Any]] = Field(default_factory=list)
    contacts: list[dict[str, Any]] = Field(default_factory=list)
    scraped_jobs: list[dict[str, Any]] = Field(default_factory=list)
    github_repos: list[dict[str, Any]] = Field(default_factory=list)


class ChatMessage(BaseModel):
    """One turn of chat history (kept short for context budget)."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class CareerAskRequest(BaseModel):
    """Ask the career advisor a question about the user's career memory."""

    question: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=8)


class CareerAskResponse(BaseModel):
    """The advisor's answer (Markdown)."""

    answer: str


class CareerInsightsResponse(BaseModel):
    """Rejection-learning insights: deterministic stats + optional LLM narrative."""

    stats: FunnelStats
    narrative: str | None = None


class SkillRoiRow(BaseModel):
    """One skill's ROI score over the user's saved job pool."""

    skill: str
    jobs_unlocked_pct: float
    matching_jobs: int
    salary_impact_pct: float | None = None
    learning_effort: str
    existing_knowledge: int
    roi_score: int


class CareerRoiRequest(BaseModel):
    """Compute skill ROI; ``skills`` defaults to missing skills in the job pool."""

    skills: list[str] | None = Field(default=None, max_length=30)
    include_advice: bool = False


class CareerRoiResponse(BaseModel):
    """Sorted ROI table plus an optional LLM 'learn next' recommendation."""

    results: list[SkillRoiRow]
    advice: str | None = None
    note: str | None = None


class ProfileSuggestionsResponse(BaseModel):
    """Tag suggestions for the profile form (roles / locations / goals)."""

    suggestions: list[str]
