"""Pydantic models matching frontend expectations."""

import copy
import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_TEXT_VALUE_KEYS = (
    "text",
    "summary",
    "description",
    "value",
    "content",
    "title",
    "subtitle",
    "name",
    "label",
)
_BULLET_PREFIX_RE = re.compile(r"^\s*(?:[-*•]+|\d+[.)])\s*")


def _extract_text_fragments(
    value: Any, depth: int = 0, max_depth: int = 10
) -> list[str]:
    """Extract text-like content from nested list/dict values."""
    if depth >= max_depth or value is None:
        return []

    if isinstance(value, str):
        stripped = value.strip()
        return [stripped] if stripped else []

    if isinstance(value, (int, float)):
        return [str(value)]

    if isinstance(value, list):
        fragments: list[str] = []
        for item in value:
            fragments.extend(_extract_text_fragments(item, depth + 1, max_depth))
        return fragments

    if isinstance(value, dict):
        fragments: list[str] = []

        for key in _TEXT_VALUE_KEYS:
            if key in value:
                fragments.extend(
                    _extract_text_fragments(value.get(key), depth + 1, max_depth)
                )

        if fragments:
            return fragments

        for nested in value.values():
            fragments.extend(_extract_text_fragments(nested, depth + 1, max_depth))
        return fragments

    return []


def _coerce_text(value: Any, joiner: str = " ") -> str:
    """Coerce nested values into a single text string."""
    return joiner.join(_extract_text_fragments(value)).strip()


def _coerce_optional_text(value: Any) -> str | None:
    """Coerce nested values into optional text."""
    if value is None:
        return None
    text = _coerce_text(value)
    return text or None


def _split_description_lines(value: str) -> list[str]:
    """Split a description block into clean bullet lines."""
    items: list[str] = []
    for raw_line in re.split(r"\r?\n+", value):
        line = _BULLET_PREFIX_RE.sub("", raw_line.strip())
        if line:
            items.append(line)
    return items


def _coerce_string_list(value: Any) -> list[str]:
    """Coerce nested/string values into a list of strings."""
    if value is None:
        return []

    if isinstance(value, str):
        return _split_description_lines(value)

    if isinstance(value, list):
        items: list[str] = []
        for entry in value:
            if isinstance(entry, str):
                items.extend(_split_description_lines(entry))
                continue

            coerced = _coerce_text(entry)
            if coerced:
                items.append(coerced)
        return items

    coerced = _coerce_text(value)
    return [coerced] if coerced else []


def _split_list_entries(value: str) -> list[str]:
    """Split a string into list entries on commas/semicolons.

    Commas inside parentheses (e.g. "PHP (Laravel, Symfony)") are preserved.
    Empty parts are dropped and entries are deduplicated case-insensitively,
    keeping the first occurrence's casing.
    """
    if not value:
        return []

    parts: list[str] = []
    current: list[str] = []
    depth = 0
    for char in value:
        if char in "([":
            depth += 1
            current.append(char)
        elif char in ")]":
            depth = max(0, depth - 1)
            current.append(char)
        elif char in ",;" and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))

    seen: set[str] = set()
    entries: list[str] = []
    for part in parts:
        entry = part.strip()
        if not entry:
            continue
        key = entry.casefold()
        if key in seen:
            continue
        seen.add(key)
        entries.append(entry)
    return entries


def _coerce_description_styles(value: Any) -> list[Literal["bullet", "plain"]]:
    """Coerce description style values into supported row styles."""
    if not isinstance(value, list):
        return []

    return ["plain" if entry == "plain" else "bullet" for entry in value]


def _align_description_styles(
    description: list[str],
    description_styles: list[Literal["bullet", "plain"]],
) -> list[Literal["bullet", "plain"]]:
    """Keep descriptionStyles aligned with description rows."""
    return [
        description_styles[index] if index < len(description_styles) else "bullet"
        for index, _ in enumerate(description)
    ]


