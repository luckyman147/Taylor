"""Tool Registry — single source of truth for all tools.

Generates entries from the canonical TOOL_CATALOG in chat_tools.py.
Also loads MCP tools from enabled servers. Provides metadata, capabilities,
and domain classification for every tool.
"""

import logging
from typing import Any

from app.services.mcp.server_manager import server_manager
from app.services.mcp.taxonomy import taxonomy

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Single source of truth for all tools (chat + MCP)."""

    def __init__(self) -> None:
        self._tools: dict[str, dict[str, Any]] = {}
        self._chat_loaded = False

    def _load_chat_tools(self) -> None:
        """Load chat tool catalog into the registry."""
        if self._chat_loaded:
            return
        from app.services.chat_tools import TOOL_CATALOG
        for name, spec in TOOL_CATALOG.items():
            categories = taxonomy.classify_tool(name, spec.description)
            self._tools[name] = {
                "name": name,
                "description": spec.description,
                "parameters": spec.params,
                "capabilities": categories,
                "domain": taxonomy.get_domain(categories),
                "source": "chat",
                "write": spec.write,
                "needs_confirmation": spec.needs_confirmation,
            }
        self._chat_loaded = True

    async def load_mcp_tools(self) -> None:
        """Load tools from all enabled MCP servers."""
        servers = await server_manager.list_enabled_servers()
        for server in servers:
            tools_json = server.get("tools_json")
            if not tools_json:
                continue
            import json
            tools = json.loads(tools_json)
            for tool in tools:
                full_name = f"mcp_{server['name']}_{tool['name']}"
                categories = taxonomy.classify_tool(tool["name"], tool.get("description", ""))
                self._tools[full_name] = {
                    "name": full_name,
                    "original_name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                    "capabilities": categories,
                    "domain": taxonomy.get_domain(categories),
                    "source": "mcp",
                    "server_id": server["server_id"],
                    "server_name": server["name"],
                    "latency_hint_ms": 2000,
                }

    def register_tool(self, name: str, **meta: Any) -> None:
        """Register a custom tool (e.g. from a plugin)."""
        categories = taxonomy.classify_tool(name, meta.get("description", ""))
        self._tools[name] = {
            "name": name,
            "description": meta.get("description", ""),
            "capabilities": categories,
            "domain": taxonomy.get_domain(categories),
            "source": "custom",
            **{k: v for k, v in meta.items() if k not in ("description",)},
        }

    def get_tool(self, name: str) -> dict[str, Any] | None:
        """Get metadata for a specific tool."""
        self._load_chat_tools()
        return self._tools.get(name)

    def list_tools(self) -> list[dict[str, Any]]:
        """List all registered tools."""
        self._load_chat_tools()
        return list(self._tools.values())

    def list_by_domain(self, domain: str) -> list[dict[str, Any]]:
        """List tools filtered by domain."""
        self._load_chat_tools()
        return [t for t in self._tools.values() if t.get("domain") == domain]

    def list_by_capability(self, capability: str) -> list[dict[str, Any]]:
        """List tools that have a specific capability."""
        self._load_chat_tools()
        return [t for t in self._tools.values() if capability in t.get("capabilities", [])]

    def get_reliability(self, tool_name: str) -> dict[str, Any]:
        """Get reliability stats for a tool."""
        return {"success_rate": 1.0, "avg_latency_ms": 2000}


tool_registry = ToolRegistry()


def validate_tool_system() -> None:
    """Validate that the registry and catalog are synchronized.

    Raises RuntimeError if there are mismatches.
    """
    from app.services.chat_tools import TOOL_CATALOG

    catalog_names = set(TOOL_CATALOG.keys())
    # Registry is generated from catalog, so they should always match.
    # This validates the generation logic works correctly.
    registry = ToolRegistry()
    registry._load_chat_tools()
    registry_names = set(registry._tools.keys())

    missing_in_registry = catalog_names - registry_names
    missing_in_catalog = registry_names - catalog_names

    if missing_in_registry or missing_in_catalog:
        raise RuntimeError(
            f"Tool system mismatch. "
            f"Missing in registry: {missing_in_registry}; "
            f"Missing in catalog: {missing_in_catalog}"
        )

    logger.info("Tool system validated: %d tools registered", len(registry_names))
