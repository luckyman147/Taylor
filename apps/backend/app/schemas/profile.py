"""Pydantic schemas for the career profile (My Profile page)."""

from __future__ import annotations

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
    """Profile plus its skills, certifications and career-graph nodes."""

    profile: ProfileResponse
    skills: list[SkillResponse]
    certifications: list[CertificationResponse]
    education: list[EducationResponse] = Field(default_factory=list)
    projects: list[ProjectResponse] = Field(default_factory=list)
    achievements: list[AchievementResponse] = Field(default_factory=list)


class EducationResponse(BaseModel):
    """An education entry on the career graph."""

    education_id: str
    institution: str
    degree: str | None = None
    years: str | None = None
    description: str | None = None
    created_at: str
    updated_at: str


class EducationCreate(BaseModel):
    """Create an education entry — only ``institution`` is required."""

    institution: str = Field(min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=200)
    years: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)


class EducationUpdate(BaseModel):
    """Partial update — every field optional."""

    institution: str | None = Field(default=None, min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=200)
    years: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)


class ProjectResponse(BaseModel):
    """A personal project node on the career graph."""

    project_id: str
    name: str
    role: str | None = None
    years: str | None = None
    github: str | None = None
    website: str | None = None
    description: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    readme: str | None = None
    created_at: str
    updated_at: str