# Section Type Enum for dynamic sections
class SectionType(str, Enum):
    """Types of resume sections."""

    PERSONAL_INFO = "personalInfo"  # Special: always first, not reorderable
    TEXT = "text"  # Single text block (like summary)
    ITEM_LIST = "itemList"  # Array of items with fields (like experience)
    STRING_LIST = "stringList"  # Array of strings (like skills)


# Resume Data Models (matching frontend types in resume-component.tsx)
class PersonalInfo(BaseModel):
    """Personal information section."""

    name: str = ""
    title: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    website: str | None = None
    linkedin: str | None = None
    github: str | None = None
    contactDisplay: dict[str, Literal["full", "label"]] = Field(default_factory=dict)


class Experience(BaseModel):
    """Work experience entry."""

    id: int = 0
    title: str = ""
    company: str = ""
    location: str | None = None
    years: str = ""
    description: list[str] = Field(default_factory=list)
    descriptionStyles: list[Literal["bullet", "plain"]] = Field(default_factory=list)

    @field_validator("description", mode="before")
    @classmethod
    def _normalize_description(cls, value: Any) -> list[str]:
        return _coerce_string_list(value)

    @field_validator("descriptionStyles", mode="before")
    @classmethod
    def _normalize_description_styles(
        cls, value: Any
    ) -> list[Literal["bullet", "plain"]]:
        return _coerce_description_styles(value)

    @model_validator(mode="after")
    def _sync_description_styles(self) -> "Experience":
        self.descriptionStyles = _align_description_styles(
            self.description, self.descriptionStyles
        )
        return self


class Education(BaseModel):
    """Education entry."""

    id: int = 0
    institution: str = ""
    degree: str = ""
    years: str = ""
    description: str | None = None

    @field_validator("description", mode="before")
    @classmethod
    def _normalize_description(cls, value: Any) -> str | None:
        return _coerce_optional_text(value)


class Project(BaseModel):
    """Personal project entry."""

    id: int = 0
    name: str = ""
    role: str = ""
    years: str = ""
    github: str | None = None
    website: str | None = None
    description: list[str] = Field(default_factory=list)
    descriptionStyles: list[Literal["bullet", "plain"]] = Field(default_factory=list)

    @field_validator("description", mode="before")
    @classmethod
    def _normalize_description(cls, value: Any) -> list[str]:
        return _coerce_string_list(value)

    @field_validator("descriptionStyles", mode="before")
    @classmethod
    def _normalize_description_styles(
        cls, value: Any
    ) -> list[Literal["bullet", "plain"]]:
        return _coerce_description_styles(value)

    @model_validator(mode="after")
    def _sync_description_styles(self) -> "Project":
        self.descriptionStyles = _align_description_styles(
            self.description, self.descriptionStyles
        )
        return self


class SkillGroup(BaseModel):
    """A category of technical skills (e.g. "Frontend" -> ["React", "Next.js"]).

    Written by the tailoring pipeline's deterministic skill-presentation
    step; empty (default) means the resume is presented as the flat
    ``technicalSkills`` list.
    """

    name: str
    skills: list[str] = Field(default_factory=list)


class AdditionalInfo(BaseModel):
    """Additional information section."""

    technicalSkills: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    certificationsTraining: list[str] = Field(default_factory=list)
    awards: list[str] = Field(default_factory=list)
    skillGroups: list[SkillGroup] = Field(default_factory=list)

    @field_validator(
        "technicalSkills",
        "languages",
        "certificationsTraining",
        "awards",
        mode="before",
    )
    @classmethod
    def _normalize_string_fields(cls, value: Any) -> list[str]:
        items = _coerce_string_list(value)
        entries: list[str] = []
        seen: set[str] = set()
        for item in items:
            for entry in _split_list_entries(item):
                key = entry.casefold()
                if key in seen:
                    continue
                seen.add(key)
                entries.append(entry)
        return entries


