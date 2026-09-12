"""Agent Event schemas — SSE event types streamed during chat turns.

Events are safe to display to users (no private chain-of-thought).
The frontend renders these as a Claude-style execution timeline.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Union

from pydantic import BaseModel, Field


class AgentStatus(str, Enum):
    """High-level agent states shown in the timeline."""

    THINKING = "thinking"
    PLANNING = "planning"
    DISCOVERING_TOOLS = "discovering_tools"
    GENERATING_WORKFLOW = "generating_workflow"
    EXECUTING = "executing"
    TOOL_RUNNING = "tool_running"
    TOOL_COMPLETED = "tool_completed"
    EVALUATING = "evaluating"
    RECOVERING = "recovering"
    RETRIEVING_CONTEXT = "retrieving_context"
    GENERATING_ANSWER = "generating_answer"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


class ToolExecStatus(str, Enum):
    """Tool execution sub-states."""

    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CACHED = "cached"
    SKIPPED = "skipped"


# ── Individual event models ──────────────────────────────────────────────


class AgentStatusEvent(BaseModel):
    """A high-level status transition (thinking, planning, etc.)."""

    type: Literal["agent_status"] = "agent_status"
    status: AgentStatus
    message: str = ""


class ToolExecutionEvent(BaseModel):
    """Tool started, succeeded, or failed."""

    type: Literal["tool_execution"] = "tool_execution"
    tool: str
    status: ToolExecStatus
    duration_ms: int | None = None
    message: str | None = None
    iteration: int | None = None


class RecoveryEvent(BaseModel):
    """Agent is recovering from a failure."""

    type: Literal["recovery"] = "recovery"
    attempt: int
    message: str = ""


class TurnCompleteEvent(BaseModel):
    """The final turn response — signals end of stream."""

    type: Literal["turn_complete"] = "turn_complete"
    data: dict[str, Any] = Field(default_factory=dict)


class WorkflowEvent(BaseModel):
    """Workflow generation/execution status."""

    type: Literal["workflow"] = "workflow"
    status: str  # generating | executing | completed
    step_count: int = 0
    message: str = ""


class StepEvent(BaseModel):
    """Individual workflow step started/completed."""

    type: Literal["step"] = "step"
    step_id: str
    tool: str
    status: str  # running | success | failed | skipped | timeout
    duration_ms: int | None = None
    error: str | None = None


# ── Discriminated union ──────────────────────────────────────────────────

AgentEvent = Union[
    AgentStatusEvent,
    ToolExecutionEvent,
    RecoveryEvent,
    TurnCompleteEvent,
    WorkflowEvent,
    StepEvent,
]


def serialize_event(event: AgentEvent) -> str:
    """Serialize an agent event to JSON string for SSE."""
    import json

    if isinstance(event, TurnCompleteEvent):
        return json.dumps({"type": event.type, "data": event.data}, default=str)
    return event.model_dump_json()
