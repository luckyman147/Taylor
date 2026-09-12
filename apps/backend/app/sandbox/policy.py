"""Sandbox Policy — security rules and permission checks for workflow execution."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class ExecutionPolicy:
    """Controls what tools can execute and with what constraints."""

    BLOCKED_TOOLS: set[str] = {"reset_database", "delete_resume"}
    MAX_TIMEOUT_MS: int = 60000
    MAX_PARALLEL: int = 5

    def check_step(
        self,
        tool_name: str,
        mode: str,
        skills: list[str] | None = None,
    ) -> str | None:
        """Check if a step is allowed. Returns error message if blocked, None if allowed."""
        if tool_name in self.BLOCKED_TOOLS:
            return f"Tool '{tool_name}' is blocked"

        # Check permissions
        from app.tools.permissions import permission_manager
        if permission_manager.requires_confirmation(tool_name, mode, skills):
            return f"Tool '{tool_name}' requires confirmation"

        return None

    def requires_confirmation(
        self,
        tool_name: str,
        mode: str,
        skills: list[str] | None = None,
    ) -> bool:
        """Check if a tool requires user confirmation before execution."""
        from app.tools.permissions import permission_manager
        return permission_manager.requires_confirmation(tool_name, mode, skills)


policy = ExecutionPolicy()