# Section Metadata Models for dynamic section management
class SectionMeta(BaseModel):
    """Metadata for a resume section."""

    id: str  # Unique identifier (e.g., "summary", "custom_1")
    key: str  # Data key (matches ResumeData field or customSections key)
    displayName: str  # User-visible name
    sectionType: SectionType  # Type of section
    isDefault: bool = True  # True for built-in sections
    isVisible: bool = True  # Whether to show in resume
    order: int = 0  # Display order (0 = first after personalInfo)


class CustomSectionItem(BaseModel):
    """Generic item for custom item-based sections."""

    id: int = 0
    title: str = ""  # Primary title
    subtitle: str | None = None  # Secondary info (company, institution, etc.)
    location: str | None = None
    years: str = ""
    description: list[str] = Field(default_factory=list)
    descriptionStyles: list[Literal["bullet", "plain"]] = Field(default_factory=list)

    @field_validator("description", mode="before")
    @classmethod
    def _normalize_description(cls, value: Any) -> list[str]:
        return _coerce_string_list(value)

    @field_validator("descriptionStyles", mode="before")
    @classmethod
    def _normalize_description_styles(
        cls, value: Any
    ) -> list[Literal["bullet", "plain"]]:
        return _coerce_description_styles(value)

    @model_validator(mode="after")
    def _sync_description_styles(self) -> "CustomSectionItem":
        self.descriptionStyles = _align_description_styles(
            self.description, self.descriptionStyles
        )
        return self


class CustomSection(BaseModel):
    """Custom section data container."""

    sectionType: SectionType
    items: list[CustomSectionItem] | None = None  # For ITEM_LIST
    strings: list[str] | None = None  # For STRING_LIST
    text: str | None = None  # For TEXT

    @field_validator("items", mode="before")
    @classmethod
    def _normalize_items(cls, value: Any) -> Any:
        if value is None:
            return None
        if not isinstance(value, list):
            return value
        result = []
        for i, item in enumerate(value):
            if isinstance(item, str):
                result.append({"id": i + 1, "title": item})
            else:
                result.append(item)
        return result

    @field_validator("strings", mode="before")
    @classmethod
    def _normalize_strings(cls, value: Any) -> list[str] | None:
        if value is None:
            return None
        return _coerce_string_list(value)

    @field_validator("text", mode="before")
    @classmethod
    def _normalize_text(cls, value: Any) -> str | None:
        return _coerce_optional_text(value)


# Default section metadata for backward compatibility
DEFAULT_SECTION_META: list[dict[str, Any]] = [
    {
        "id": "personalInfo",
        "key": "personalInfo",
        "displayName": "Personal Info",
        "sectionType": SectionType.PERSONAL_INFO,
        "isDefault": True,
        "isVisible": True,
        "order": 0,
    },
    {
        "id": "summary",
        "key": "summary",
        "displayName": "Summary",
        "sectionType": SectionType.TEXT,
        "isDefault": True,
        "isVisible": True,
        "order": 1,
    },
    {
        "id": "workExperience",
        "key": "workExperience",
        "displayName": "Experience",
        "sectionType": SectionType.ITEM_LIST,
        "isDefault": True,
        "isVisible": True,
        "order": 2,
    },
    {
        "id": "education",
        "key": "education",
        "displayName": "Education",
        "sectionType": SectionType.ITEM_LIST,
        "isDefault": True,
        "isVisible": True,
        "order": 3,
    },
    {
        "id": "personalProjects",
        "key": "personalProjects",
        "displayName": "Projects",
        "sectionType": SectionType.ITEM_LIST,
        "isDefault": True,
        "isVisible": True,
        "order": 4,
    },
    {
        "id": "skills",
        "key": "skills",
        "displayName": "Skills",
        "sectionType": SectionType.STRING_LIST,
        "isDefault": True,
        "isVisible": True,
        "order": 5,
    },
]


