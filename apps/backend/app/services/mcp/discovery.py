"""MCP Tool Discovery — discovers and persists tools from MCP servers.

Probes servers for their tool lists, persists them to the MCPTool table,
and registers them in the tool registry for the retriever/ranker pipeline.
Tools are namespaced as `server__tool` (double underscore).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.database import db
from app.services.mcp.connection import connection_manager
from app.services.mcp.server_manager import server_manager

logger = logging.getLogger(__name__)


def _make_public_name(server_name: str, tool_name: str) -> str:
    """Create a namespaced tool name: server__tool."""
    return f"{server_name}__{tool_name}"


class MCPToolDiscovery:
    """Discovers tools from MCP servers and persists them to MCPTool table."""

    async def discover_tools(self, server_id: str) -> list[dict[str, Any]]:
        """Discover tools from a single MCP server.

        Persists tools to the MCPTool table and returns them.
        """
        server = await server_manager.get_server(server_id)
        if not server:
            return []

        tools = await connection_manager.list_tools(server_id)
        if not tools:
            return []

        server_name = server.get("name", server_id)
        now = datetime.now(timezone.utc).isoformat()
        persisted = []

        for tool in tools:
            tool_name = tool.get("name", "")
            if not tool_name:
                continue

            public_name = _make_public_name(server_name, tool_name)
            tool_id = f"tool_{uuid4().hex[:12]}"

            # Upsert the tool
            await db.upsert_mcp_tool(
                tool_id=tool_id,
                server_id=server_id,
                name=tool_name,
                public_name=public_name,
                description=tool.get("description", ""),
                input_schema=json.dumps(tool.get("parameters", {"type": "object", "properties": {}})),
                last_discovered_at=now,
            )

            persisted.append({
                "id": tool_id,
                "name": tool_name,
                "public_name": public_name,
                "description": tool.get("description", ""),
                "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
                "server_id": server_id,
                "server_name": server_name,
            })

        logger.info(
            "Discovered %d tools from server %s (persisted to MCPTool)",
            len(persisted), server_name,
        )
        return persisted

    async def discover_all(self) -> dict[str, list[dict[str, Any]]]:
        """Discover tools from all enabled servers in parallel.

        Returns {server_id: [tool definitions]}.
        """
        servers = await server_manager.list_enabled_servers()
        if not servers:
            return {}

        import asyncio

        async def _discover_one(server: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
            try:
                tools = await self.discover_tools(server["server_id"])
                return server["server_id"], tools
            except Exception as e:
                logger.error("Failed to discover tools from %s: %s", server["name"], e)
                return server["server_id"], []

        results = await asyncio.gather(*[_discover_one(s) for s in servers])
        return dict(results)

    async def refresh_tools(self, server_id: str) -> list[dict[str, Any]]:
        """Force refresh the tool list for a server."""
        # Clear cached tools in the server manager
        await server_manager.update_tools(server_id, [])
        # Re-discover
        return await self.discover_tools(server_id)

    async def get_enabled_tool_schemas(self) -> list[dict[str, Any]]:
        """Get all enabled MCP tool schemas in OpenAI function-calling format.

        Returns list of tools ready to pass to the LLM planner.
        Only includes tools that are enabled in the MCPTool table.
        """
        enabled_tools = await db.list_enabled_mcp_tools()
        schemas = []
        for tool in enabled_tools:
            try:
                params = json.loads(tool.get("input_schema", "{}"))
            except (json.JSONDecodeError, TypeError):
                params = {"type": "object", "properties": {}}

            schemas.append({
                "type": "function",
                "function": {
                    "name": tool["public_name"],
                    "description": tool.get("description", ""),
                    "parameters": params,
                },
                "tool_id": tool["id"],
                "server_id": tool["server_id"],
            })
        return schemas

    async def get_all_tool_schemas(self) -> list[dict[str, Any]]:
        """Get all MCP tool schemas (enabled and disabled) for the UI."""
        all_tools = await db.list_mcp_tools()
        schemas = []
        for tool in all_tools:
            try:
                params = json.loads(tool.get("input_schema", "{}"))
            except (json.JSONDecodeError, TypeError):
                params = {"type": "object", "properties": {}}

            schemas.append({
                "type": "function",
                "function": {
                    "name": tool["public_name"],
                    "description": tool.get("description", ""),
                    "parameters": params,
                },
                "tool_id": tool["id"],
                "server_id": tool["server_id"],
                "enabled": tool.get("enabled", True),
            })
        return schemas


tool_discovery = MCPToolDiscovery()
