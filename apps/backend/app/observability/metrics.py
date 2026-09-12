"""Observability Metrics — aggregates performance metrics.

Tracks tool usage patterns, latency distributions, and error rates
for monitoring and optimization.
"""

import logging
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)


class AgentMetrics:
    """Aggregates agent performance metrics."""

    async def record_tool_call(
        self,
        tool_name: str,
        success: bool,
        latency_ms: float,
        iteration: int,
        error_type: str | None = None,
    ) -> None:
        """Record a tool call metric."""
        await db.update_tool_usage(
            tool_name=tool_name,
            success=success,
            latency_ms=latency_ms,
            error_type=error_type,
        )

    async def get_tool_metrics(self) -> list[dict[str, Any]]:
        """Get metrics for all tools."""
        stats = await db.list_tool_usage()
        return [
            {
                "tool": s["tool_name"],
                "total_calls": s["total_calls"],
                "success_rate": (
                    s["successful_calls"] / s["total_calls"]
                    if s["total_calls"] > 0 else 0.0
                ),
                "avg_latency_ms": s["avg_latency_ms"],
                "last_error": s.get("last_error_type"),
            }
            for s in stats
        ]

    async def get_slowest_tools(self, top_k: int = 5) -> list[dict[str, Any]]:
        """Get the slowest tools by average latency."""
        metrics = await self.get_tool_metrics()
        metrics.sort(key=lambda m: m["avg_latency_ms"], reverse=True)
        return metrics[:top_k]

    async def get_least_reliable(self, top_k: int = 5) -> list[dict[str, Any]]:
        """Get the least reliable tools by success rate."""
        metrics = await self.get_tool_metrics()
        metrics.sort(key=lambda m: m["success_rate"])
        return metrics[:top_k]

    async def get_summary(self) -> dict[str, Any]:
        """Get overall metrics summary."""
        metrics = await self.get_tool_metrics()
        if not metrics:
            return {"total_tools": 0, "total_calls": 0, "avg_success_rate": 0.0}

        total_calls = sum(m["total_calls"] for m in metrics)
        total_success = sum(m["total_calls"] * m["success_rate"] for m in metrics)

        return {
            "total_tools": len(metrics),
            "total_calls": total_calls,
            "avg_success_rate": total_success / total_calls if total_calls > 0 else 0.0,
            "avg_latency_ms": sum(m["avg_latency_ms"] for m in metrics) / len(metrics),
        }


agent_metrics = AgentMetrics()