def normalize_resume_data(data: dict[str, Any]) -> dict[str, Any]:
    """Ensure resume data has section metadata (migration helper).

    This function is used for lazy migration of existing resumes
    that don't have sectionMeta or customSections fields.
    """
    if not data.get("sectionMeta"):
        # Use deepcopy to avoid shared mutable reference bug
        # Without this, all resumes would share the same list reference
        data["sectionMeta"] = copy.deepcopy(DEFAULT_SECTION_META)
    else:
        # Migrate legacy 'additional' section id/key to 'skills'
        # to match the frontend's DEFAULT_SECTION_META.
        migrated = False
        for section in data["sectionMeta"]:
            if section.get("id") == "additional":
                section["id"] = "skills"
                migrated = True
            if section.get("key") == "additional":
                section["key"] = "skills"
                if not migrated:
                    migrated = True
        # If the migration removed a duplicate (both 'additional' and 'skills'
        # existed), deduplicate by keeping the 'skills' entry.
        if migrated:
            seen_ids: set[str] = set()
            deduped: list[dict[str, Any]] = []
            for section in data["sectionMeta"]:
                sid = section.get("id", "")
                if sid in seen_ids:
                    continue
                seen_ids.add(sid)
                deduped.append(section)
            data["sectionMeta"] = deduped
    if "customSections" not in data:
        data["customSections"] = {}
    return data


def _assign_unique_ids(items: list[Any]) -> None:
    """Renumber zero/duplicate entry ``id`` values to unique positives (in place).

    Keeps already-unique positive ids untouched; zeros, negatives and
    duplicates get the first missing positive integer, in order.
    """
    seen: set[int] = set()
    next_id = 1
    for item in items:
        if item.id in seen or item.id <= 0:
            while next_id in seen:
                next_id += 1
            item.id = next_id
        seen.add(item.id)


class ResumeData(BaseModel):
    """Complete structured resume data."""

    # Existing fields (kept for backward compatibility)
    personalInfo: PersonalInfo = Field(default_factory=PersonalInfo)
    summary: str = ""
    workExperience: list[Experience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    personalProjects: list[Project] = Field(default_factory=list)
    additional: AdditionalInfo = Field(default_factory=AdditionalInfo)

    # NEW: Section metadata and custom sections
    sectionMeta: list[SectionMeta] = Field(default_factory=list)
    customSections: dict[str, CustomSection] = Field(default_factory=dict)

    @field_validator("summary", mode="before")
    @classmethod
    def _normalize_summary(cls, value: Any) -> str:
        return _coerce_text(value)

    @model_validator(mode="after")
    def _assign_unique_entry_ids(self) -> "ResumeData":
        """Give every list entry a unique positive ``id`` (in place).

        The LLM omits ``id`` (entries default to ``id=0``) and several
        services build entries with hardcoded ``id=0``; the frontend builder
        targets entries by ``item.id``, so duplicate ids would make an edit
        apply to every entry sharing that id. Already-unique positive ids are
        preserved; zeros/duplicates are renumbered deterministically by
        position (first missing positive integer).
        """
        for items in (self.workExperience, self.education, self.personalProjects):
            _assign_unique_ids(items)
        for section in self.customSections.values():
            if section and section.sectionType == SectionType.ITEM_LIST:
                _assign_unique_ids(section.items or [])
        return self


# API Response Models
class ResumeUploadResponse(BaseModel):
    """Response for resume upload."""

    message: str
    request_id: str
    resume_id: str
    processing_status: Literal["pending", "processing", "ready", "failed"] = "pending"
    is_master: bool = False


class RawResume(BaseModel):
    """Raw resume data from database."""

    id: int | None = None
    content: str
    content_type: str = "md"
    created_at: str
    processing_status: str = "pending"  # pending, processing, ready, failed


class InterviewPrepQuestion(BaseModel):
    """Interview question grounded in the tailored resume and job context."""

    question: str
    focus_area: str | None = None
    suggested_answer_points: list[str] = Field(default_factory=list)


class InterviewPrepSkillGap(BaseModel):
    """A preparation target, not a claimed candidate skill."""

    skill: str
    why_it_matters: str
    preparation_suggestion: str


class InterviewPrepData(BaseModel):
    """Structured interview preparation content for a tailored resume."""

    role_fit_analysis: list[str]
    resume_questions: list[InterviewPrepQuestion]
    project_follow_ups: list[InterviewPrepQuestion]
    skill_gaps: list[InterviewPrepSkillGap]
    talking_points: list[str]


class ResumeFetchData(BaseModel):
    """Data payload for resume fetch response."""

    resume_id: str
    raw_resume: RawResume
    processed_resume: ResumeData | None = None
    cover_letter: str | None = None
    outreach_message: str | None = None
    interview_prep: InterviewPrepData | None = None
    parent_id: str | None = None  # For determining if resume is tailored
    title: str | None = None
    is_master: bool = False
    template_settings: dict[str, Any] | None = None


class ResumeFetchResponse(BaseModel):
    """Response for resume fetch."""

    request_id: str
    data: ResumeFetchData


class SaveAsMasterResponse(BaseModel):
    """Response after promoting a resume to master."""

    resume_id: str
    is_master: bool = True


class ResumeSummary(BaseModel):
    """Summary details for listing resumes."""

    resume_id: str
    filename: str | None = None
    is_master: bool = False
    parent_id: str | None = None
    processing_status: str = "pending"
    created_at: str
    updated_at: str
    title: str | None = None


class ResumeListResponse(BaseModel):
    """Response for resume list."""

    request_id: str
    data: list[ResumeSummary]


# Job Description Models
class MobileJobInput(BaseModel):
    """A structured job pushed from the mobile app.

    ``description`` is stored as the job's raw ``content`` so the existing
    improve/tailor pipeline works on mobile jobs unchanged; the remaining
    fields round-trip through ``metadata_json`` as top-level keys.
    """

    title: str | None = Field(default=None, max_length=500)
    company: str | None = Field(default=None, max_length=300)
    location: str | None = Field(default=None, max_length=300)
    description: str = Field(min_length=1)
    url: str | None = Field(default=None, max_length=2000)
    web_url: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, max_length=50)
    posted_at: str | None = None


