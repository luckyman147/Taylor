"""Deterministic MCP failure simulator for evaluation."""

from __future__ import annotations

import logging
from typing import Any

from eval.failures.scenarios import FAILURE_SCENARIOS, FailureScenario

logger = logging.getLogger(__name__)


class MockMCP:
    """Simulates MCP tool calls with deterministic failure patterns.

    On first call to a tool with a scenario: returns the configured error.
    If should_succeed_on_retry: second call succeeds.
    Otherwise: always fails.
    """

    def __init__(self, scenarios: list[FailureScenario] | None = None) -> None:
        self._scenarios = {s.tool_name: s for s in (scenarios or FAILURE_SCENARIOS)}
        self._call_count: dict[str, int] = {}
        self._results: dict[str, dict[str, Any]] = {}

    def set_result(self, tool_name: str, result: dict[str, Any]) -> None:
        """Pre-set a result for a tool (for success scenarios)."""
        self._results[tool_name] = result

    def has_scenario(self, tool_name: str) -> bool:
        return tool_name in self._scenarios

    async def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Simulate a tool call with configured failure patterns."""
        count = self._call_count.get(tool_name, 0)
        self._call_count[tool_name] = count + 1

        # If a custom result is set and we've passed the failure phase, use it
        if tool_name in self._results and count > 0:
            return self._results[tool_name]

        scenario = self._scenarios.get(tool_name)
        if not scenario:
            # No failure scenario — return success
            return {"success": True, "result": {"mock": True, "tool": tool_name}, "error": None, "latency_ms": 10.0}

        # First call: fail
        if count == 0:
            return {
                "success": False,
                "result": None,
                "error": f"{scenario.failure_type}: {scenario.error_message}",
                "latency_ms": 100.0,
            }

        # Second call: succeed if configured
        if scenario.should_succeed_on_retry and count == 1:
            return {
                "success": True,
                "result": {"mock": True, "tool": tool_name, "recovered": True},
                "error": None,
                "latency_ms": scenario.retry_delay_ms + 10.0,
            }

        # After that: keep failing
        return {
            "success": False,
            "result": None,
            "error": f"{scenario.failure_type}: {scenario.error_message}",
            "latency_ms": 100.0,
        }

    def get_call_count(self, tool_name: str) -> int:
        return self._call_count.get(tool_name, 0)

    def reset(self) -> None:
        self._call_count.clear()
        self._results.clear()
