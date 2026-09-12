"""P0-6 + P0-7: RAGAS Faithfulness + Answer Relevance.

Uses real RAGAS behind an adapter. If RAGAS is not installed,
returns metric=0 with error details.
"""

from __future__ import annotations

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult

_RAGAS_AVAILABLE = False
try:
    from ragas import evaluate as ragas_evaluate
    from ragas.metrics import answer_relevancy, faithfulness
    from datasets import Dataset

    _RAGAS_AVAILABLE = True
except ImportError:
    pass


class RagasFaithfulness:
    """Is the answer supported by retrieved evidence?"""

    name = "faithfulness"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not _RAGAS_AVAILABLE:
            return MetricResult(
                self.name, 0.0,
                {"error": "ragas not installed. Install with: uv add --optional eval ragas"},
                False,
            )

        contexts = [
            f"[{tc.tool_name}] {str(tc.result)[:500]}"
            for tc in trace.tool_calls
            if tc.success and tc.result is not None
        ]
        if not contexts:
            return MetricResult(self.name, 0.0, {"reason": "no contexts to evaluate"}, False)

        try:
            data = {
                "question": [trace.query],
                "answer": [trace.final_answer],
                "contexts": [contexts],
                "ground_truth": [sample.ground_truth or trace.final_answer],
            }
            dataset = Dataset.from_dict(data)
            result = ragas_evaluate(dataset, metrics=[faithfulness])
            score = result["faithfulness"]
            return MetricResult(
                self.name, float(score),
                {"contexts_count": len(contexts)},
                float(score) >= 0.7,
            )
        except Exception as e:
            return MetricResult(self.name, 0.0, {"error": str(e)}, False)


class RagasAnswerRelevance:
    """Does the answer actually answer the user's question?"""

    name = "answer_relevance"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not _RAGAS_AVAILABLE:
            return MetricResult(
                self.name, 0.0,
                {"error": "ragas not installed. Install with: uv add --optional eval ragas"},
                False,
            )

        try:
            data = {
                "question": [trace.query],
                "answer": [trace.final_answer],
                "contexts": [[""]],
                "ground_truth": [sample.ground_truth or trace.final_answer],
            }
            dataset = Dataset.from_dict(data)
            result = ragas_evaluate(dataset, metrics=[answer_relevancy])
            score = result["answer_relevancy"]
            return MetricResult(
                self.name, float(score),
                {"answer_length": len(trace.final_answer)},
                float(score) >= 0.7,
            )
        except Exception as e:
            return MetricResult(self.name, 0.0, {"error": str(e)}, False)


registry.register(RagasFaithfulness())
registry.register(RagasAnswerRelevance())
