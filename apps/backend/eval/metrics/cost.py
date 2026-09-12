"""P0-9: Cost per Successful Task."""

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class CostPerSuccessfulTask:
    """How much did each successful task cost?"""

    name = "cost_per_task"

    def __init__(self) -> None:
        self._costs: list[float] = []
        self._successes: int = 0

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if trace.success:
            self._costs.append(trace.cost)
            self._successes += 1

        avg_cost = sum(self._costs) / len(self._costs) if self._costs else 0.0

        return MetricResult(
            self.name,
            trace.cost,
            {
                "cost": trace.cost,
                "success": trace.success,
                "avg_cost_so_far": avg_cost,
                "total_successful": self._successes,
            },
            trace.success and trace.cost <= 0.05,
        )


registry.register(CostPerSuccessfulTask())
