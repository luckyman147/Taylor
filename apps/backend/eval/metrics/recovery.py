"""P0-4 + P0-5: Recovery Success Rate + Recovery Policy Accuracy."""

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class RecoverySuccessRate:
    """When recovery was attempted, did it succeed?"""

    name = "recovery_success_rate"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        events = [e for e in trace.recovery_events if e.get("action") not in (None, "skip")]
        if not events:
            return MetricResult(self.name, 1.0, {"note": "no recovery attempted"}, True)

        successes = sum(1 for e in events if e.get("succeeded", False))
        rate = successes / len(events)

        return MetricResult(
            self.name,
            rate,
            {"total_events": len(events), "successes": successes, "events": events},
            rate >= 0.5,
        )


class RecoveryPolicyAccuracy:
    """Did TAYLOR choose the correct recovery strategy?"""

    name = "recovery_policy_accuracy"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not sample.expected_recovery:
            return MetricResult(self.name, 1.0, {"note": "no expected recovery defined"}, True)

        events = [e for e in trace.recovery_events if e.get("failure_type")]
        if not events:
            return MetricResult(self.name, 0.0, {"reason": "no recovery attempted"}, False)

        correct = sum(
            1 for e in events
            if e.get("recovery_action") == sample.expected_recovery
        )
        accuracy = correct / len(events)

        return MetricResult(
            self.name,
            accuracy,
            {
                "expected": sample.expected_recovery,
                "total_events": len(events),
                "correct": correct,
                "events": events,
            },
            accuracy >= 0.5,
        )


registry.register(RecoverySuccessRate())
registry.register(RecoveryPolicyAccuracy())