class JobUploadRequest(BaseModel):
    """Request to upload job descriptions.

    Two mutually compatible modes: the legacy plain-text list
    (``job_descriptions``) and the structured mobile payload (``jobs``).
    At least one of them must be non-empty.
    """

    job_descriptions: list[str] = Field(default_factory=list)
    jobs: list[MobileJobInput] | None = None
    resume_id: str | None = None


class MobileJobSummary(BaseModel):
    """A list-entry job for the PC frontend table (newest first)."""

    job_id: str
    title: str | None = None
    company: str | None = None
    location: str | None = None
    url: str | None = None
    web_url: str | None = None
    source: str | None = None
    posted_at: str | None = None
    created_at: str
    content_preview: str


class JobUploadResponse(BaseModel):
    """Response for job upload."""

    message: str
    job_id: list[str]
    request: dict[str, Any]


# Improvement Models
class ImproveResumeRequest(BaseModel):
    """Request to improve/tailor a resume."""

    resume_id: str
    job_id: str
    prompt_id: str | None = None
    selected_projects: list[str] | None = Field(
        default=None,
        description=(
            "Career project names the user picked from the suggestions step. "
            "When provided, the Projects section is replaced with exactly "
            "these projects instead of the auto-selected top matches."
        ),
    )


class ProjectSuggestion(BaseModel):
    """A single JD-matched career project offered to the user before tailoring."""

    name: str
    role: str = ""
    years: str = ""
    github: str | None = None
    website: str | None = None
    score: int = Field(
        default=0, ge=0, description="Deterministic keyword match score"
    )
    already_in_resume: bool = Field(
        default=False,
        description="True when the project already ships in the resume",
    )
    description: list[str] = Field(
        default_factory=list,
        description=(
            "Generated Problem -> Solution -> Result bullets (empty when the "
            "LLM is unavailable and the project is not yet in the resume)"
        ),
    )


class ProjectSuggestionsData(BaseModel):
    """Data payload for the project suggestions endpoint."""

    projects: list[ProjectSuggestion]
    warnings: list[str] = Field(default_factory=list)


class ProjectSuggestionsResponse(BaseModel):
    """Response for the project suggestions endpoint."""

    request_id: str
    data: ProjectSuggestionsData


