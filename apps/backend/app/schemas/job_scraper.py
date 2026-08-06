"""Pydantic schemas for the job scraper feature."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class JobType(str, Enum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERNSHIP = "internship"
    FREELANCE = "freelance"
    TEMPORARY = "temporary"
    VOLUNTEER = "volunteer"
    OTHER = "other"


class ExperienceLevel(str, Enum):
    INTERNSHIP = "internship"
    ENTRY = "entry"
    ASSOCIATE = "associate"
    MID_SENIOR = "mid_senior"
    DIRECTOR = "director"
    EXECUTIVE = "executive"


class WorkType(str, Enum):
    REMOTE = "remote"
    HYBRID = "hybrid"
    ON_SITE = "on_site"


class DatePosted(str, Enum):
    PAST_HOUR = "past_hour"
    PAST_24_HOURS = "past_24_hours"
    PAST_WEEK = "past_week"
    PAST_MONTH = "past_month"


class LocationFilter(str, Enum):
    UAE = "uae"
    SAUDI_ARABIA = "saudi_arabia"
    QATAR = "qatar"
    EGYPT = "egypt"
    BAHRAIN = "bahrain"
    OMAN = "oman"
    KUWAIT = "kuwait"
    JORDAN = "jordan"
    REMOTE = "remote"
    GLOBAL = "global"
    US = "us"
    UK = "uk"
    CANADA = "canada"
    GERMANY = "germany"
    FRANCE = "france"
    NETHERLANDS = "netherlands"
    INDIA = "india"
    TURKEY = "turkey"
    AUSTRALIA = "australia"
    SINGAPORE = "singapore"
    TUNISIA = "tunisia"


class JobSearchFilters(BaseModel):
    """Filters for job search."""

    keywords: str = Field(description="Search keywords (auto-extracted from resume if empty)")
    locations: list[LocationFilter] = Field(default=[LocationFilter.GLOBAL], description="Location filters")
    job_types: list[JobType] = Field(default=[], description="Job type filters")
    experience_levels: list[ExperienceLevel] = Field(default=[], description="Experience level filters")
    work_types: list[WorkType] = Field(default=[], description="Work type filters")
    date_posted: DatePosted = Field(default=DatePosted.PAST_24_HOURS, description="Date posted filter")
    easy_apply_only: bool = Field(default=False, description="Only show Easy Apply jobs (LinkedIn)")
    max_pages: int = Field(default=3, ge=1, le=10, description="Max pages per MCP")


class JobSearchRequest(BaseModel):
    """Request to search for jobs."""

    resume_id: str = Field(description="Master resume ID to extract keywords from")
    filters: JobSearchFilters = Field(default_factory=JobSearchFilters)


class JobListing(BaseModel):
    """A single job listing from any source."""

    id: str = Field(description="Unique job identifier (source-specific)")
    title: str = Field(description="Job title")
    company: str = Field(description="Company name")
    location: str = Field(description="Job location")
    url: str = Field(description="Job listing URL")
    source: str = Field(description="Source MCP (linkedin, bayt, remoteok, etc.)")
    posted_date: str | None = Field(default=None, description="When the job was posted")
    description: str | None = Field(default=None, description="Full job description")
    relevance_score: float = Field(default=0.0, ge=0.0, le=1.0, description="Relevance score 0-1")
    easy_apply: bool = Field(default=False, description="Easy Apply available")
    remote: bool = Field(default=False, description="Remote work available")
    job_type: str | None = Field(default=None, description="Job type (full_time, internship, etc.)")
    experience_level: str | None = Field(default=None, description="Experience level")
    salary: str | None = Field(default=None, description="Salary info if available")
    languages: list[str] = Field(default_factory=list, description="Programming languages or skills mentioned")


class MCPServerStatus(BaseModel):
    """Status of a single MCP server."""

    available: bool = Field(description="Whether the MCP is available")
    backend: str = Field(description="Which backend is used")
    details: str = Field(default="", description="Additional status info")
    enabled: bool = Field(default=True, description="Whether user has enabled this MCP")


class MCPStatusResponse(BaseModel):
    """Response with all MCP statuses."""

    mcp_servers: dict[str, MCPServerStatus] = Field(description="Status per MCP server")


class MCPConfigureRequest(BaseModel):
    """Request to enable/disable an MCP."""

    mcp_name: str = Field(description="MCP server name")
    enabled: bool = Field(description="Whether to enable or disable")


class JobSearchResponse(BaseModel):
    """Response from a job search."""

    search_id: str = Field(description="Unique search ID for caching")
    results: list[JobListing] = Field(description="Job listings found")
    total: int = Field(description="Total number of results")
    mcp_status: dict[str, dict] = Field(default_factory=dict, description="Per-MCP status")
    cached: bool = Field(default=False, description="Whether results are from cache")
