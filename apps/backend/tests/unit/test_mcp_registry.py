"""Tests for tool registry (two-layer, OpenAI format)."""

import pytest
from app.tools.registry import ToolRegistry, tool_registry
from app.tools.schemas import ToolDescriptor, ToolSource


class TestToolRegistry:
    """Test the two-layer tool registry."""

    def test_chat_tools_loaded(self):
        """Test that chat tools are loaded from TOOL_CATALOG."""
        registry = ToolRegistry()
        chat_tools = registry.list_chat_tools()
        assert len(chat_tools) > 0

    def test_chat_tool_descriptor_type(self):
        """Test that chat tools are ToolDescriptor instances."""
        registry = ToolRegistry()
        chat_tools = registry.list_chat_tools()
        for tool in chat_tools:
            assert isinstance(tool, ToolDescriptor)
            assert tool.source == ToolSource.CHAT

    def test_get_tool_by_name(self):
        """Test getting a tool by name."""
        registry = ToolRegistry()
        # Get a known chat tool
        tools = registry.list_chat_tools()
        if tools:
            tool = registry.get_tool(tools[0].name)
            assert tool is not None
            assert tool.name == tools[0].name

    def test_get_tool_not_found(self):
        """Test getting a non-existent tool."""
        registry = ToolRegistry()
        tool = registry.get_tool("nonexistent_tool_xyz")
        assert tool is None

    def test_to_openai_functions(self):
        """Test OpenAI function-calling format."""
        registry = ToolRegistry()
        functions = registry.to_openai_functions(include_mcp=False)
        assert len(functions) > 0
        for func in functions:
            assert func["type"] == "function"
            assert "function" in func
            assert "name" in func["function"]
            assert "description" in func["function"]
            assert "parameters" in func["function"]

    def test_list_by_domain(self):
        """Test filtering by domain."""
        registry = ToolRegistry()
        all_tools = registry.list_tools()
        domains = {t.domain for t in all_tools}
        for domain in domains:
            filtered = registry.list_by_domain(domain)
            assert all(t.domain == domain for t in filtered)

    def test_list_by_capability(self):
        """Test filtering by capability."""
        registry = ToolRegistry()
        all_tools = registry.list_tools()
        capabilities = set()
        for t in all_tools:
            capabilities.update(t.capabilities)
        for cap in list(capabilities)[:3]:  # Test first 3
            filtered = registry.list_by_capability(cap)
            assert all(cap in t.capabilities for t in filtered)

    def test_register_custom_tool(self):
        """Test registering a custom tool."""
        registry = ToolRegistry()
        registry.register_tool(
            "custom_test_tool",
            description="A custom test tool",
            parameters={"type": "object", "properties": {"x": {"type": "string"}}},
        )
        tool = registry.get_tool("custom_test_tool")
        assert tool is not None
        assert tool.source == ToolSource.CUSTOM
        assert tool.description == "A custom test tool"

    def test_global_registry_has_tools(self):
        """Test that the global registry singleton has tools."""
        tools = tool_registry.list_chat_tools()
        assert len(tools) > 0
