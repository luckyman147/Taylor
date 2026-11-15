"""Pydantic schemas for the lead scraper feature."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class LeadType(str, Enum):
    """Scraped identity shape."""

    person = "person"
    company = "company"
    agency = "agency"


class SuggestedType(str, Enum):
    """Where the user should save a lead."""

    contact = "contact"
    company = "company"
    agency = "agency"
    unsure = "unsure"


class CategorySource(str, Enum):
    """Who decided the suggested category."""

    heuristic = "heuristic"
    ai = "ai"
    user = "user"
    unsure = "unsure"


class LeadStatus(str, Enum):
    """Triage status of a stored lead."""

    new = "new"
    saved = "saved"
    contacted = "contacted"
    dismissed = "dismissed"


class LeadSearchRequest(BaseModel):
    """Request to search for leads across sources."""

    keywords: str = Field(min_length=1, max_length=300, description="Search keywords")
    target: str | None = Field(
        default=None,
        max_length=300,
        description="Exact persona/company to find, e.g. 'CTOs at fintech startups'",
    )
    purpose: str | None = Field(
        default=None,
        max_length=300,
        description="Why these leads are wanted, e.g. 'selling an ATS to engineering leads'",
    )
    locations: list[str] = Field(default_factory=list, description="Location strings")
    lead_types: list[LeadType] = Field(
        default=[LeadType.person, LeadType.company],
        description="Which lead shapes to search for",
    )
    sources: list[str] = Field(
        default_factory=list,
        description="Sources to search (linkedin, exa, web). Empty = all enabled.",
    )
    max_results: int = Field(default=40, ge=1, le=200, description="Cap on merged leads")
    enrich_contacts: bool = Field(
        default=True, description="Best-effort email/phone discovery for person leads"
    )


class LeadCandidate(BaseModel):
    """A raw lead collected from a source before dedup/persistence."""

    name: str = Field(min_length=1)
    lead_type: LeadType = LeadType.person
    title: str | None = None
    company: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    website: str | None = None
    location: str | None = None
    industry: str | None = None
    company_size: str | None = None
    description: str | None = None
    source: str = "web"


class LeadOut(BaseModel):
    """A stored lead returned to the client."""

    lead_id: str
    search_id: str
    lead_type: LeadType
    name: str
    title: str | None = None
    company: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    website: str | None = None
    location: str | None = None
    industry: str | None = None
    company_size: str | None = None
    description: str | None = None
    source: str
    sources: list[str] = Field(default_factory=list)
    suggested_type: SuggestedType = SuggestedType.unsure
    category_source: CategorySource = CategorySource.heuristic
    category_confidence: float = 0.0
    status: LeadStatus = LeadStatus.new
    contact_id: str | None = None
    company_id: str | None = None
    created_at: str
    updated_at: str


class DedupStats(BaseModel):
    """Redundancy-avoidance report for one search."""

    raw: int = 0
    after_exact: int = 0
    after_fuzzy: int = 0
    merged: int = 0
    already_in_db: int = 0
    new_inserted: int = 0


class LeadSearchResponse(BaseModel):
    """Response from a lead search."""

    search_id: str
    leads: list[LeadOut] = Field(default_factory=list)
    dedup_stats: DedupStats = Field(default_factory=DedupStats)
    mcp_status: dict[str, dict] = Field(default_factory=dict)


class LeadProgressEvent(BaseModel):
    """One live progress update streamed during a lead search (SSE)."""

    phase: Literal[
        "searching",
        "profiles",
        "companies",
        "filtering",
        "categorize",
        "dedupe",
        "persisted",
        "enrich",
        "done",
        "error",
    ]
    detail: str | None = None
    done: int | None = None
    total: int | None = None
    source: str | None = None
    result: LeadSearchResponse | None = None


class LeadListResponse(BaseModel):
    """Stored leads for listing/filtering."""

    leads: list[LeadOut] = Field(default_factory=list)


class LeadUpdateRequest(BaseModel):
    """Partial update — status and/or manual category override."""

    status: LeadStatus | None = None
    suggested_type: SuggestedType | None = None


class LeadSaveRequest(BaseModel):
    """Save one lead as a contact or company."""

    target: Literal["contact", "company"]
    create_linked_company: bool = Field(
        default=False,
        description="When target=contact and the employer is known, also upsert the company",
    )


class LeadBulkSaveRequest(BaseModel):
    """Save many leads with a shared target."""

    lead_ids: list[str] = Field(min_length=1)
    target: Literal["contact", "company"]
    create_linked_company: bool = False


class LeadBulkDeleteRequest(BaseModel):
    """Delete many leads at once (missing ids are skipped)."""

    lead_ids: list[str] = Field(min_length=1)


class LeadActionResponse(BaseModel):
    """Generic acknowledgement for save/delete actions."""

    message: str
    affected: int
    details: list[str] = Field(default_factory=list)


class CurrentSearchParams(BaseModel):
    """The user's in-flight search form values (all optional)."""

    keywords: str | None = Field(default=None, max_length=300)
    target: str | None = Field(default=None, max_length=300)
    purpose: str | None = Field(default=None, max_length=300)
    locations: list[str] = Field(default_factory=list)
    lead_types: list[LeadType] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


class LeadCriteriaRequest(BaseModel):
    """Inputs for AI search-criteria recommendations."""

    resume_id: str | None = None
    goal: str | None = Field(default=None, max_length=500)
    niche: str | None = Field(default=None, max_length=200)
    current: CurrentSearchParams | None = Field(
        default=None,
        description="The user's in-form params — the AI optimizes these instead of starting from scratch",
    )


class LeadCriteria(BaseModel):
    """AI-recommended search criteria (user reviews before searching)."""

    keywords: list[str] = Field(default_factory=list)
    titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    company_types: list[str] = Field(default_factory=list)
    lead_types: list[LeadType] = Field(default_factory=lambda: [LeadType.person, LeadType.company])
    seniorities: list[str] = Field(default_factory=list)
    target: str | None = Field(
        default=None, description="Suggested improved target/persona statement"
    )
    purpose: str | None = Field(
        default=None, description="Suggested improved purpose statement"
    )
    recency_hint: str | None = None
    rationale: str | None = None


class LeadCriteriaResponse(BaseModel):
    """Recommended criteria plus already-tracked names to avoid."""

    criteria: LeadCriteria
    tracked_names: list[str] = Field(default_factory=list)


class LeadSearchDraftOut(BaseModel):
    """A saved search-params draft returned to the client."""

    draft_id: str
    name: str
    keywords: str | None = None
    target: str | None = None
    purpose: str | None = None
    locations: list[str] = Field(default_factory=list)
    lead_types: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    enrich_contacts: bool = True
    updated_at: str


class LeadSearchDraftUpsert(BaseModel):
    """Create or replace a draft (keyed by unique name)."""

    name: str = Field(min_length=1, max_length=80)
    keywords: str | None = Field(default=None, max_length=300)
    target: str | None = Field(default=None, max_length=300)
    purpose: str | None = Field(default=None, max_length=300)
    locations: list[str] = Field(default_factory=list)
    lead_types: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    enrich_contacts: bool = True


class LeadSearchDraftListResponse(BaseModel):
    """All saved drafts, most recently updated first."""

    drafts: list[LeadSearchDraftOut] = Field(default_factory=list)
