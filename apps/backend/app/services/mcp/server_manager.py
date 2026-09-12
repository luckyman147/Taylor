"""MCP Server Manager — CRUD and lifecycle for MCP servers.

Handles registration, connection state, tool caching, and lifecycle
management for both built-in and custom MCP servers.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.database import db

logger = logging.getLogger(__name__)


class MCPServerManager:
    """Manages the MCP server registry and connection lifecycle."""

    async def register_server(
        self,
        name: str,
        url: str | None = None,
        transport: str = "streamable-http",
        server_type: str = "custom",
        display_name: str | None = None,
    ) -> dict[str, Any]:
        """Register a new MCP server.

        Args:
            name: Unique identifier (e.g. "linkedin", "exa", "custom_github").
            url: Server endpoint URL (required for remote servers).
            transport: Transport type: streamable-http, stdio, sse.
            server_type: "builtin" or "custom".
            display_name: Human-readable name for the UI.

        Returns:
            The registered server dict.
        """
        existing = await db.get_mcp_server_by_name(name)
        if existing:
            logger.warning("MCP server '%s' already registered, updating", name)
            await db.update_mcp_server(existing["server_id"], url=url, transport=transport)
            return existing

        server_id = f"mcp_{uuid4().hex[:12]}"
        return await db.create_mcp_server(
            server_id=server_id, name=name, url=url,
            transport=transport, server_type=server_type,
            display_name=display_name,
        )

    async def get_server(self, server_id: str) -> dict[str, Any] | None:
        """Get a server by ID."""
        return await db.get_mcp_server(server_id)

    async def get_server_by_name(self, name: str) -> dict[str, Any] | None:
        """Get a server by name."""
        return await db.get_mcp_server_by_name(name)

    async def list_servers(self) -> list[dict[str, Any]]:
        """List all registered servers."""
        return await db.list_mcp_servers()

    async def list_enabled_servers(self) -> list[dict[str, Any]]:
        """List all enabled servers."""
        servers = await db.list_mcp_servers()
        return [s for s in servers if s["enabled"]]

    async def update_server(self, server_id: str, **fields: Any) -> bool:
        """Update server fields."""
        return await db.update_mcp_server(server_id, **fields)

    async def delete_server(self, server_id: str) -> bool:
        """Delete a server and its credentials."""
        return await db.delete_mcp_server(server_id)

    async def enable_server(self, server_id: str) -> bool:
        """Enable an MCP server."""
        return await db.update_mcp_server(server_id, enabled=True, error_message=None)

    async def disable_server(self, server_id: str, reason: str | None = None) -> bool:
        """Disable an MCP server."""
        return await db.update_mcp_server(server_id, enabled=False, error_message=reason)

    async def update_tools(self, server_id: str, tools: list[dict[str, Any]]) -> None:
        """Cache the tool list for a server."""
        await db.update_mcp_server(
            server_id,
            tools_json=json.dumps(tools),
            last_connected_at=datetime.now(timezone.utc).isoformat(),
            status="connected",
            error_message=None,
        )

    async def set_error(self, server_id: str, error: str) -> None:
        """Mark a server as having an error."""
        await db.update_mcp_server(
            server_id,
            status="error",
            error_message=error,
        )

    async def get_tools(self, server_id: str) -> list[dict[str, Any]]:
        """Get cached tools for a server."""
        server = await db.get_mcp_server(server_id)
        if not server or not server.get("tools_json"):
            return []
        return json.loads(server["tools_json"])

    async def get_all_tools(self) -> list[dict[str, Any]]:
        """Get all tools from all enabled servers."""
        servers = await db.list_mcp_servers()
        all_tools = []
        for server in servers:
            if not server["enabled"]:
                continue
            tools = await self.get_tools(server["server_id"])
            for tool in tools:
                tool["server_id"] = server["server_id"]
                tool["server_name"] = server["name"]
            all_tools.extend(tools)
        return all_tools


server_manager = MCPServerManager()