class ProjectCreate(BaseModel):
    """Create a project node — only ``name`` is required."""

    name: str = Field(min_length=1, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    years: str | None = Field(default=None, max_length=100)
    github: str | None = Field(default=None, max_length=500)
    website: str | None = Field(default=None, max_length=500)
    description: list[str] = Field(default_factory=list, max_length=100)
    languages: list[str] = Field(default_factory=list, max_length=50)
    readme: str | None = Field(default=None, max_length=10000)

    @field_validator("description", "languages")
    @classmethod
    def _validate_list(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        # De-duplicate case-insensitively, keeping first occurrence order.
        seen: set[str] = set()
        result: list[str] = []
        for item in cleaned:
            key = item.lower()
            if key not in seen:
                seen.add(key)
                result.append(item)
        return result


class ProjectUpdate(BaseModel):
    """Partial update — every field optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    years: str | None = Field(default=None, max_length=100)
    github: str | None = Field(default=None, max_length=500)
    website: str | None = Field(default=None, max_length=500)
    description: list[str] | None = Field(default=None, max_length=100)
    languages: list[str] | None = Field(default=None, max_length=50)
    readme: str | None = Field(default=None, max_length=10000)

    @field_validator("description", "languages")
    @classmethod
    def _validate_list(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [item.strip() for item in value if item.strip()]
        seen: set[str] = set()
        result: list[str] = []
        for item in cleaned:
            key = item.lower()
            if key not in seen:
                seen.add(key)
                result.append(item)
        return result


class GitHubImportRequest(BaseModel):
    """Select which GitHub repos to import as projects.

    ``repo_urls`` is optional — an empty list means "import everything the
    GitHub adapter returned".
    """

    repo_urls: list[str] = Field(default_factory=list)


class AchievementResponse(BaseModel):
    """An achievement node on the career graph."""

    achievement_id: str
    title: str
    description: str | None = None
    date: str | None = None
    created_at: str
    updated_at: str


class AchievementCreate(BaseModel):
    """Create an achievement — only ``title`` is required."""

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    date: str | None = None

    @field_validator("date")
    @classmethod
    def _validate_date(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _YEAR_MONTH_RE.match(value.strip()):
            raise ValueError("date must be 'YYYY' or 'YYYY-MM'")
        return value.strip()


class AchievementUpdate(BaseModel):
    """Partial update — every field optional."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    date: str | None = None

    @field_validator("date")
    @classmethod
    def _validate_date(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not _YEAR_MONTH_RE.match(value.strip()):
            raise ValueError("date must be 'YYYY' or 'YYYY-MM'")
        return value.strip()


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
    """The aggregated career-memory bundle served to the chat / insights LLM.

    Graph nodes are plain dicts (not full response models): the builder caps
    and reshapes them (e.g. adds linked ``skills`` to projects), so the
    schema only pins the top-level shape.
    """

    profile: ProfileResponse
    skills: list[SkillResponse]
    certifications: list[CertificationResponse]
    education: list[dict[str, Any]] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    achievements: list[dict[str, Any]] = Field(default_factory=list)
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
    """One skill's ROI score over the user's saved job pool.

    ``action`` classifies the row for the job-focused view: ``"learn"``
    (missing from the profile), ``"strengthen"`` (in profile, in demand,
    weak) or ``"monitor"`` (everything else).
    """

    skill: str
    jobs_unlocked_pct: float
    matching_jobs: int
    salary_impact_pct: float | None = None
    learning_effort: str
    existing_knowledge: int
    roi_score: int
    action: Literal["learn", "strengthen", "monitor"] = "monitor"
    in_profile: bool = False


class CareerRoiRequest(BaseModel):
    """Compute skill ROI; ``skills`` defaults to missing skills in the job pool."""

    skills: list[str] | None = Field(default=None, max_length=30)
    include_advice: bool = False


class CareerRoiResponse(BaseModel):
    """Sorted ROI table plus the job-focused sections and optional LLM advice.

    ``gaps`` (skills to learn) and ``strengthen`` (skills to improve) are the
    actionable view; ``rest`` holds everything else (already strong or not in
    demand). ``results`` keeps the full table for the advisor and legacy
    consumers.
    """

    results: list[SkillRoiRow]
    advice: str | None = None
    note: str | None = None
    gaps: list[SkillRoiRow] = Field(default_factory=list)
    strengthen: list[SkillRoiRow] = Field(default_factory=list)
    rest: list[SkillRoiRow] = Field(default_factory=list)


class SkillResource(BaseModel):
    """A server-verified learning resource for a skill."""

    title: str
    url: str
    source: str = ""


class SkillResourcesRequest(BaseModel):
    """Request verified learning resources for specific skills."""

    skills: list[str] = Field(min_length=1, max_length=12)
    refresh: bool = False


class SkillResourcesResponse(BaseModel):
    """Verified learning resources per skill (skill name -> resources)."""

    resources: dict[str, list[SkillResource]]
    note: str | None = None


class SkillSuggestion(BaseModel):
    """One AI-suggested skill: remembered (forgot to list) or learn_next (2026)."""

    name: str
    reason: str = ""
    kind: Literal["remembered", "learn_next"] = "remembered"


class SkillSuggestionsResponse(BaseModel):
    """AI 'forgotten skills' suggestions (LLM-optional; note when unavailable)."""

    skills: list[SkillSuggestion] = Field(default_factory=list)
    note: str | None = None


class SkillPosition(BaseModel):
    """One tracked skill's modeled market percentile."""

    skill: str
    percentile: int
    level: Literal["beginner", "intermediate", "advanced", "expert"]


class DomainPosition(BaseModel):
    """One job domain's aggregated market position."""

    domain: str
    percentile: int
    seniority: Literal["junior", "mid", "senior"]
    readiness: Literal["strong", "adequate", "underqualified"]


class RolePosition(BaseModel):
    """A recommended role title with its evidence-based match score."""

    role: str
    domain: str
    seniority: Literal["junior", "mid", "senior"]
    match_score: int
    reason: str


class MarketPositionResponse(BaseModel):
    """Deterministic market-position model over local profile data.

    Percentiles are 0-100 integers mapped from a modeled candidate
    distribution; ``current_role`` names the exact position (e.g.
    "Mid Backend Engineer"), ``specialization`` the top skills of that
    domain, ``recommended_roles`` the best-fit roles to pick, and
    ``verdict`` template sentences. Never requires an LLM.
    """

    skills: list[SkillPosition] = Field(default_factory=list)
    domains: list[DomainPosition] = Field(default_factory=list)
    current_role: str | None = None
    specialization: list[str] = Field(default_factory=list)
    recommended_roles: list[RolePosition] = Field(default_factory=list)
    verdict: str
    note: str | None = None


class ProfileSuggestionsResponse(BaseModel):
    """Tag suggestions for the profile form (roles / locations / goals)."""

    suggestions: list[str]
