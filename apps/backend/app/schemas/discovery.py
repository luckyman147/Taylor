"""Pydantic schemas for company discovery."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class DiscoverySource(str, Enum):
    """Source of the discovered company."""

    job_mining = "job_mining"
    web = "web"
    openstreetmap = "openstreetmap"


class DiscoveryStatus(str, Enum):
    """User action status for a discovered company."""

    new = "new"
    saved = "saved"
    applied = "applied"
    dismissed = "dismissed"


class DiscoveredCompanyResponse(BaseModel):
    """A discovered company with match scoring."""

    id: str
    search_id: str
    name: str
    website: str | None = None
    industry: str | None = None
    description: str | None = None
    match_score: float
    match_reasons: list[str] = []
    source: str
    status: DiscoveryStatus
    company_id: str | None = None
    tracked: bool = False
    city: str | None = None
    country: str | None = None
    sample_roles: list[str] = []
    locations: list[str] = []
    sources: list[str] = []
    created_at: str
    updated_at: str


class DiscoverRequest(BaseModel):
    """Request to discover companies matching the profile."""

    resume_id: str | None = None
    keywords: list[str] | None = None
    locations: list[str] | None = None
    sources: list[str] | None = None


class DiscoverResponse(BaseModel):
    """Response containing discovered companies."""

    search_id: str
    companies: list[DiscoveredCompanyResponse]


class DiscoveredCompanyListResponse(BaseModel):
    """List of discovered companies (history)."""

    companies: list[DiscoveredCompanyResponse]


class SaveDiscoveredRequest(BaseModel):
    """Request to save a discovered company to the tracker."""

    company_id: str | None = None


class ApplyDiscoveredRequest(BaseModel):
    """Request to apply to a discovered company."""

    resume_id: str
    job_description: str | None = None


class ActionResponse(BaseModel):
    """Generic action response."""

    success: bool
    message: str | None = None
    application_id: str | None = None
    company_id: str | None = None