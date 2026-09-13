"""Tool schemas — type-safe models for tool descriptors.

Used by the registry and executor to validate tool calls.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ToolSource(str, Enum):
    """Where a tool comes from."""

    CHAT = "chat"
    MCP = "mcp"
    CUSTOM = "custom"


@dataclass
class ToolDescriptor:
    """Type-safe descriptor for a registered tool."""

    name: str
    description: str
    source: ToolSource
    parameters: dict[str, Any] = field(default_factory=lambda: {"type": "object", "properties": {}})

    # MCP-specific fields
    server_id: str | None = None
    server_name: str | None = None
    public_name: str | None = None  # namespaced name for MCP tools
    original_name: str | None = None  # original tool name on the server

    # Capabilities
    write: bool = False
    needs_confirmation: bool = False
    capabilities: list[str] = field(default_factory=list)
    domain: str = "general"

    # Limits
    timeout_ms: int = 15000
    max_output_tokens: int = 8192
    max_response_bytes: int = 1_048_576  # 1MB

    @property
    def is_mcp(self) -> bool:
        return self.source == ToolSource.MCP

    @property
    def is_chat(self) -> bool:
        return self.source == ToolSource.CHAT

    def to_dict(self) -> dict[str, Any]:
        """Convert to a plain dict for API responses."""
        result: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "source": self.source.value,
            "parameters": self.parameters,
            "write": self.write,
            "needs_confirmation": self.needs_confirmation,
        }
        if self.server_id:
            result["server_id"] = self.server_id
        if self.server_name:
            result["server_name"] = self.server_name
        if self.public_name:
            result["public_name"] = self.public_name
        if self.original_name:
            result["original_name"] = self.original_name
        return result

    def to_openai_function(self) -> dict[str, Any]:
        """Convert to OpenAI function-calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.public_name or self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }
