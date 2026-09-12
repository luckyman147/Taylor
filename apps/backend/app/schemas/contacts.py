"""Pydantic schemas for the contact tracker."""

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class ContactGoal(str, Enum):
    """Why the user is networking with this contact (stable keys)."""

    networking = "networking"
    informational_interview = "informational_interview"
    request_referral = "request_referral"
    research_interviewer = "research_interviewer"
    research_career = "research_career"


class ContactStatus(str, Enum):
    """Where the outreach stands (stable keys)."""

    to_contact = "to_contact"
    contacted = "contacted"
    follow_up = "follow_up"
    meeting_scheduled = "meeting_scheduled"
    thank_you_sent = "thank_you_sent"


class ContactRelationship(str, Enum):
    """How the user knows this contact (stable keys)."""

    self_ref = "self"
    coworker = "coworker"
    friend = "friend"
    family = "family"
    other = "other"
    recruiter = "recruiter"
    mentor = "mentor"
    hiring_manager = "hiring_manager"
    alumni = "alumni"


class ContactResponse(BaseModel):
    """A single tracked contact."""

    contact_id: str
    name: str
    email: str | None = None
    company: str | None = None
    location: str | None = None
    goal: ContactGoal | None = None
    status: ContactStatus | None = None
    relationship: ContactRelationship | None = None
    follow_up_date: str | None = None
    description: str | None = None
    linkedin_url: str | None = None
    website_url: str | None = None
    created_at: str
    updated_at: str

class ContactListResponse(BaseModel):
    """All tracked contacts, ordered by name."""

    contacts: list[ContactResponse]


class ContactCreate(BaseModel):
    """Create a contact — only ``name`` is required."""

    name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=254)
    company: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    goal: ContactGoal | None = None
    status: ContactStatus | None = None
    relationship: ContactRelationship | None = None
    follow_up_date: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    linkedin_url: str | None = Field(default=None, max_length=500)
    website_url: str | None = Field(default=None, max_length=500)

    @field_validator("follow_up_date")
    @classmethod
    def _validate_follow_up_date(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        date.fromisoformat(value)  # raises ValueError for non-ISO dates
        return value


class ContactUpdate(BaseModel):
    """Partial update — every field optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=254)
    company: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    goal: ContactGoal | None = None
    status: ContactStatus | None = None
    relationship: ContactRelationship | None = None
    follow_up_date: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    linkedin_url: str | None = Field(default=None, max_length=500)
    website_url: str | None = Field(default=None, max_length=500)

    @field_validator("follow_up_date")
    @classmethod
    def _validate_follow_up_date(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        date.fromisoformat(value)
        return value


class ContactActionResponse(BaseModel):
    """Generic acknowledgement for destructive actions."""

    message: str
    affected: int


class ContactBulkDelete(BaseModel):
    """Delete many contacts at once (missing ids are skipped)."""

    contact_ids: list[str] = Field(min_length=1)


class ContactImportError(BaseModel):
    """One row that failed to import (row numbers are 1-based)."""

    row: int
    name: str | None = None
    error: str


class ContactImportResponse(BaseModel):
    """Outcome of a CSV/Excel import.

    ``created`` counts new contacts; ``skipped`` counts rows that matched an
    existing contact (case-insensitive name dedupe); ``errors`` lists rows that
    could not be parsed or validated.
    """

    created: int
    skipped: int
    errors: list[ContactImportError]
