"""Failure scenarios for deterministic evaluation."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FailureScenario:
    """A deterministic failure that can be injected into a tool call."""

    failure_type: str
    tool_name: str
    error_message: str
    expected_recovery: str
    should_succeed_on_retry: bool
    retry_delay_ms: int = 0


FAILURE_SCENARIOS: list[FailureScenario] = [
    FailureScenario("TIMEOUT", "builtin.search_jobs", "Connection timeout after 15000ms", "RETRY", True, 1000),
    FailureScenario("500", "mcp_apify.jobs", "Internal Server Error", "RETRY", True, 1000),
    FailureScenario("401", "mcp_linkedin.profile", "Unauthorized: invalid token", "ASK_USER", False, 0),
    FailureScenario("403", "mcp_custom.write", "Forbidden: insufficient permissions", "ASK_USER", False, 0),
    FailureScenario("429", "mcp_brave.search", "Rate Limited: try again in 5s", "RETRY", True, 5000),
    FailureScenario("INVALID_ARGUMENT", "builtin.search_jobs", "Missing required parameter: query", "REPLAN", False, 0),
    FailureScenario("EMPTY_RESULT", "builtin.search_jobs", "No results found", "REPLAN", False, 0),
    FailureScenario("UNSUPPORTED", "mcp_unknown.method", "Not implemented", "SKIP", False, 0),
    FailureScenario("SERVER_UNAVAILABLE", "mcp_custom.health", "Service unavailable", "RETRY", True, 2000),
    FailureScenario("MALFORMED_RESPONSE", "mcp_exa.search", "Invalid JSON in response body", "SKIP", False, 0),
]

SCENARIO_MAP: dict[str, FailureScenario] = {s.failure_type: s for s in FAILURE_SCENARIOS}
