"""Failure injection for evaluation."""

from eval.failures.mock_mcp import MockMCP
from eval.failures.scenarios import FAILURE_SCENARIOS, FailureScenario, SCENARIO_MAP

__all__ = ["MockMCP", "FAILURE_SCENARIOS", "FailureScenario", "SCENARIO_MAP"]
