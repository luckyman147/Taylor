"""MCP Tool Discovery — discovers and caches tools from MCP servers.

Probes servers for their tool lists, caches them, and registers them
in the tool registry for the retriever/ranker pipeline.
"""

import json
import logging
from typing import Any

from app.services.mcp.connection import connection_manager
from app.services.mcp.server_manager import server_manager

logger = logging.getLogger(__name__)


class MCPToolDiscovery:
    """Discovers tools from MCP servers and caches them."""

    async def discover_tools(self, server_id: str) -> list[dict[str, Any]]:
        """Discover tools from a single MCP server.

        Returns list of tool definitions in OpenAI-compatible format:
        [{"name": str, "description": str, "parameters": dict, "server_id": str}]
        """
        tools = await connection_manager.list_tools(server_id)
        if tools:
            await server_manager.update_tools(server_id, tools)
            logger.info("Discovered %d tools from server %s", len(tools), server_id)
        return tools

    async def discover_all(self) -> dict[str, list[dict[str, Any]]]:
        """Discover tools from all enabled servers in parallel.

        Returns {server_id: [tool definitions]}.
        """
        servers = await server_manager.list_enabled_servers()
        if not servers:
            return {}

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
        # Clear cached tools
        await server_manager.update_tools(server_id, [])
        # Re-discover
        return await self.discover_tools(server_id)

    async def get_tool_schemas(self) -> list[dict[str, Any]]:
        """Get all MCP tool schemas in OpenAI function-calling format.

        Returns list of tools ready to pass to the LLM planner.
        """
        servers = await server_manager.list_enabled_servers()
        schemas = []
        for server in servers:
            tools = await server_manager.get_tools(server["server_id"])
            for tool in tools:
                schemas.append({
                    "type": "function",
                    "function": {
                        "name": f"mcp_{server['name']}_{tool['name']}",
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
                    },
                    "server_id": server["server_id"],
                    "server_name": server["name"],
                    "original_name": tool["name"],
                })
        return schemas


tool_discovery = MCPToolDiscovery()
