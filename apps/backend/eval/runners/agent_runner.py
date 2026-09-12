"""Agent runner — uses the autonomous agent loop for evaluation."""

from __future__ import annotations

import logging
import time
from typing import Any

from eval.config import EvalConfig
from eval.sample import EvalSample, EvalTrace, ToolCallRecord, TokenUsage

logger = logging.getLogger(__name__)


class AgentRunner:
    """Runs a sample through the agent loop with full tracing."""

    async def run(self, sample: EvalSample, config: EvalConfig) -> EvalTrace:
        start = time.monotonic()
        trace = EvalTrace(
            sample_id=sample.id,
            mode="autonomous",
            query=sample.query,
            config=config.to_dict(),
        )

        try:
            from app.agent.runner import agent_runner
            from app.agent.budget import BudgetConfig
            from app.tools.retrieval import tool_retriever
            from app.tools.ranking import tool_ranker

            # 1. Capture tool retrieval + ranking
            candidates = await tool_retriever.retrieve(sample.query, top_k=12)
            ranked = await tool_ranker.rank(candidates, sample.query, top_k=8)

            trace.selected_tools = [c.get("name", "") for c in candidates]
            trace.ranked_tools = [r.get("name", "") for r in ranked]

            # 2. Run the agent loop
            result = await agent_runner.run(
                query=sample.query,
                mode="ask",
                context={"eval": True, "sample_id": sample.id},
                budget_config=BudgetConfig(
                    max_iterations=config.max_iterations,
                    max_tool_calls=config.max_tool_calls,
                    max_execution_time_ms=config.max_execution_time_ms,
                    max_cost_usd=config.max_cost_usd,
                ),
            )

            # 3. Extract trace data
            trace.final_answer = result.get("answer", "")
            trace.success = bool(trace.final_answer and len(trace.final_answer) > 10)

            for tc_data in result.get("tool_calls", []):
                trace.tool_calls.append(ToolCallRecord(
                    tool_name=tc_data.get("tool", ""),
                    success=tc_data.get("success", False),
                    latency_ms=tc_data.get("latency_ms", 0),
                    iteration=tc_data.get("iteration", 0),
                ))

            trace.iterations = [{"iteration": result.get("iterations", 0)}]

            budget_data = result.get("budget", {})
            trace.tokens = TokenUsage()

        except Exception as e:
            logger.error("Agent runner failed: %s", e)
            trace.final_answer = f"Error: {e}"
            trace.success = False

        trace.latency_ms = (time.monotonic() - start) * 1000
        return trace


agent_runner_eval = AgentRunner()
