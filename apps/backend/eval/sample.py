"""Eval data structures — samples, traces, results."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class EvalSample:
    """A single benchmark test case."""

    id: str
    query: str
    expected_capabilities: list[str] = field(default_factory=list)
    acceptable_tools: list[str] = field(default_factory=list)
    expected_recovery: str | None = None
    ground_truth: str | None = None
    required_evidence: list[str] = field(default_factory=list)
    category: str = "normal"  # normal | multi_tool | failure | ambiguous
    inject_failure: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvalSample:
        return cls(
            id=data.get("id", str(uuid.uuid4())[:8]),
            query=data["query"],
            expected_capabilities=data.get("expected_capabilities", []),
            acceptable_tools=data.get("acceptable_tools", []),
            expected_recovery=data.get("expected_recovery"),
            ground_truth=data.get("ground_truth"),
            required_evidence=data.get("required_evidence", []),
            category=data.get("category", "normal"),
            inject_failure=data.get("inject_failure"),
        )


@dataclass
class ToolCallRecord:
    """Record of a single tool call during an eval run."""

    tool_name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    success: bool = False
    result: Any = None
    error: str | None = None
    latency_ms: float = 0.0
    iteration: int = 0
    recovery_action: str | None = None


@dataclass
class TokenUsage:
    """Token accounting for a run."""

    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class EvalTrace:
    """Complete trace of a single eval run — the primary evaluation artifact."""

    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    sample_id: str = ""
    mode: str = "autonomous"  # "baseline" | "autonomous"
    query: str = ""
    iterations: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    selected_tools: list[str] = field(default_factory=list)
    ranked_tools: list[str] = field(default_factory=list)
    final_answer: str = ""
    success: bool = False
    tokens: TokenUsage = field(default_factory=TokenUsage)
    cost: float = 0.0
    latency_ms: float = 0.0
    recovery_events: list[dict[str, Any]] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize for JSON output."""
        return {
            "run_id": self.run_id,
            "sample_id": self.sample_id,
            "mode": self.mode,
            "query": self.query,
            "iterations": self.iterations,
            "tool_calls": [
                {
                    "tool_name": tc.tool_name,
                    "arguments": tc.arguments,
                    "success": tc.success,
                    "error": tc.error,
                    "latency_ms": tc.latency_ms,
                    "iteration": tc.iteration,
                    "recovery_action": tc.recovery_action,
                }
                for tc in self.tool_calls
            ],
            "selected_tools": self.selected_tools,
            "ranked_tools": self.ranked_tools,
            "final_answer": self.final_answer,
            "success": self.success,
            "tokens": {
                "input": self.tokens.input_tokens,
                "output": self.tokens.output_tokens,
                "cached": self.tokens.cached_tokens,
                "total": self.tokens.total_tokens,
            },
            "cost": self.cost,
            "latency_ms": self.latency_ms,
            "recovery_events": self.recovery_events,
            "config": self.config,
        }


@dataclass
class MetricResult:
    """Result of a single metric evaluation."""

    metric_name: str
    value: float
    details: dict[str, Any] | None = None
    passed: bool | None = None  # None = informational only

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "value": self.value,
            "details": self.details,
            "passed": self.passed,
        }


@dataclass
class EvalReport:
    """Aggregated results from an eval run."""

    mode: str
    config: EvalConfig | None = None  # imported from config.py
    traces: list[EvalTrace] = field(default_factory=list)
    metric_results: list[MetricResult] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)