class ImprovementSuggestion(BaseModel):
    """Single improvement suggestion."""

    suggestion: str
    lineNumber: int | None = None


class ResumeFieldDiff(BaseModel):
    """Single field change record."""

    field_path: str  # Example: "workExperience[0].description[2]"
    field_type: Literal[
        "skill",
        "description",
        "summary",
        "certification",
        "experience",
        "education",
        "project",
        "language",
        "award",
    ]
    change_type: Literal["added", "removed", "modified"]
    original_value: str | None = None
    new_value: str | None = None
    confidence: Literal["low", "medium", "high"] = "medium"


class ResumeDiffSummary(BaseModel):
    """Change summary stats."""

    total_changes: int
    skills_added: int
    skills_removed: int
    descriptions_modified: int
    certifications_added: int
    high_risk_changes: int  # High-risk additions


class ATSSubScores(BaseModel):
    """Individual component scores that make up the ATS overall score."""

    keyword_match: float = Field(
        default=0.0, ge=0.0, le=100.0, description="Keyword match % (0–100)"
    )
    skills_coverage: float = Field(
        default=0.0, ge=0.0, le=100.0, description="JD skills matched in resume (0–100)"
    )
    section_completeness: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Key resume sections present (0–100)",
    )
    quantification: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Bullets with quantified achievements (0–100)",
    )
    action_verbs: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Bullets starting with action verbs (0–100)",
    )


class ATSScore(BaseModel):
    """ATS-style score breakdown for a resume against a job description."""

    overall_score: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Weighted composite ATS score (0–100)",
    )
    sub_scores: ATSSubScores = Field(default_factory=ATSSubScores)
    missing_keywords: list[str] = Field(
        default_factory=list,
        description="Job keywords absent from the tailored resume",
    )
    injectable_keywords: list[str] = Field(
        default_factory=list,
        description="Missing keywords that exist in the master resume and can be safely added",
    )
    recommendations: list[str] = Field(
        default_factory=list,
        description="Actionable suggestions to improve the ATS score",
    )


class RefinementStats(BaseModel):
    """Statistics from the multi-pass refinement process."""

    passes_completed: int = Field(default=0, ge=0, description="Number of passes run")
    keywords_injected: int = Field(
        default=0, ge=0, description="Number of keywords injected"
    )
    ai_phrases_removed: list[str] = Field(
        default_factory=list, description="List of AI phrases that were removed"
    )
    alignment_violations_fixed: int = Field(
        default=0, ge=0, description="Number of alignment violations corrected"
    )
    initial_match_percentage: float = Field(
        default=0.0,
        ge=0.0,
        le=100.0,
        description="Keyword match before refinement",
    )
    final_match_percentage: float = Field(
        default=0.0, ge=0.0, le=100.0, description="Keyword match after refinement"
    )


class ImproveResumeData(BaseModel):
    """Data payload for improve response."""

    request_id: str
    resume_id: str | None = Field(
        default=None,
        description="Null for preview responses; populated when the tailored resume is persisted.",
    )
    job_id: str
    resume_preview: ResumeData
    improvements: list[ImprovementSuggestion]
    markdownOriginal: str | None = None
    markdownImproved: str | None = None
    cover_letter: str | None = None
    outreach_message: str | None = None
    interview_prep: InterviewPrepData | None = None

    # Diff metadata
    diff_summary: ResumeDiffSummary | None = None
    detailed_changes: list[ResumeFieldDiff] | None = None

    # Refinement metadata (multi-pass refinement stats)
    refinement_stats: "RefinementStats | None" = None

    # ATS score breakdown
    ats_score: "ATSScore | None" = None

    # Warning and status fields for transparency
    warnings: list[str] = Field(default_factory=list)
    refinement_attempted: bool = False
    refinement_successful: bool = False


class ImproveResumeResponse(BaseModel):
    """Response for resume improvement."""

    request_id: str
    data: ImproveResumeData


