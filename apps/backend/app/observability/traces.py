"""Observability Traces — tracks per-run execution details.

Records each agent loop iteration, tool call, and decision point
for debugging and optimization.
"""

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


class TraceSpan:
    """A single trace span (tool call, LLM call, etc.)."""

    def __init__(self, name: str, parent: "TraceSpan | None" = None) -> None:
        self.name = name
        self.parent = parent
        self.start_time = time.monotonic()
        self.end_time: float | None = None
        self.attributes: dict[str, Any] = {}
        self.events: list[dict[str, Any]] = []

    def set_attribute(self, key: str, value: Any) -> None:
        """Set a span attribute."""
        self.attributes[key] = value

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        """Add an event to the span."""
        self.events.append({
            "name": name,
            "time_ms": (time.monotonic() - self.start_time) * 1000,
            "attributes": attributes or {},
        })

    def finish(self) -> None:
        """Finish the span."""
        self.end_time = time.monotonic()

    @property
    def duration_ms(self) -> float:
        """Get span duration in milliseconds."""
        if self.end_time is None:
            return (time.monotonic() - self.start_time) * 1000
        return (self.end_time - self.start_time) * 1000

    def to_dict(self) -> dict[str, Any]:
        """Serialize the span."""
        return {
            "name": self.name,
            "duration_ms": self.duration_ms,
            "attributes": self.attributes,
            "events": self.events,
        }


class AgentTrace:
    """Complete trace for a single agent execution."""

    def __init__(self, query: str) -> None:
        self.query = query
        self.start_time = time.monotonic()
        self.spans: list[TraceSpan] = []
        self.attributes: dict[str, Any] = {}
        self._current_span: TraceSpan | None = None

    def start_span(self, name: str) -> TraceSpan:
        """Start a new trace span."""
        span = TraceSpan(name, parent=self._current_span)
        self.spans.append(span)
        self._current_span = span
        return span

    def finish_span(self) -> None:
        """Finish the current span."""
        if self._current_span:
            self._current_span.finish()
            self._current_span = self._current_span.parent

    def set_attribute(self, key: str, value: Any) -> None:
        """Set a trace-level attribute."""
        self.attributes[key] = value

    @property
    def duration_ms(self) -> float:
        """Get total trace duration."""
        return (time.monotonic() - self.start_time) * 1000

    def to_dict(self) -> dict[str, Any]:
        """Serialize the trace."""
        return {
            "query": self.query,
            "duration_ms": self.duration_ms,
            "attributes": self.attributes,
            "spans": [s.to_dict() for s in self.spans],
        }

    def log_summary(self) -> None:
        """Log a summary of the trace."""
        logger.info(
            "Trace: query=%s duration=%.0fms spans=%d attributes=%s",
            self.query[:50], self.duration_ms, len(self.spans), self.attributes,
        )


# Global trace storage (per-request, cleared after each request)
_current_trace: AgentTrace | None = None


def start_trace(query: str) -> AgentTrace:
    """Start a new agent trace."""
    global _current_trace
    _current_trace = AgentTrace(query)
    return _current_trace


def get_trace() -> AgentTrace | None:
    """Get the current trace."""
    return _current_trace


def finish_trace() -> AgentTrace | None:
    """Finish and return the current trace."""
    global _current_trace
    if _current_trace:
        _current_trace.log_summary()
        trace = _current_trace
        _current_trace = None
        return trace
    return None
