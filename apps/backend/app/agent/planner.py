"""Agent Planner — decides what tools to call next.

Uses the LLM to reason about the user query, available tools, and
collected data so far, then decides which tools to call.
"""

import asyncio
import logging
from typing import Any

from app.llm import complete_json
from app.agent.state import TaylorState
from app.tools.registry import tool_registry

logger = logging.getLogger(__name__)


class AgentPlanner:
    """Plans which tools to call based on query and available context."""

    def __init__(self) -> None:
        self._previous_plan_signatures: list[str] = []

    async def plan_next_actions(
        self,
        state: TaylorState,
        available_tools: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Plan the next set of tool calls.

        Returns list of {"tool_name": str, "arguments": dict} dicts.
        Empty list means we're done (final answer time).
        """
        if not available_tools:
            return []

        # Build tool descriptions for the planner
        tool_descriptions = self._format_tools(available_tools)

        # Build context from previous results
        from app.agent.state import get_tool_results
        previous_results = get_tool_results(state)
        results_summary = self._format_results(previous_results) if previous_results else "None yet."

        query = state.get("query", "")
        data_gaps = state.get("data_gaps", [])

        prompt = f"""You are a tool-selection planner. Given the user's query and available tools,
decide which tools to call next (if any).

User query: {query}

Available tools:
{tool_descriptions}

Previously collected data:
{results_summary}

Data gaps to fill: {', '.join(data_gaps) if data_gaps else 'None identified'}

Respond with a JSON object:
{{
  "thought": "Brief reasoning about what to do next",
  "actions": [
    {{"tool_name": "tool_name", "arguments": {{"arg": "value"}}}}
  ],
  "sufficient": false
}}

If you have enough data to answer the user's query, set "sufficient": true and "actions": [].
Only call tools that are actually needed. Prefer fewer, more targeted calls."""

        # Retry with backoff for rate limits
        for attempt in range(3):
            try:
                response = await complete_json(
                    prompt,
                    schema_type="agent_plan",
                    max_tokens=1000,
                )
                actions = response.get("actions", [])
                sufficient = response.get("sufficient", False)

                # Filter to only valid tools
                valid_actions = []
                for action in actions:
                    tool_name = action.get("tool_name", "")
                    if self._is_valid_tool(tool_name, available_tools):
                        valid_actions.append(action)
                    else:
                        logger.warning("Planner suggested invalid tool: %s", tool_name)

                # Plan signature dedup — detect stuck loops
                signature = self._plan_signature(valid_actions)
                if signature in self._previous_plan_signatures:
                    logger.warning("Planner repeating same plan — breaking loop")
                    return []
                if valid_actions:
                    self._previous_plan_signatures.append(signature)

                return valid_actions

            except Exception as e:
                err_str = str(e).lower()
                is_rate_limit = "429" in err_str or "rate" in err_str or "quota" in err_str
                if is_rate_limit and attempt < 2:
                    wait = 10 * (attempt + 1)
                    logger.warning("Rate limited in planner, retrying in %ds", wait)
                    await asyncio.sleep(wait)
                    continue
                logger.error("Planner failed: %s", e)
                return []

    def _format_tools(self, tools: list[dict[str, Any]]) -> str:
        """Format tool list for the planner prompt."""
        lines = []
        for tool in tools:
            name = tool.get("name", "unknown")
            desc = tool.get("description", "No description")
            source = tool.get("source", "builtin")
            lines.append(f"- {name} ({source}): {desc}")
        return "\n".join(lines)

    def _plan_signature(self, actions: list[dict[str, Any]]) -> str:
        """Generate a signature for the plan (tool names + args hash)."""
        parts = []
        for a in actions:
            name = a.get("tool_name", "")
            args = a.get("arguments", {})
            args_str = str(sorted(args.items()))
            parts.append(f"{name}:{args_str}")
        return "|".join(parts) if parts else "empty"

    def reset_signatures(self) -> None:
        """Clear plan signature history (call at start of new turn)."""
        self._previous_plan_signatures.clear()

    def _format_results(self, results: list[dict[str, Any]]) -> str:
        """Format previous results for the planner prompt."""
        lines = []
        for r in results:
            tool = r.get("tool", "unknown")
            result = r.get("result")
            if isinstance(result, dict):
                # Summarize dict results
                keys = list(result.keys())[:5]
                lines.append(f"- {tool}: {{...}} (keys: {', '.join(keys)})")
            elif isinstance(result, list):
                lines.append(f"- {tool}: [{len(result)} items]")
            else:
                lines.append(f"- {tool}: {str(result)[:100]}")
        return "\n".join(lines)

    def _is_valid_tool(self, tool_name: str, available_tools: list[dict[str, Any]]) -> bool:
        """Check if a tool name is in the available tools list."""
        available_names = {t.get("name", "") for t in available_tools}
        return tool_name in available_names


agent_planner = AgentPlanner()
