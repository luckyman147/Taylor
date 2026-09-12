"""P0-8: Groundedness / Hallucination Rate.

Uses LLM-as-judge to count unsupported factual claims.
"""

from __future__ import annotations

from eval.metrics.base import registry
from eval.sample import EvalSample, EvalTrace, MetricResult


class GroundednessRate:
    """What fraction of factual claims in the answer are supported by evidence?"""

    name = "groundedness_rate"

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult:
        if not trace.final_answer:
            return MetricResult(self.name, 1.0, {"note": "empty answer, nothing to hallucinate"}, True)

        evidence = []
        for tc in trace.tool_calls:
            if tc.success and tc.result is not None:
                evidence.append(f"[{tc.tool_name}] {str(tc.result)[:300]}")

        if not evidence:
            return MetricResult(
                self.name, 0.5,
                {"note": "no tool evidence — cannot assess groundedness"},
                None,
            )

        try:
            from app.llm import complete_json

            prompt = f"""Analyze this answer for factual claims. Count how many are supported by the evidence.

Answer:
{trace.final_answer[:2000]}

Evidence:
{chr(10).join(evidence[:10])}

Count the total factual claims and unsupported claims.
Return JSON: {{"total_claims": int, "unsupported_claims": int, "examples": [str]}}"""

            result = await complete_json(
                prompt,
                schema_type="enrichment",
                temperature=0.0,
                max_tokens=500,
            )

            total = max(result.get("total_claims", 1), 1)
            unsupported = result.get("unsupported_claims", 0)
            groundedness = 1.0 - (unsupported / total)

            return MetricResult(
                self.name,
                groundedness,
                {"total_claims": total, "unsupported_claims": unsupported, "examples": result.get("examples", [])},
                groundedness >= 0.9,
            )
        except Exception as e:
            return MetricResult(self.name, 0.5, {"error": str(e)}, None)


registry.register(GroundednessRate())
