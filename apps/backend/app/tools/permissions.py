"""Tool Permissions — controls which tools can be called automatically.

Classifies tools by permission level and gates execution based on mode
and user confirmation.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class PermissionLevel:
    """Tool permission levels."""
    READ = "read"           # Automatic, no confirmation needed
    WRITE = "write"         # Automatic in agent mode, requires confirmation in ask mode
    DESTRUCTIVE = "destructive"  # Always requires user confirmation


# Tool permission classifications
TOOL_PERMISSIONS: dict[str, str] = {
    # Read-only tools (automatic)
    "analyze_resume": PermissionLevel.READ,
    "match_job": PermissionLevel.READ,
    "get_career_stats": PermissionLevel.READ,
    "compare_resumes": PermissionLevel.READ,
    "extract_job_keywords": PermissionLevel.READ,
    "get_practice_questions": PermissionLevel.READ,
    "get_learning_resources": PermissionLevel.READ,
    "view_file": PermissionLevel.READ,
    "web_search": PermissionLevel.READ,
    "get_career_summary": PermissionLevel.READ,
    "get_ats_audit": PermissionLevel.READ,
    "get_funnel_stats": PermissionLevel.READ,
    "get_skill_roi": PermissionLevel.READ,
    "get_market_position": PermissionLevel.READ,
    "get_skill_suggestions": PermissionLevel.READ,
    "get_applications": PermissionLevel.READ,
    "get_rejections": PermissionLevel.READ,
    "get_contacts": PermissionLevel.READ,
    "get_companies": PermissionLevel.READ,
    "get_job_verdict": PermissionLevel.READ,
    "get_evidence": PermissionLevel.READ,
    "get_resume_for_audit": PermissionLevel.READ,
    "search_mcp_jobs": PermissionLevel.READ,
    "list_mcp_sources": PermissionLevel.READ,
    # Write tools (conditional)
    "generate_cover_letter": PermissionLevel.WRITE,
    "generate_outreach_message": PermissionLevel.WRITE,
    "generate_resume_title": PermissionLevel.WRITE,
    "create_application": PermissionLevel.WRITE,
    "update_application_status": PermissionLevel.WRITE,
    "create_skill": PermissionLevel.WRITE,
    "create_contact": PermissionLevel.WRITE,
    "create_followup": PermissionLevel.WRITE,
    # Destructive tools (always confirm)
    "delete_resume": PermissionLevel.DESTRUCTIVE,
    "delete_job": PermissionLevel.DESTRUCTIVE,
    "reset_database": PermissionLevel.DESTRUCTIVE,
}

# MCP tool permission defaults (by auth type)
MCP_PERMISSION_DEFAULTS: dict[str, str] = {
    "api_key": PermissionLevel.READ,
    "bearer": PermissionLevel.READ,
    "oauth": PermissionLevel.READ,
    "custom_headers": PermissionLevel.READ,
}


class ToolPermissionManager:
    """Controls tool execution permissions."""

    def get_permission(self, tool_name: str) -> str:
        """Get the permission level for a tool."""
        # Check explicit classification
        if tool_name in TOOL_PERMISSIONS:
            return TOOL_PERMISSIONS[tool_name]

        # MCP tools: default based on naming conventions
        if tool_name.startswith("mcp_"):
            return self._classify_mcp_permission(tool_name)

        # Unknown tools: require confirmation
        return PermissionLevel.WRITE

    def _classify_mcp_permission(self, tool_name: str) -> str:
        """Classify MCP tool permission based on name/description."""
        name_lower = tool_name.lower()
        # Destructive patterns
        destructive = ["delete", "remove", "destroy", "drop", "reset", "purge"]
        for pattern in destructive:
            if pattern in name_lower:
                return PermissionLevel.DESTRUCTIVE

        # Write patterns
        write = ["create", "update", "edit", "modify", "send", "post", "publish", "write"]
        for pattern in write:
            if pattern in name_lower:
                return PermissionLevel.WRITE

        # Everything else is read
        return PermissionLevel.READ

    def can_auto_execute(self, tool_name: str, mode: str = "ask", skills: list[str] | None = None) -> bool:
        """Check if a tool can be executed automatically in the given mode."""
        permission = self.get_permission(tool_name)

        if permission == PermissionLevel.READ:
            return True
        if permission == PermissionLevel.WRITE:
            # Agent mode auto-executes all writes
            if mode == "agent":
                return True
            # Skills auto-execute their allowed tools
            if skills:
                from app.prompts import get_skill_allowlist
                allowlist = get_skill_allowlist(skills)
                if tool_name in allowlist:
                    return True
            return False
        if permission == PermissionLevel.DESTRUCTIVE:
            return False  # Always needs confirmation

        return False

    def requires_confirmation(self, tool_name: str, mode: str = "ask", skills: list[str] | None = None) -> bool:
        """Check if a tool requires user confirmation before execution."""
        return not self.can_auto_execute(tool_name, mode, skills)

    def get_tools_for_mode(self, mode: str) -> list[str]:
        """Get all tools that can be auto-executed in the given mode."""
        all_tools = list(TOOL_PERMISSIONS.keys())
        return [t for t in all_tools if self.can_auto_execute(t, mode)]


permission_manager = ToolPermissionManager()
