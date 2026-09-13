"""Tool Registry — two-layer registry for chat + MCP tools.

Layer 1: Static chat tools from TOOL_CATALOG (loaded once)
Layer 2: Dynamic MCP tools from MCPTool table (loaded per-request or cached)

MCP tools are namespaced as `server__tool` (double underscore).
The registry provides metadata, capabilities, and domain classification.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.database import db
from app.services.mcp.taxonomy import taxonomy
from app.tools.schemas import ToolDescriptor, ToolSource

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Two-layer tool registry: static chat + dynamic MCP."""

    def __init__(self) -> None:
        self._chat_tools: dict[str, ToolDescriptor] = {}
        self._mcp_tools: dict[str, ToolDescriptor] = {}
        self._chat_loaded = False

    def _load_chat_tools(self) -> None:
        """Load chat tool catalog into the registry (once)."""
        if self._chat_loaded:
            return
        from app.services.chat_tools import TOOL_CATALOG
        for name, spec in TOOL_CATALOG.items():
            categories = taxonomy.classify_tool(name, spec.description)
            self._chat_tools[name] = ToolDescriptor(
                name=name,
                description=spec.description,
                source=ToolSource.CHAT,
                parameters=spec.params,
                write=spec.write,
                needs_confirmation=spec.needs_confirmation,
                capabilities=categories,
                domain=taxonomy.get_domain(categories),
            )
        self._chat_loaded = True

    async def load_mcp_tools(self) -> None:
        """Load MCP tools from the MCPTool table."""
        tools = await db.list_enabled_mcp_tools()
        self._mcp_tools.clear()
        for tool in tools:
            try:
                params = json.loads(tool.get("input_schema", "{}"))
            except (json.JSONDecodeError, TypeError):
                params = {"type": "object", "properties": {}}

            categories = taxonomy.classify_tool(tool["name"], tool.get("description", ""))
            self._mcp_tools[tool["public_name"]] = ToolDescriptor(
                name=tool["public_name"],
                description=tool.get("description", ""),
                source=ToolSource.MCP,
                parameters=params,
                server_id=tool["server_id"],
                public_name=tool["public_name"],
                original_name=tool["name"],
                capabilities=categories,
                domain=taxonomy.get_domain(categories),
                timeout_ms=30000,
            )

    def register_tool(self, name: str, **meta: Any) -> None:
        """Register a custom tool."""
        categories = taxonomy.classify_tool(name, meta.get("description", ""))
        self._chat_tools[name] = ToolDescriptor(
            name=name,
            description=meta.get("description", ""),
            source=ToolSource.CUSTOM,
            parameters=meta.get("parameters", {"type": "object", "properties": {}}),
            capabilities=categories,
            domain=taxonomy.get_domain(categories),
            **{k: v for k, v in meta.items() if k not in ("description", "parameters")},
        )

    def get_tool(self, name: str) -> ToolDescriptor | None:
        """Get a tool descriptor by name."""
        self._load_chat_tools()
        return self._chat_tools.get(name) or self._mcp_tools.get(name)

    def list_tools(self) -> list[ToolDescriptor]:
        """List all registered tools (chat + MCP)."""
        self._load_chat_tools()
        return list(self._chat_tools.values()) + list(self._mcp_tools.values())

    def list_chat_tools(self) -> list[ToolDescriptor]:
        """List only chat tools."""
        self._load_chat_tools()
        return list(self._chat_tools.values())

    def list_mcp_tools(self) -> list[ToolDescriptor]:
        """List only MCP tools."""
        return list(self._mcp_tools.values())

    def list_by_domain(self, domain: str) -> list[ToolDescriptor]:
        """List tools filtered by domain."""
        self._load_chat_tools()
        all_tools = list(self._chat_tools.values()) + list(self._mcp_tools.values())
        return [t for t in all_tools if t.domain == domain]

    def list_by_capability(self, capability: str) -> list[ToolDescriptor]:
        """List tools that have a specific capability."""
        self._load_chat_tools()
        all_tools = list(self._chat_tools.values()) + list(self._mcp_tools.values())
        return [t for t in all_tools if capability in t.capabilities]

    def to_openai_functions(self, include_mcp: bool = True) -> list[dict[str, Any]]:
        """Get all tools in OpenAI function-calling format."""
        self._load_chat_tools()
        schemas = [t.to_openai_function() for t in self._chat_tools.values()]
        if include_mcp:
            schemas.extend([t.to_openai_function() for t in self._mcp_tools.values()])
        return schemas

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
    registry = ToolRegistry()
    registry._load_chat_tools()
    registry_names = set(registry._chat_tools.keys())

    missing_in_registry = catalog_names - registry_names
    missing_in_catalog = registry_names - catalog_names

    if missing_in_registry or missing_in_catalog:
        raise RuntimeError(
            f"Tool system mismatch. "
            f"Missing in registry: {missing_in_registry}; "
            f"Missing in catalog: {missing_in_catalog}"
        )

    logger.info("Tool system validated: %d chat tools registered", len(registry_names))
