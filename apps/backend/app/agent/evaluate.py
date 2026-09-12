"""Agent Evaluator — assesses sufficiency of collected data.

Determines if the agent has enough information to answer the user's query,
or if more tool calls are needed.
"""

import asyncio
import logging
from typing import Any

from app.llm import complete_json
from app.agent.state import TaylorState

logger = logging.getLogger(__name__)


class AgentEvaluator:
    """Evaluates whether collected data is sufficient to answer."""

    async def evaluate_sufficiency(self, state: TaylorState) -> dict[str, Any]:
        """Evaluate if we have enough data to answer the query.

        Returns:
            {"sufficient": bool, "gaps": list[str], "confidence": float}
        """
        from app.agent.state import get_tool_results
        results = get_tool_results(state)
        if not results:
            return {
                "sufficient": False,
                "gaps": ["No data collected yet"],
                "confidence": 0.0,
            }

        # Deterministic heuristics — skip LLM call for known patterns
        deterministic = self._check_deterministic_sufficiency(state, results)
        if deterministic is not None:
            return deterministic

        # Build summary of what we have
        data_summary = self._summarize_data(results)
        query = state.get("query", "")

        prompt = f"""You are a data sufficiency evaluator. Assess whether the collected data
is enough to answer the user's query.

User query: {query}

Collected data:
{data_summary}

Respond with a JSON object:
{{
  "sufficient": true/false,
  "gaps": ["gap1", "gap2"],
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}}

Consider:
- Do we have all the key information needed?
- Are there critical missing pieces?
- Is the data quality sufficient (not just presence)?
- Could we give a partial answer if not fully sufficient?"""

        # Retry with backoff for rate limits
        for attempt in range(3):
            try:
                response = await complete_json(
                    prompt,
                    schema_type="sufficiency_check",
                    max_tokens=500,
                )
                return {
                    "sufficient": response.get("sufficient", False),
                    "gaps": response.get("gaps", []),
                    "confidence": response.get("confidence", 0.0),
                }
            except Exception as e:
                err_str = str(e).lower()
                is_rate_limit = "429" in err_str or "rate" in err_str or "quota" in err_str
                if is_rate_limit and attempt < 2:
                    wait = 10 * (attempt + 1)
                    logger.warning("Rate limited in evaluate, retrying in %ds", wait)
                    await asyncio.sleep(wait)
                    continue
                logger.error("Sufficiency evaluation failed: %s", e)
                return {
                    "sufficient": False,
                    "gaps": ["Evaluation failed"],
                    "confidence": 0.0,
                }

    async def should_retry_tool(self, state: TaylorState, failed_tool: str, error: str) -> bool:
        """Decide if a failed tool call should be retried or skipped."""
        # Skip after 2 consecutive failures
        if state.get("consecutive_failures", 0) >= 2:
            return False

        # Skip auth errors (won't succeed on retry)
        auth_errors = ["authentication", "permission", "unauthorized", "forbidden"]
        if any(e in error.lower() for e in auth_errors):
            return False

        # Skip invalid arguments (won't succeed on retry)
        if "invalid" in error.lower() and "argument" in error.lower():
            return False

        # Retry transient errors
        transient = ["timeout", "rate limit", "temporary", "connection", "500", "502", "503"]
        if any(e in error.lower() for e in transient):
            return True

        # Default: don't retry
        return False

    def _check_deterministic_sufficiency(
        self, state: TaylorState, results: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        """Check known patterns where data is trivially sufficient.

        Returns None if no deterministic answer can be given.
        """
        query = state.get("query", "").lower()
        tool_names = {r.get("tool") for r in results}

        # Single read tool with no gaps → sufficient
        read_tools = {"get_profile_summary", "get_applications", "get_skill_gap", "get_market_position"}
        if tool_names.issubset(read_tools) and len(results) >= 1:
            # All results are read-only — we have what we need
            return {
                "sufficient": True,
                "gaps": [],
                "confidence": 0.95,
            }

        # Query is purely informational and we have data
        info_patterns = ["what's my", "show me my", "tell me about my", "how's my"]
        if any(p in query for p in info_patterns) and len(results) >= 1:
            return {
                "sufficient": True,
                "gaps": [],
                "confidence": 0.9,
            }

        return None

    def _summarize_data(self, results: list[dict[str, Any]]) -> str:
        """Create a summary of collected data for the evaluator."""
        lines = []
        for r in results:
            tool = r.get("tool", "unknown")
            result = r.get("result")
            if isinstance(result, dict):
                # Show key-value pairs
                for k, v in list(result.items())[:3]:
                    lines.append(f"  {tool}.{k}: {str(v)[:100]}")
            elif isinstance(result, list):
                lines.append(f"  {tool}: {len(result)} items")
            else:
                lines.append(f"  {tool}: {str(result)[:150]}")
        return "\n".join(lines) if lines else "  (no data)"


agent_evaluator = AgentEvaluator()