class ImproveResumeConfirmRequest(BaseModel):
    """Request to confirm and save a tailored resume."""

    resume_id: str
    job_id: str
    improved_data: ResumeData
    improvements: list[ImprovementSuggestion]


# Config Models
ReasoningEffortLiteral = Literal["minimal", "low", "medium", "high"]


class LLMConfigRequest(BaseModel):
    """Request to update LLM configuration."""

    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    # Optional reasoning-effort override.
    #   - A valid value ("minimal"/"low"/"medium"/"high") updates the setting.
    #   - Empty string clears the field — the server persists "" rather than
    #     removing the key, so the gpt-5 auto-migration does not re-fire.
    #   - None means "don't change this field".
    # Strictly typed so invalid values are rejected at the boundary (422)
    # rather than corrupting config.json and crashing later reads.
    reasoning_effort: Literal["minimal", "low", "medium", "high", ""] | None = None


class LLMConfigResponse(BaseModel):
    """Response for LLM configuration."""

    provider: str
    model: str
    api_key: str  # Masked
    api_base: str | None = None
    reasoning_effort: ReasoningEffortLiteral | None = None


class FeatureConfigRequest(BaseModel):
    """Request to update feature settings."""

    enable_cover_letter: bool | None = None
    enable_outreach_message: bool | None = None
    enable_interview_prep: bool | None = None


class FeatureConfigResponse(BaseModel):
    """Response for feature settings."""

    enable_cover_letter: bool = False
    enable_outreach_message: bool = False
    enable_interview_prep: bool = False


class LanguageConfigRequest(BaseModel):
    """Request to update language settings."""

    ui_language: str | None = None  # en, es, zh, ja - for interface
    content_language: str | None = None  # en, es, zh, ja - for generated content


class LanguageConfigResponse(BaseModel):
    """Response for language settings."""

    ui_language: str = "en"  # Interface language
    content_language: str = "en"  # Generated content language
    supported_languages: list[str] = ["en", "es", "zh", "ja"]


class PromptOption(BaseModel):
    """Prompt option for resume tailoring."""

    id: str
    label: str
    description: str


class PromptConfigRequest(BaseModel):
    """Request to update prompt settings."""

    default_prompt_id: str | None = None


class PromptConfigResponse(BaseModel):
    """Response for prompt settings."""

    default_prompt_id: str
    prompt_options: list[PromptOption]


class FeaturePromptsRequest(BaseModel):
    """Request to update custom feature prompts.

    ``None`` means "don't change this field". An empty string clears the
    override — the server persists ``""`` so runtime resolution falls back
    to the built-in default without the key disappearing from config.json.
    """

    cover_letter_prompt: str | None = None
    outreach_message_prompt: str | None = None
    outreach_email_prompt: str | None = None


class FeaturePromptsResponse(BaseModel):
    """Response for custom feature prompts.

    The ``*_default`` fields expose the built-in prompt strings so the UI
    can render them as placeholder text without duplicating the content
    across locales.
    """

    cover_letter_prompt: str
    outreach_message_prompt: str
    outreach_email_prompt: str
    cover_letter_default: str
    outreach_message_default: str
    outreach_email_default: str


# API Key Management Models
class ApiKeyProviderStatus(BaseModel):
    """Status of a single API key provider."""

    provider: str  # openai, anthropic, google, etc.
    configured: bool
    masked_key: str | None = None  # Shows last 4 chars if configured


class ApiKeyStatusResponse(BaseModel):
    """Response for API key status check."""

    providers: list[ApiKeyProviderStatus]


class ApiKeysUpdateRequest(BaseModel):
    """Request to update API keys."""

    openai: str | None = None
    azure_foundry: str | None = None
    anthropic: str | None = None
    google: str | None = None
    openrouter: str | None = None
    deepseek: str | None = None
    groq: str | None = None
    # Local/self-hosted providers that may sit behind an auth proxy.
    openai_compatible: str | None = None
    ollama: str | None = None


class ApiKeysUpdateResponse(BaseModel):
    """Response after updating API keys."""

    message: str
    updated_providers: list[str]


