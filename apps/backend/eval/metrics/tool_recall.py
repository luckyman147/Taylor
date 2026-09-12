"""P0-2: Tool Recall@K, MRR, NDCG."""

from __future__ import annotations

import math

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class ToolRecallAtK:
    """Was at least one correct tool in the top-K ranked list?"""

    name = "tool_recall_at_5"

    def __init__(self, k: int = 5) -> None:
        self.k = k
        self.name = f"tool_recall_at_{k}"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not sample.acceptable_tools:
            return MetricResult(self.name, 1.0, {"note": "no acceptable tools defined"}, True)

        ranked = trace.ranked_tools[:self.k]
        hits = [t for t in ranked if t in sample.acceptable_tools]
        recall = 1.0 if hits else 0.0

        return MetricResult(
            self.name,
            recall,
            {"ranked_top_k": ranked, "acceptable": sample.acceptable_tools, "hits": hits},
            recall >= 1.0,
        )


class MeanReciprocalRank:
    """What's the rank of the first correct tool?"""

    name = "mrr"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not sample.acceptable_tools:
            return MetricResult(self.name, 1.0, {"note": "no acceptable tools defined"}, True)

        for rank, tool in enumerate(trace.ranked_tools, 1):
            if tool in sample.acceptable_tools:
                mrr = 1.0 / rank
                return MetricResult(
                    self.name, mrr,
                    {"first_hit_rank": rank, "tool": tool},
                    mrr >= 0.5,
                )

        return MetricResult(self.name, 0.0, {"reason": "no acceptable tool found in ranked list"}, False)


class NDCGAtK:
    """Normalized Discounted Cumulative Gain for ranked tool list.

    Useful when multiple tools are acceptable.
    """

    name = "ndcg_at_5"

    def __init__(self, k: int = 5) -> None:
        self.k = k
        self.name = f"ndcg_at_{k}"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not sample.acceptable_tools:
            return MetricResult(self.name, 1.0, {"note": "no acceptable tools defined"}, True)

        ranked = trace.ranked_tools[:self.k]
        # Relevance: 1.0 if tool is acceptable, 0.0 otherwise
        relevance = [1.0 if t in sample.acceptable_tools else 0.0 for t in ranked]

        # DCG
        dcg = sum(rel / math.log2(i + 2) for i, rel in enumerate(relevance))

        # Ideal DCG (all acceptable tools first)
        ideal_relevance = sorted(relevance, reverse=True)
        idcg = sum(rel / math.log2(i + 2) for i, rel in enumerate(ideal_relevance))

        ndcg = dcg / idcg if idcg > 0 else 0.0

        return MetricResult(
            self.name, ndcg,
            {"dcg": dcg, "idcg": idcg, "ranked": ranked},
            ndcg >= 0.7,
        )


registry.register(ToolRecallAtK(5))
registry.register(ToolRecallAtK(10))
registry.register(MeanReciprocalRank())
registry.register(NDCGAtK(5))
