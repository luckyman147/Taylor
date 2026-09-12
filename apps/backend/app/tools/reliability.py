"""Tool Reliability — tracks tool success rates and failure patterns.

Updates ToolUsageStats after each tool execution. Used by the ranker
to score tools by historical reliability.
"""

import logging
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)


class ToolReliability:
    """Tracks tool execution reliability metrics."""

    async def record_success(self, tool_name: str, latency_ms: float) -> None:
        """Record a successful tool execution."""
        await db.update_tool_usage(tool_name, success=True, latency_ms=latency_ms)

    async def record_failure(self, tool_name: str, latency_ms: float, error_type: str) -> None:
        """Record a failed tool execution."""
        await db.update_tool_usage(tool_name, success=False, latency_ms=latency_ms, error_type=error_type)

    async def get_success_rate(self, tool_name: str) -> float:
        """Get the success rate for a tool (0.0 - 1.0)."""
        stats = await db.get_tool_usage(tool_name)
        if not stats or stats["total_calls"] == 0:
            return 1.0  # Default for tools with no history
        return stats["successful_calls"] / stats["total_calls"]

    async def get_avg_latency(self, tool_name: str) -> float:
        """Get average latency in milliseconds for a tool."""
        stats = await db.get_tool_usage(tool_name)
        if not stats:
            return 2000.0  # Default
        return stats["avg_latency_ms"]

    async def get_reliability_score(self, tool_name: str) -> float:
        """Get a combined reliability score (0.0 - 1.0).

        Combines success rate with a penalty for recent failures.
        """
        stats = await db.get_tool_usage(tool_name)
        if not stats or stats["total_calls"] < 3:
            return 0.8  # Neutral for tools with little history

        success_rate = stats["successful_calls"] / stats["total_calls"]

        # Penalty for recent consecutive failures
        penalty = 0.0
        if stats.get("last_error_type"):
            from datetime import datetime, timezone
            try:
                last_error = datetime.fromisoformat(stats["last_error_at"])
                now = datetime.now(timezone.utc)
                hours_ago = (now - last_error).total_seconds() / 3600
                if hours_ago < 1:
                    penalty = 0.3  # Recent failure
                elif hours_ago < 24:
                    penalty = 0.1
            except (ValueError, TypeError):
                pass

        return max(0.0, success_rate - penalty)

    async def get_all_reliability_scores(self) -> dict[str, float]:
        """Get reliability scores for all tools."""
        stats = await db.list_tool_usage()
        return {
            s["tool_name"]: await self.get_reliability_score(s["tool_name"])
            for s in stats
        }


tool_reliability = ToolReliability()
