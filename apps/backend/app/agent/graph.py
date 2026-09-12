"""Agent Graph — LangGraph StateGraph definition for the TAYLOR agent loop.

Defines the graph structure:
  START → analyze_request → plan → execute → (evaluate | recover)
                                          ↓         ↓
                                ┌─── success → generate_answer → END
                                ├─── insufficient → plan (loop)
                                └─── budget_exhausted → generate_answer → END

  recover → plan (on retry) | generate_answer (on give_up)
"""

import logging
from typing import Literal

from langgraph.graph import END, START, StateGraph

from app.agent.nodes import (
    analyze_request,
    evaluate,
    execute,
    generate_answer,
    plan,
    recover,
)
from app.agent.state import TaylorState

logger = logging.getLogger(__name__)


def _route_after_plan(state: TaylorState) -> Literal["execute", "done"]:
    """Route based on whether planner has actions or is done."""
    if state.get("sufficient_data"):
        return "done"
    return "execute"


def _route_after_execute(state: TaylorState) -> Literal["evaluate", "recover"]:
    """Route based on execution results."""
    consecutive_failures = state.get("consecutive_failures", 0)

    # Too many failures — go to evaluate to generate partial answer
    if consecutive_failures >= 3:
        return "evaluate"

    # Check if any step failed
    tool_calls = state.get("tool_calls", [])
    if tool_calls and not tool_calls[-1].success:
        return "recover"

    return "evaluate"


def _route_after_evaluate(state: TaylorState) -> Literal["success", "insufficient", "budget_exhausted"]:
    """Route based on evaluation verdict and budget."""
    verdict = state.get("_verdict", "insufficient")

    if verdict == "success":
        return "success"

    # Check budget constraints
    budget = state.get("budget", {})
    iteration = state.get("iteration", 0)
    max_iterations = budget.get("max_iterations", state.get("max_iterations", 3))
    consecutive_failures = state.get("consecutive_failures", 0)

    if iteration >= max_iterations:
        logger.info("Budget exhausted: max iterations (%d) reached", max_iterations)
        return "budget_exhausted"

    if consecutive_failures >= 3:
        logger.info("Budget exhausted: %d consecutive failures", consecutive_failures)
        return "budget_exhausted"

    return "insufficient"


def _route_after_recover(state: TaylorState) -> Literal["retry", "give_up"]:
    """Route based on recovery action."""
    action = state.get("_recovery_action", "skip")
    recovery_attempts = state.get("recovery_attempts", 0)

    # Max 3 recovery attempts
    if recovery_attempts >= 3:
        return "give_up"

    if action in ("retry", "re_plan"):
        return "retry"

    return "give_up"


def build_graph() -> StateGraph:
    """Build and return the TAYLOR agent StateGraph (not compiled)."""
    graph = StateGraph(TaylorState)

    # Add nodes
    graph.add_node("analyze_request", analyze_request)
    graph.add_node("plan", plan)
    graph.add_node("execute", execute)
    graph.add_node("evaluate", evaluate)
    graph.add_node("recover", recover)
    graph.add_node("generate_answer", generate_answer)

    # Edges
    graph.add_edge(START, "analyze_request")
    graph.add_edge("analyze_request", "plan")

    # Conditional edge from plan: actions → execute, no actions → generate_answer
    graph.add_conditional_edges(
        "plan",
        _route_after_plan,
        {
            "execute": "execute",
            "done": "generate_answer",
        },
    )

    # Conditional edge from execute: success → evaluate, failure → recover
    graph.add_conditional_edges(
        "execute",
        _route_after_execute,
        {
            "evaluate": "evaluate",
            "recover": "recover",
        },
    )

    # Conditional edges from evaluate
    graph.add_conditional_edges(
        "evaluate",
        _route_after_evaluate,
        {
            "success": "generate_answer",
            "insufficient": "plan",
            "budget_exhausted": "generate_answer",
        },
    )

    # Conditional edges from recover
    graph.add_conditional_edges(
        "recover",
        _route_after_recover,
        {
            "retry": "plan",
            "give_up": "generate_answer",
        },
    )

    # Final edge
    graph.add_edge("generate_answer", END)

    return graph


# Compiled graph singleton (created once, reused)
_compiled_graph = None


def get_compiled_graph():
    """Get the compiled TAYLOR agent graph."""
    global _compiled_graph
    if _compiled_graph is None:
        graph = build_graph()
        _compiled_graph = graph.compile()
    return _compiled_graph
