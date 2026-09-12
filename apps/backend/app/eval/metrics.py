"""Evaluation Metrics — tool selection, recovery, latency, cost metrics."""

from __future__ import annotations

import logging
from typing import Any

from app.eval.trace import AgentTrace

logger = logging.getLogger(__name__)


class EvalMetrics:
    """Computes evaluation metrics from agent traces."""

    def compute(self, traces: list[AgentTrace]) -> dict[str, Any]:
        """Compute aggregate metrics from a list of traces."""
        if not traces:
            return {}

        total = len(traces)
        successful = sum(1 for t in traces if t.success)

        latencies = [t.total_time_ms for t in traces if t.total_time_ms > 0]
        tools_per_turn = [len(t.tool_calls) for t in traces]

        return {
            "total_traces": total,
            "success_rate": successful / total if total else 0.0,
            "avg_latency_ms": sum(latencies) / len(latencies) if latencies else 0.0,
            "p95_latency_ms": self._percentile(latencies, 95) if latencies else 0.0,
            "avg_tools_per_turn": sum(tools_per_turn) / total if total else 0.0,
            "avg_iterations": sum(t.iterations for t in traces) / total if total else 0.0,
            "recovery_rate": self._recovery_rate(traces),
            "avg_answer_length": sum(t.final_answer_length for t in traces) / total if total else 0.0,
        }

    def _percentile(self, values: list[float], percentile: int) -> float:
        """Calculate percentile of a list of values."""
        if not values:
            return 0.0
        sorted_values = sorted(values)
        index = int(len(sorted_values) * percentile / 100)
        return sorted_values[min(index, len(sorted_values) - 1)]

    def _recovery_rate(self, traces: list[AgentTrace]) -> float:
        """Calculate the rate of successful recoveries."""
        with_recovery = [t for t in traces if t.recovery_attempts > 0]
        if not with_recovery:
            return 0.0
        successful_recoveries = sum(1 for t in with_recovery if t.success)
        return successful_recoveries / len(with_recovery)


eval_metrics = EvalMetrics()
