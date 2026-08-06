"""Base adapter class for MCP integrations."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas.job_scraper import JobListing, JobSearchFilters


class BaseMCPAdapter(ABC):
    """Abstract base class for all MCP adapters."""

    name: str = "base"
    description: str = "Base adapter"
    timeout: float = 10.0

    def __init__(self) -> None:
        self.enabled: bool = True

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if this MCP is available and ready to use."""
        ...

    @abstractmethod
    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """Search for jobs using this MCP source."""
        ...
