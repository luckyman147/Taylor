"""P0-10: P95 Latency."""

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class P95Latency:
    """What's the 95th percentile latency across all runs?"""

    name = "p95_latency_ms"

    def __init__(self) -> None:
        self._latencies: list[float] = []

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        self._latencies.append(trace.latency_ms)

        if len(self._latencies) < 5:
            return MetricResult(
                self.name,
                trace.latency_ms,
                {"note": f"collecting samples ({len(self._latencies)}/5)", "current": trace.latency_ms},
                None,
            )

        sorted_lat = sorted(self._latencies)
        p95_idx = int(len(sorted_lat) * 0.95)
        p95 = sorted_lat[min(p95_idx, len(sorted_lat) - 1)]
        p50_idx = int(len(sorted_lat) * 0.50)
        p50 = sorted_lat[p50_idx]

        return MetricResult(
            self.name,
            p95,
            {
                "p95_ms": p95,
                "p50_ms": p50,
                "samples": len(sorted_lat),
                "min_ms": sorted_lat[0],
                "max_ms": sorted_lat[-1],
            },
            p95 <= 15000,
        )


registry.register(P95Latency())
