"""Agent State — LangGraph state schema for the autonomous agent loop.

Uses TypedDict for LangGraph compatibility. ToolCall remains a dataclass
for convenience. event_queue lives in a thread-safe registry (not the
TypedDict) because asyncio.Queue is not serializable by LangGraph.
"""

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, TypedDict

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Event emitter registry — supports both queue and direct callback modes
# ---------------------------------------------------------------------------

_event_emitters: dict[str, Callable[..., Coroutine]] = {}
_registry_lock = threading.Lock()


def register_event_emitter(run_id: str, emit_fn: Callable[..., Coroutine]) -> None:
    """Register a direct async emit callback for a given agent run."""
    with _registry_lock:
        _event_emitters[run_id] = emit_fn


def unregister_event_emitter(run_id: str) -> None:
    """Remove the event emitter for a completed agent run."""
    with _registry_lock:
        _event_emitters.pop(run_id, None)


@dataclass
class ToolCall:
    """A single tool call record."""
    tool_name: str
    arguments: dict[str, Any]
    result: Any = None
    success: bool = False
    error: str | None = None
    latency_ms: float = 0.0
    iteration: int = 0


class TaylorState(TypedDict, total=False):
    """LangGraph state for the TAYLOR agent loop.

    All fields are optional (total=False) so nodes can return partial updates.
    """
    # Input
    query: str
    mode: str
    skills: list[str]
    context: dict[str, Any]

    # Tool pipeline
    ranked_tools: list[dict[str, Any]]

    # Loop state
    iteration: int
    max_iterations: int
    tool_calls: list[ToolCall]
    total_tool_calls: int

    # Sufficiency tracking
    sufficient_data: bool
    data_gaps: list[str]

    # Budget tracking
    budget: dict[str, Any]
    total_tokens: int
    total_cost: float
    budget_elapsed_ms: float
    budget_remaining_ms: float

    # Workflow (LLM-generated structured execution plan)
    workflow_steps: list[dict[str, Any]]

    # Error tracking
    consecutive_failures: int
    recovery_attempts: int
    errors: list[str]

    # Output
    final_answer: str
    cards: list[dict[str, Any]]

    # Run ID — used to look up event_queue in the registry
    run_id: str


def create_initial_state(
    query: str,
    mode: str = "ask",
    skills: list[str] | None = None,
    context: dict[str, Any] | None = None,
    max_iterations: int | None = None,
    run_id: str | None = None,
) -> TaylorState:
    """Create initial state for a new agent run."""
    # Search mode gets 4 iterations (max ~12 LLM calls, within Gemini free tier 15/min)
    if max_iterations is None:
        max_iterations = 4 if mode == "search" else 3

    return TaylorState(
        query=query,
        mode=mode,
        skills=skills or [],
        context=context or {},
        ranked_tools=[],
        iteration=0,
        max_iterations=max_iterations,
        tool_calls=[],
        total_tool_calls=0,
        sufficient_data=False,
        data_gaps=[],
        budget={
            "max_iterations": max_iterations,
            "max_tool_calls": 12 if mode == "search" else 10,
            "max_time_ms": 60000 if mode == "search" else 30000,
            "max_cost_usd": 0.10 if mode == "search" else 0.05,
        },
        total_tokens=0,
        total_cost=0.0,
        budget_elapsed_ms=0.0,
        budget_remaining_ms=60000.0 if mode == "search" else 30000.0,
        workflow_steps=[],
        consecutive_failures=0,
        recovery_attempts=0,
        errors=[],
        final_answer="",
        cards=[],
        run_id=run_id or "",
    )


def get_tool_results(state: TaylorState) -> list[dict[str, Any]]:
    """Get all successful tool results from state."""
    return [
        {"tool": c.tool_name, "result": c.result}
        for c in state.get("tool_calls", [])
        if c.success and c.result is not None
    ]


def add_tool_call(state: TaylorState, call: ToolCall) -> TaylorState:
    """Add a tool call to state and update counters. Returns partial state update."""
    tool_calls = list(state.get("tool_calls", []))
    tool_calls.append(call)

    consecutive_failures = state.get("consecutive_failures", 0)
    errors = list(state.get("errors", []))

    if call.success:
        consecutive_failures = 0
    else:
        consecutive_failures += 1
        if call.error:
            errors.append(f"{call.tool_name}: {call.error}")

    return {
        "tool_calls": tool_calls,
        "total_tool_calls": state.get("total_tool_calls", 0) + 1,
        "consecutive_failures": consecutive_failures,
        "errors": errors,
    }


async def emit_event(state: TaylorState, event: Any) -> None:
    """Emit an AgentEvent via the registered callback (non-blocking, no-op if none)."""
    run_id = state.get("run_id", "")
    if not run_id:
        return
    emit_fn = _event_emitters.get(run_id)
    if emit_fn is not None:
        try:
            await emit_fn(event)
        except Exception as e:
            logger.warning("emit_event failed: %s", e)
        # Yield control so the SSE generator can drain the queue
        await asyncio.sleep(0)
