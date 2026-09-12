"""MCP Health Monitoring — proactive server health tracking.

Tracks server health metrics (success rate, latency, consecutive failures)
and provides health-based decisions for the tool ranker.
"""

import logging
from datetime import datetime, timezone

from app.database import db

logger = logging.getLogger(__name__)


class MCPHealthMonitor:
    """Proactive health monitoring for MCP servers."""

    # Consecutive failures before marking a server as unhealthy
    FAILURE_THRESHOLD = 3
    # Minimum calls before health stats are meaningful
    MIN_CALLS_FOR_STATS = 5

    async def record_success(self, server_id: str, latency_ms: float) -> None:
        """Record a successful tool call."""
        server = await db.get_mcp_server(server_id)
        if not server:
            return

        now = datetime.now(timezone.utc).isoformat()
        await db.update_mcp_server(
            server_id,
            health_last_success=now,
            health_consecutive_failures=0,
            health_total_calls=server["health_total_calls"] + 1,
            health_success_calls=server["health_success_calls"] + 1,
            health_avg_latency_ms=(
                (server["health_avg_latency_ms"] * server["health_total_calls"] + latency_ms)
                / (server["health_total_calls"] + 1)
            ),
        )

    async def record_failure(self, server_id: str, error: str) -> None:
        """Record a failed tool call."""
        server = await db.get_mcp_server(server_id)
        if not server:
            return

        now = datetime.now(timezone.utc).isoformat()
        consecutive = server["health_consecutive_failures"] + 1
        await db.update_mcp_server(
            server_id,
            health_last_failure=now,
            health_consecutive_failures=consecutive,
            health_total_calls=server["health_total_calls"] + 1,
        )

        if consecutive >= self.FAILURE_THRESHOLD:
            await db.update_mcp_server(
                server_id,
                enabled=False,
                error_message=f"Auto-disabled after {consecutive} consecutive failures: {error}",
            )
            logger.warning(
                "Auto-disabled MCP server %s after %d consecutive failures",
                server_id, consecutive,
            )

    async def get_health_score(self, server_id: str) -> float:
        """Get a health score (0.0 to 1.0) for a server.

        Returns 0.5 (neutral) if not enough data.
        """
        server = await db.get_mcp_server(server_id)
        if not server:
            return 0.0

        total = server["health_total_calls"]
        if total < self.MIN_CALLS_FOR_STATS:
            return 0.5  # Not enough data, neutral

        success_rate = server["health_success_calls"] / total
        consecutive_penalty = min(server["health_consecutive_failures"] / self.FAILURE_THRESHOLD, 1.0)

        return max(0.0, success_rate - consecutive_penalty * 0.3)

    async def is_healthy(self, server_id: str) -> bool:
        """Check if a server is considered healthy."""
        score = await self.get_health_score(server_id)
        return score >= 0.3

    async def get_all_health_scores(self) -> dict[str, float]:
        """Get health scores for all servers."""
        servers = await db.list_mcp_servers()
        scores = {}
        for server in servers:
            scores[server["server_id"]] = await self.get_health_score(server["server_id"])
        return scores

    async def reset_health(self, server_id: str) -> None:
        """Reset health stats for a server (e.g. after manual fix)."""
        await db.update_mcp_server(
            server_id,
            health_consecutive_failures=0,
            health_total_calls=0,
            health_success_calls=0,
            health_avg_latency_ms=0.0,
            health_last_success=None,
            health_last_failure=None,
            enabled=True,
            error_message=None,
            status="unknown",
        )


health_monitor = MCPHealthMonitor()
