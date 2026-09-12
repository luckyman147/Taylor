"""Agent Recovery — handles tool failures with classification and retries.

Classifies errors into categories (transient, auth, invalid, etc.)
and applies the appropriate recovery strategy.
"""

import logging
from enum import Enum
from typing import Any

from app.agent.state import TaylorState, ToolCall
from app.agent.evaluate import agent_evaluator

logger = logging.getLogger(__name__)


class FailureType(str, Enum):
    """Classification of tool failures."""
    TRANSIENT = "transient"          # Retry
    AUTHENTICATION = "authentication"  # Refresh credential / ask user
    INVALID_ARGUMENT = "invalid_argument"  # Re-plan with different args
    RATE_LIMIT = "rate_limit"        # Backoff and retry
    TIMEOUT = "timeout"              # Retry with longer timeout
    SERVER_ERROR = "server_error"    # Retry or alternative
    NOT_FOUND = "not_found"          # Skip
    EMPTY_RESULT = "empty_result"    # Try alternative tool
    UNSUPPORTED = "unsupported"      # Try alternative tool
    PERMISSION_DENIED = "permission_denied"  # Ask user
    UNKNOWN = "unknown"              # Skip


# Error pattern -> FailureType mapping
_ERROR_PATTERNS: list[tuple[str, FailureType]] = [
    ("timeout", FailureType.TIMEOUT),
    ("timed out", FailureType.TIMEOUT),
    ("rate limit", FailureType.RATE_LIMIT),
    ("429", FailureType.RATE_LIMIT),
    ("authentication", FailureType.AUTHENTICATION),
    ("unauthorized", FailureType.AUTHENTICATION),
    ("401", FailureType.AUTHENTICATION),
    ("forbidden", FailureType.PERMISSION_DENIED),
    ("403", FailureType.PERMISSION_DENIED),
    ("permission denied", FailureType.PERMISSION_DENIED),
    ("invalid argument", FailureType.INVALID_ARGUMENT),
    ("bad request", FailureType.INVALID_ARGUMENT),
    ("400", FailureType.INVALID_ARGUMENT),
    ("not found", FailureType.NOT_FOUND),
    ("404", FailureType.NOT_FOUND),
    ("empty result", FailureType.EMPTY_RESULT),
    ("no results", FailureType.EMPTY_RESULT),
    ("unsupported", FailureType.UNSUPPORTED),
    ("not implemented", FailureType.UNSUPPORTED),
    ("500", FailureType.SERVER_ERROR),
    ("502", FailureType.SERVER_ERROR),
    ("503", FailureType.SERVER_ERROR),
    ("internal error", FailureType.SERVER_ERROR),
    ("connection", FailureType.TRANSIENT),
    ("temporary", FailureType.TRANSIENT),
]


class AgentRecovery:
    """Handles tool failures with classification and recovery strategies."""

    def classify_error(self, error: str) -> FailureType:
        """Classify an error message into a failure type."""
        error_lower = error.lower()
        for pattern, failure_type in _ERROR_PATTERNS:
            if pattern in error_lower:
                return failure_type
        return FailureType.UNKNOWN

    async def handle_failure(
        self,
        state: TaylorState,
        failed_call: ToolCall,
    ) -> dict[str, Any]:
        """Handle a failed tool call.

        Returns:
            {"action": "retry" | "skip" | "re_plan" | "ask_user",
             "reason": str, "new_args": dict | None}
        """
        error = failed_call.error or "Unknown error"
        failure_type = self.classify_error(error)
        consecutive_failures = state.get("consecutive_failures", 0)

        logger.info(
            "Tool %s failed with %s (type=%s, failures=%d)",
            failed_call.tool_name, error, failure_type.value, consecutive_failures,
        )

        if failure_type == FailureType.TRANSIENT:
            if consecutive_failures < 2:
                return {"action": "retry", "reason": "Transient error, retrying"}
            return {"action": "skip", "reason": "Too many transient failures"}

        if failure_type == FailureType.TIMEOUT:
            if consecutive_failures < 2:
                return {"action": "retry", "reason": "Timeout, retrying with longer timeout"}
            return {"action": "skip", "reason": "Repeated timeouts"}

        if failure_type == FailureType.AUTHENTICATION:
            return {"action": "ask_user", "reason": f"Authentication required: {error}"}

        if failure_type == FailureType.PERMISSION_DENIED:
            return {"action": "ask_user", "reason": f"Permission denied: {error}"}

        if failure_type == FailureType.INVALID_ARGUMENT:
            return {"action": "re_plan", "reason": f"Invalid arguments: {error}"}

        if failure_type == FailureType.RATE_LIMIT:
            if consecutive_failures < 2:
                return {"action": "retry", "reason": "Rate limited, will retry"}
            return {"action": "skip", "reason": "Rate limited, skipping"}

        if failure_type in (FailureType.NOT_FOUND, FailureType.UNSUPPORTED):
            return {"action": "skip", "reason": f"Not found/unsupported: {error}"}

        if failure_type == FailureType.EMPTY_RESULT:
            return {"action": "re_plan", "reason": "Empty result, try alternative"}

        if failure_type == FailureType.SERVER_ERROR:
            if consecutive_failures < 2:
                return {"action": "retry", "reason": "Server error, retrying"}
            return {"action": "skip", "reason": "Repeated server errors"}

        # Unknown
        return {"action": "skip", "reason": f"Unknown error: {error}"}


agent_recovery = AgentRecovery()