class EmailConfigRequest(BaseModel):
    """Request to update the SMTP email sender settings.

    ``None`` means "don't change this field". For ``password``: ``None`` = keep
    unchanged, empty string = clear it, any value = set it (stored encrypted).
    """

    smtp_host: str | None = None
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    sender_email: str | None = None
    sender_name: str | None = None
    use_tls: bool | None = None
    password: str | None = None


class EmailConfigResponse(BaseModel):
    """Current SMTP email sender settings (password is masked)."""

    smtp_host: str = ""
    smtp_port: int = 587
    sender_email: str = ""
    sender_name: str = ""
    use_tls: bool = True
    has_password: bool = False


class SendEmailResponse(BaseModel):
    """Result of a send-email request."""

    success: bool = True
    message: str = ""


class SentEmailAttachment(BaseModel):
    """Metadata about an attachment on a sent email (no file payload)."""

    name: str
    content_type: str | None = None
    size: int = 0


class SentEmailResponse(BaseModel):
    """One historical sent-email entry for a company."""

    log_id: str
    company_id: str | None = None
    company_name: str = ""
    recipient_email: str
    subject: str
    body: str
    attachments: list[SentEmailAttachment] = []
    sent_at: str


# Update Cover Letter/Outreach Models
class UpdateCoverLetterRequest(BaseModel):
    """Request to update cover letter content."""

    content: str


class UpdateOutreachMessageRequest(BaseModel):
    """Request to update outreach message content."""

    content: str


class UpdateTitleRequest(BaseModel):
    """Request to update resume title."""

    title: str


class TemplateSettingsUpdateRequest(BaseModel):
    """Request to persist a resume's template/design settings."""

    template_settings: dict[str, Any]


class TemplateSettingsUpdateResponse(BaseModel):
    """Response after persisting a resume's template/design settings."""

    resume_id: str
    template_settings: dict[str, Any]


class ResetDatabaseRequest(BaseModel):
    """Request to reset database with confirmation."""

    confirm: str | None = None


class GenerateContentRequest(BaseModel):
    """Request for on-demand content generation with optional user guidance."""

    instruction: str | None = None


class GenerateContentResponse(BaseModel):
    """Response for on-demand content generation."""

    content: str
    message: str


class GenerateInterviewPrepResponse(BaseModel):
    """Response for on-demand interview preparation generation."""

    interview_prep: InterviewPrepData
    message: str


# Health/Status Models
class HealthResponse(BaseModel):
    """Health check response."""

    status: str


class StatusResponse(BaseModel):
    """Application status response."""

    status: str
    llm_configured: bool
    llm_healthy: bool
    has_master_resume: bool
    master_resume_count: int = 0
    database_stats: dict[str, Any]


# Diff-Based Improvement Models


class ResumeChange(BaseModel):
    """A single targeted change the LLM wants to make to the resume."""

    path: str = Field(
        description="Dot+bracket path, e.g. 'workExperience[0].description[1]'"
    )
    action: Literal["replace", "append", "reorder", "add_skill"]
    original: str | list[str] | None = Field(
        default=None,
        description="Current text at path — for verification. May be a list (the "
        "current items) for the reorder action; only used for text verification of "
        "replace/append, ignored otherwise.",
    )
    value: str | list[str] = Field(description="New content")
    reason: str = Field(description="Why this change helps match the JD")

    @model_validator(mode="after")
    def _list_original_only_for_reorder(self) -> "ResumeChange":
        """A list ``original`` is only meaningful for ``reorder`` (the LLM sends
        the current items). For the text actions it must stay a string/None — a
        list there would silently bypass the replace verification gate and crash
        the invented-metrics check, so reject it at parse time."""
        if isinstance(self.original, list) and self.action != "reorder":
            raise ValueError("'original' may be a list only for the reorder action")
        return self


class ImproveDiffResult(BaseModel):
    """LLM output: a list of targeted resume changes."""

    changes: list[ResumeChange] = Field(default_factory=list)
    strategy_notes: str = Field(default="")
