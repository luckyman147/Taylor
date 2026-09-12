"""Unit tests for chat tool catalog, validation, and read tools."""

import pytest

from app.services.chat_tools import (
    TOOL_CATALOG,
    ToolRequiresConfirmation,
    execute_tool,
    get_tool_catalog_json,
    validate_tool_args,
)


class TestToolCatalog:
    def test_catalog_has_expected_tools(self):
        expected = {
            "get_career_summary",
            "get_ats_audit",
            "get_funnel_stats",
            "get_skill_roi",
            "get_market_position",
            "get_skill_suggestions",
            "get_applications",
            "get_rejections",
            "get_contacts",
            "get_companies",
            "search_mcp_jobs",
            "get_job_verdict",
            "get_evidence",
            "create_application",
            "update_application_status",
            "create_skill",
            "create_contact",
            "create_followup",
        }
        assert expected.issubset(set(TOOL_CATALOG.keys()))

    def test_read_tools_not_write(self):
        for name, spec in TOOL_CATALOG.items():
            if name.startswith("get_") or name == "search_mcp_jobs":
                assert spec.write is False, f"{name} should be read-only"

    def test_write_tools_flagged(self):
        for name, spec in TOOL_CATALOG.items():
            if name.startswith("create_") or name.startswith("update_"):
                assert spec.write is True, f"{name} should be write=True"


class TestGetToolCatalogJson:
    def test_returns_list(self):
        result = get_tool_catalog_json()
        assert isinstance(result, list)
        assert len(result) > 0

    def test_all_tools_have_required_fields(self):
        result = get_tool_catalog_json()
        for tool in result:
            assert "name" in tool
            assert "description" in tool
            assert "params" in tool
            assert "write" in tool

    def test_mode_returns_all_tools(self):
        # Mode parameter is accepted but doesn't filter tools (unified catalog)
        result = get_tool_catalog_json(mode="recruiter")
        assert len(result) == len(TOOL_CATALOG)

    def test_unknown_mode_returns_all(self):
        result = get_tool_catalog_json(mode="unknown")
        assert len(result) == len(TOOL_CATALOG)


class TestValidateToolArgs:
    def test_validates_required_args(self):
        result = validate_tool_args("search_mcp_jobs", {"query": "python"})
        assert result["query"] == "python"
        assert result["limit"] == 10  # default

    def test_missing_required_raises(self):
        with pytest.raises(ValueError, match="Missing required"):
            validate_tool_args("search_mcp_jobs", {})

    def test_truncates_long_strings(self):
        result = validate_tool_args(
            "search_mcp_jobs",
            {"query": "a" * 300},
        )
        assert len(result["query"]) == 200

    def test_validates_int_args(self):
        result = validate_tool_args("search_mcp_jobs", {"query": "python", "limit": "3"})
        assert result["limit"] == 3

    def test_invalid_int_raises(self):
        with pytest.raises(ValueError, match="must be an integer"):
            validate_tool_args("search_mcp_jobs", {"query": "python", "limit": "abc"})

    def test_unknown_tool_raises(self):
        with pytest.raises(ValueError, match="Unknown tool"):
            validate_tool_args("nonexistent_tool", {})


class TestExecuteTool:
    @pytest.mark.asyncio
    async def test_write_tool_raises_confirmation(self):
        with pytest.raises(ToolRequiresConfirmation) as exc_info:
            await execute_tool(
                "create_skill",
                {"name": "Python", "category": "technical"},
            )
        assert exc_info.value.tool == "create_skill"
        assert "Python" in exc_info.value.summary

    @pytest.mark.asyncio
    async def test_unknown_tool_raises(self):
        with pytest.raises(ValueError, match="Unknown tool"):
            await execute_tool("nonexistent_tool", {})

    @pytest.mark.asyncio
    async def test_get_career_summary_empty(self):
        """get_career_summary should work with empty DB."""
        result = await execute_tool("get_career_summary", {})
        assert isinstance(result, dict)
        assert "name" in result
        assert "skills" in result
