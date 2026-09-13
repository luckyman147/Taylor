"""Tests for MCPTool CRUD operations."""

import json
import pytest
from app.database import db


@pytest.mark.asyncio
async def test_upsert_mcp_tool_create():
    """Test creating a new MCP tool."""
    tool = await db.upsert_mcp_tool(
        tool_id="tool_test_create",
        server_id="mcp_test_server",
        name="search_jobs",
        public_name="test_server__search_jobs",
        description="Search for jobs",
        input_schema=json.dumps({"type": "object", "properties": {"q": {"type": "string"}}}),
    )
    assert tool["id"] == "tool_test_create"
    assert tool["name"] == "search_jobs"
    assert tool["public_name"] == "test_server__search_jobs"
    assert tool["enabled"] is True

    # Cleanup
    await db.delete_mcp_tools_for_server("mcp_test_server")


@pytest.mark.asyncio
async def test_upsert_mcp_tool_update():
    """Test updating an existing MCP tool (should not duplicate)."""
    await db.upsert_mcp_tool(
        tool_id="tool_test_update",
        server_id="mcp_test_server",
        name="search_jobs",
        public_name="test_server__search_jobs",
        description="Original description",
    )

    # Upsert again with same server_id + name
    await db.upsert_mcp_tool(
        tool_id="tool_test_update_new",
        server_id="mcp_test_server",
        name="search_jobs",
        public_name="test_server__search_jobs_v2",
        description="Updated description",
    )

    tools = await db.list_mcp_tools_for_server("mcp_test_server")
    assert len(tools) == 1
    assert tools[0]["description"] == "Updated description"

    # Cleanup
    await db.delete_mcp_tools_for_server("mcp_test_server")


@pytest.mark.asyncio
async def test_list_mcp_tools_for_server():
    """Test listing tools for a specific server."""
    await db.upsert_mcp_tool("tool1", "mcp_s1", "t1", "s1__t1")
    await db.upsert_mcp_tool("tool2", "mcp_s1", "t2", "s1__t2")
    await db.upsert_mcp_tool("tool3", "mcp_s2", "t3", "s2__t3")

    tools_s1 = await db.list_mcp_tools_for_server("mcp_s1")
    tools_s2 = await db.list_mcp_tools_for_server("mcp_s2")

    assert len(tools_s1) == 2
    assert len(tools_s2) == 1

    # Cleanup
    await db.delete_mcp_tools_for_server("mcp_s1")
    await db.delete_mcp_tools_for_server("mcp_s2")


@pytest.mark.asyncio
async def test_list_enabled_mcp_tools():
    """Test listing only enabled tools."""
    await db.upsert_mcp_tool("tool1", "mcp_s1", "t1", "s1__t1")
    await db.upsert_mcp_tool("tool2", "mcp_s1", "t2", "s1__t2")

    # Disable one tool
    await db.update_mcp_tool("tool1", enabled=False)

    enabled = await db.list_enabled_mcp_tools()
    enabled_ids = [t["id"] for t in enabled]

    assert "tool1" not in enabled_ids
    assert "tool2" in enabled_ids

    # Cleanup
    await db.delete_mcp_tools_for_server("mcp_s1")


@pytest.mark.asyncio
async def test_toggle_mcp_tool():
    """Test toggling tool enabled state."""
    await db.upsert_mcp_tool("tool_toggle", "mcp_s1", "t1", "s1__t1")

    tool = await db.get_mcp_tool("tool_toggle")
    assert tool["enabled"] is True

    await db.update_mcp_tool("tool_toggle", enabled=False)
    tool = await db.get_mcp_tool("tool_toggle")
    assert tool["enabled"] is False

    await db.update_mcp_tool("tool_toggle", enabled=True)
    tool = await db.get_mcp_tool("tool_toggle")
    assert tool["enabled"] is True

    # Cleanup
    await db.delete_mcp_tools_for_server("mcp_s1")


@pytest.mark.asyncio
async def test_delete_mcp_tools_for_server():
    """Test deleting all tools for a server."""
    await db.upsert_mcp_tool("tool1", "mcp_s1", "t1", "s1__t1")
    await db.upsert_mcp_tool("tool2", "mcp_s1", "t2", "s1__t2")

    count = await db.delete_mcp_tools_for_server("mcp_s1")
    assert count == 2

    tools = await db.list_mcp_tools_for_server("mcp_s1")
    assert len(tools) == 0


@pytest.mark.asyncio
async def test_namespacing():
    """Test tool namespacing as server__tool."""
    tool = await db.upsert_mcp_tool(
        tool_id="tool_ns",
        server_id="mcp_s1",
        name="search",
        public_name="my_server__search",
    )
    assert tool["public_name"] == "my_server__search"

    # Cleanup
    await db.delete_mcp_tools_for_server("mcp_s1")
