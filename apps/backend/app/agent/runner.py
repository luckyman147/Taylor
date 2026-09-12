"""Agent Runner — the bounded autonomous tool-use loop.

Uses LangGraph StateGraph for orchestration:
  analyze_request → plan → execute → evaluate → (loop or answer)

Max 3 iterations. LLM sees compressed tool results, not raw data.
"""

import asyncio
import logging
import uuid
from typing import Any, Callable, Coroutine

from app.agent.budget import BudgetConfig, ExecutionBudget
from app.agent.graph import get_compiled_graph
from app.agent.state import (
    TaylorState,
    create_initial_state,
    register_event_emitter,
    unregister_event_emitter,
)
from app.schemas.agent_events import AgentEvent, TurnCompleteEvent, serialize_event

logger = logging.getLogger(__name__)


class AgentRunner:
    """Runs the bounded autonomous agent loop via LangGraph."""

    async def run(
        self,
        query: str,
        mode: str = "ask",
        skills: list[str] | None = None,
        context: dict[str, Any] | None = None,
        budget_config: BudgetConfig | None = None,
        emit_fn: Callable[..., Coroutine] | None = None,
    ) -> dict[str, Any]:
        """Execute the agent loop for a user query.

        If emit_fn is provided, status events are forwarded directly to it.
        """
        # Step 1: Build initial state
        budget = ExecutionBudget(budget_config)
        budget.start()

        run_id = str(uuid.uuid4())
        if emit_fn is not None:
            register_event_emitter(run_id, emit_fn)

        # Let create_initial_state use mode-based defaults if no explicit budget
        max_iterations = budget_config.max_iterations if budget_config else None
        initial_state = create_initial_state(
            query=query,
            mode=mode,
            skills=skills,
            context=context,
            max_iterations=max_iterations,
            run_id=run_id,
        )

        # Step 3: Invoke the compiled graph
        try:
            graph = get_compiled_graph()
            result = await graph.ainvoke(initial_state)
        except Exception as e:
            logger.error("Agent graph failed: %s", e)
            return {
                "answer": "I encountered an error while processing your request. Please try again.",
                "tool_calls": [],
                "iterations": 0,
                "budget": {
                    "tool_calls": 0,
                    "time_ms": budget.elapsed_ms(),
                    "remaining_time_ms": budget.remaining_time_ms(),
                },
            }
        finally:
            unregister_event_emitter(run_id)

        # Step 4: Format output (preserve exact contract for chat_engine.py)
        tool_calls = result.get("tool_calls", [])
        return {
            "answer": result.get("final_answer", ""),
            "cards": result.get("cards", []),
            "tool_calls": [
                {
                    "tool": c.tool_name,
                    "success": c.success,
                    "latency_ms": c.latency_ms,
                    "iteration": c.iteration,
                }
                for c in tool_calls
            ],
            "iterations": result.get("iteration", 0),
            "budget": {
                "tool_calls": result.get("total_tool_calls", 0),
                "time_ms": budget.elapsed_ms(),
                "remaining_time_ms": budget.remaining_time_ms(),
            },
        }



agent_runner = AgentRunner()
