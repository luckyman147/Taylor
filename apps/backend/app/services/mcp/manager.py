"""MCP Manager — detection, health checks, unified search dispatch."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.schemas.job_scraper import (
    JobListing,
    JobSearchFilters,
    MCPServerStatus,
)
from app.services.mcp.base import BaseMCPAdapter
from app.services.mcp.circuit_breaker import CircuitBreaker, CircuitOpenError
from app.services.mcp.retry import retry_with_backoff

logger = logging.getLogger(__name__)


class MCPManager:
    """Central manager that detects, health-checks, and dispatches to MCP adapters."""

    def __init__(self) -> None:
        self.adapters: dict[str, BaseMCPAdapter] = {}
        self.circuits: dict[str, CircuitBreaker] = {}
        self.semaphore = asyncio.Semaphore(5)
        self._user_preferences: dict[str, bool] = {}

    def register(self, adapter: BaseMCPAdapter) -> None:
        """Register an MCP adapter."""
        self.adapters[adapter.name] = adapter
        self.circuits[adapter.name] = CircuitBreaker(
            name=adapter.name,
            failure_threshold=3 if adapter.timeout > 10 else 2,
            recovery_timeout=300 if adapter.timeout > 10 else 120,
        )

    async def detect_all(self) -> dict[str, MCPServerStatus]:
        """Check availability of every registered MCP."""
        statuses: dict[str, MCPServerStatus] = {}
        for name, adapter in self.adapters.items():
            try:
                available = await asyncio.wait_for(adapter.is_available(), timeout=5.0)
                enabled = self._user_preferences.get(name, True)
                statuses[name] = MCPServerStatus(
                    available=available,
                    backend=adapter.description,
                    details="Connected" if available else "Not available",
                    enabled=enabled,
                )
            except (asyncio.TimeoutError, Exception) as exc:
                statuses[name] = MCPServerStatus(
                    available=False,
                    backend=adapter.description,
                    details=str(exc),
                    enabled=self._user_preferences.get(name, True),
                )
        return statuses

    def set_enabled(self, name: str, enabled: bool) -> None:
        """Enable or disable an MCP by the user."""
        self._user_preferences[name] = enabled
        if name in self.adapters:
            self.adapters[name].enabled = enabled
        if name in self.circuits and enabled:
            self.circuits[name].reset()

    async def search_all(
        self, keywords: str, filters: JobSearchFilters
    ) -> tuple[list[JobListing], dict[str, dict[str, Any]]]:
        """Search all enabled MCPs in parallel.

        Returns a tuple of (merged_job_listings, per_mcp_status).
        """
        tasks: list[tuple[str, asyncio.Task]] = []
        for name, adapter in self.adapters.items():
            if not adapter.enabled or not self._user_preferences.get(name, True):
                continue
            circuit = self.circuits[name]
            task = asyncio.create_task(
                self._safe_search(name, adapter, circuit, keywords, filters)
            )
            tasks.append((name, task))

        results = await asyncio.gather(
            *(t for _, t in tasks), return_exceptions=True
        )

        all_jobs: list[JobListing] = []
        mcp_status: dict[str, dict[str, Any]] = {}
        for (name, _), result in zip(tasks, results):
            if isinstance(result, CircuitOpenError):
                mcp_status[name] = {"status": "skipped", "error": "Circuit open"}
            elif isinstance(result, asyncio.TimeoutError):
                mcp_status[name] = {"status": "timeout"}
            elif isinstance(result, Exception):
                mcp_status[name] = {"status": "failed", "error": str(result)}
            else:
                all_jobs.extend(result)
                mcp_status[name] = {"status": "ok", "count": len(result)}

        return all_jobs, mcp_status

    async def _safe_search(
        self,
        name: str,
        adapter: BaseMCPAdapter,
        circuit: CircuitBreaker,
        keywords: str,
        filters: JobSearchFilters,
    ) -> list[JobListing]:
        """Search a single MCP with retry + circuit breaker."""
        async with self.semaphore:

            async def _call():
                return await asyncio.wait_for(
                    adapter.search_jobs(keywords, filters),
                    timeout=adapter.timeout,
                )

            return await retry_with_backoff(
                lambda: circuit.call(_call),
                max_retries=2,
                base_delay=1.0,
                max_delay=8.0,
            )
