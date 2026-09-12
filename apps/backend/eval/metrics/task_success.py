"""P0-1: Task Success Rate."""

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class TaskSuccessRate:
    """Did the agent complete the task successfully?"""

    name = "task_success_rate"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not trace.success:
            return MetricResult(self.name, 0.0, {"reason": "agent reported failure"}, False)

        if not trace.final_answer or len(trace.final_answer.strip()) < 10:
            return MetricResult(self.name, 0.0, {"reason": "answer too short or empty"}, False)

        if sample.required_evidence:
            answer_lower = trace.final_answer.lower()
            present = [e for e in sample.required_evidence if e.lower() in answer_lower]
            missing = [e for e in sample.required_evidence if e.lower() not in answer_lower]
            if missing:
                return MetricResult(
                    self.name, 0.5,
                    {"present": present, "missing": missing},
                    False,
                )

        return MetricResult(self.name, 1.0, {"answer_length": len(trace.final_answer)}, True)


registry.register(TaskSuccessRate())
