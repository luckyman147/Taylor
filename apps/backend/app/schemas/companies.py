"""Pydantic schemas for the company tracker."""

from enum import Enum

from pydantic import BaseModel, Field


class CompanySize(str, Enum):
    """Company headcount buckets (stable keys, decoupled from i18n labels)."""

    one_to_ten = "1-10"
    eleven_to_fifty = "11-50"
    fifty_one_to_two_hundred = "51-200"
    two_hundred_one_to_thousand = "201-1000"
    thousand_plus = "1000+"


class CompanyType(str, Enum):
    """Company category (stable keys, decoupled from i18n labels)."""

    startup = "startup"
    agency = "agency"
    enterprise = "enterprise"
    nonprofit = "nonprofit"
    education = "education"
    government = "government"
    other = "other"


class CompanyStatus(str, Enum):
    """Company lifecycle stage (stable keys, decoupled from i18n labels)."""

    watching = "watching"
    contacted = "contacted"
    applied = "applied"
    interviewing = "interviewing"
    negotiating = "negotiating"
    won = "won"
    lost = "lost"


class CompanyResponse(BaseModel):
    """A single tracked company."""

    company_id: str
    name: str
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    website: str | None = None
    company_size: CompanySize | None = None
    company_type: CompanyType | None = None
    status: CompanyStatus | None = None
    linkedin_url: str | None = None
    industry: str | None = None
    year_founded: int | None = None
    created_at: str
    updated_at: str


class CompanyListResponse(BaseModel):
    """All tracked companies, ordered by name."""

    companies: list[CompanyResponse]


class CompanyCreate(BaseModel):
    """Create a company — only ``name`` is required."""

    name: str = Field(min_length=1, max_length=200)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    website: str | None = None
    company_size: CompanySize | None = None
    company_type: CompanyType | None = None
    status: CompanyStatus | None = None
    linkedin_url: str | None = None
    industry: str | None = None
    year_founded: int | None = Field(default=None, ge=1600, le=2100)


class CompanyUpdate(BaseModel):
    """Partial update — every field optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    website: str | None = None
    company_size: CompanySize | None = None
    company_type: CompanyType | None = None
    status: CompanyStatus | None = None
    linkedin_url: str | None = None
    industry: str | None = None
    year_founded: int | None = Field(default=None, ge=1600, le=2100)


class CompanyActionResponse(BaseModel):
    """Generic acknowledgement for destructive actions."""

    message: str
    affected: int


class CompanyBulkDelete(BaseModel):
    """Delete many companies at once (missing ids are skipped)."""

    company_ids: list[str] = Field(min_length=1)


class CompanyImportError(BaseModel):
    """One row that failed to import (row numbers are 1-based)."""

    row: int
    name: str | None = None
    error: str


class CompanyImportResponse(BaseModel):
    """Outcome of a CSV/Excel import.

    ``created`` counts new companies; ``skipped`` counts rows that matched an
    existing company (case-insensitive name dedupe); ``errors`` lists rows that
    could not be parsed or validated.
    """

    created: int
    skipped: int
    errors: list[CompanyImportError]
