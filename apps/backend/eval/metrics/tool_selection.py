"""P0-3: Tool Selection Accuracy."""

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class ToolSelectionAccuracy:
    """Did the agent call a correct tool?"""

    name = "tool_selection_accuracy"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not sample.acceptable_tools:
            return MetricResult(self.name, 1.0, {"note": "no acceptable tools defined"}, True)

        called = [tc.tool_name for tc in trace.tool_calls]
        if not called:
            return MetricResult(self.name, 0.0, {"reason": "no tools called"}, False)

        hits = [t for t in called if t in sample.acceptable_tools]
        accuracy = len(hits) / len(called)

        return MetricResult(
            self.name,
            accuracy,
            {"called_tools": called, "acceptable": sample.acceptable_tools, "hits": hits},
            accuracy >= 0.5,
        )


registry.register(ToolSelectionAccuracy())
