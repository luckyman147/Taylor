"""Transport factory base class for MCP connections.

Each transport type (HTTP, SSE, Streamable HTTP) implements this interface.
The connection manager uses the factory to create the appropriate transport.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from app.services.mcp.authentication import ResolvedMCPCredentials

logger = logging.getLogger(__name__)


@dataclass
class TransportResult:
    """Result from a transport connection attempt."""

    success: bool
    session: Any = None
    error: str | None = None
    error_code: str | None = None
    latency_ms: int = 0


class BaseTransport(ABC):
    """Abstract base class for MCP transports."""

    name: str = "base"
    default_timeout: float = 30.0

    @abstractmethod
    async def connect(
        self,
        url: str,
        credentials: ResolvedMCPCredentials,
        timeout: float | None = None,
    ) -> TransportResult:
        """Connect to an MCP server using this transport.

        Returns TransportResult with session or error.
        """
        ...

    @abstractmethod
    async def disconnect(self, session: Any) -> None:
        """Disconnect from a session."""
        ...

    @abstractmethod
    async def list_tools(self, session: Any) -> list[dict[str, Any]]:
        """List available tools from a connected session."""
        ...

    @abstractmethod
    async def call_tool(
        self,
        session: Any,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Call a tool on a connected session."""
        ...


class TransportFactory:
    """Creates the appropriate transport based on server config."""

    _transports: dict[str, type[BaseTransport]] = {}

    @classmethod
    def register(cls, transport_type: str, transport_cls: type[BaseTransport]) -> None:
        """Register a transport type."""
        cls._transports[transport_type] = transport_cls

    @classmethod
    def create(cls, transport_type: str) -> BaseTransport:
        """Create a transport instance for the given type."""
        transport_cls = cls._transports.get(transport_type)
        if not transport_cls:
            raise ValueError(f"Unknown transport type: {transport_type}")
        return transport_cls()

    @classmethod
    def supported_types(cls) -> list[str]:
        """List supported transport types."""
        return list(cls._transports.keys())


def get_transport(transport_type: str) -> BaseTransport:
    """Convenience function to get a transport instance."""
    return TransportFactory.create(transport_type)
