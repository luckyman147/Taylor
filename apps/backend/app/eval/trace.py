"""Agent Trace — structured record of an agent execution."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AgentTrace(BaseModel):
    """Complete trace of an agent execution for evaluation."""

    trace_id: str
    query: str
    mode: str
    skills: list[str] = Field(default_factory=list)

    # Workflow
    workflow_steps: list[dict[str, Any]] = Field(default_factory=list)

    # Execution
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    iterations: int = 0
    recovery_attempts: int = 0

    # Performance
    total_time_ms: float = 0.0
    total_tokens: int = 0
    total_cost_usd: float = 0.0

    # Outcome
    success: bool = False
    final_answer_length: int = 0

    # Events timeline
    events: list[dict[str, Any]] = Field(default_factory=list)

    @classmethod
    def from_agent_result(
        cls,
        trace_id: str,
        query: str,
        mode: str,
        skills: list[str],
        result: dict[str, Any],
        events: list[dict[str, Any]] | None = None,
    ) -> "AgentTrace":
        """Create a trace from agent_runner.run() result."""
        tool_calls = result.get("tool_calls", [])
        budget = result.get("budget", {})

        return cls(
            trace_id=trace_id,
            query=query,
            mode=mode,
            skills=skills,
            tool_calls=tool_calls,
            iterations=result.get("iterations", 0),
            total_time_ms=budget.get("time_ms", 0.0),
            success=bool(result.get("answer")),
            final_answer_length=len(result.get("answer", "")),
            events=events or [],
        )
