"""Workflow Generator — LLM generates structured workflows from user queries."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.llm import complete_json
from app.sandbox.models import Workflow, WorkflowBudget, WorkflowStep

logger = logging.getLogger(__name__)


class WorkflowGenerator:
    """Generates structured workflows from user queries using the LLM."""

    async def generate(
        self,
        query: str,
        available_tools: list[dict[str, Any]],
        context: dict[str, Any],
        mode: str,
        skills: list[str] | None = None,
    ) -> Workflow:
        """Generate a structured workflow for the user query.

        Args:
            query: The user's request.
            available_tools: Ranked tools from the retriever/ranker.
            context: Conversation context (history, memories, etc.).
            mode: Current chat mode.
            skills: Active skill IDs.

        Returns:
            Workflow with ordered steps.
        """
        tool_descriptions = self._format_tools(available_tools)

        prompt = f"""Given the user query and available tools, generate a structured workflow.

User query: {query}
Mode: {mode}
Active skills: {', '.join(skills) if skills else 'none'}

Available tools:
{tool_descriptions}

Respond with a JSON object:
{{
  "steps": [
    {{
      "tool_name": "exact_tool_name_from_catalog",
      "arguments": {{"arg": "value"}},
      "depends_on": [],
      "timeout_ms": 15000
    }}
  ]
}}

RULES:
- Use EXACT tool names from the catalog — never invent names.
- Steps with no dependencies can run in parallel.
- Only include steps actually needed to answer the query.
- Write tools (create_*, update_*) should depend on relevant read steps.
- Maximum 10 steps.
- Set timeout_ms based on expected complexity (simple reads: 5000, complex analysis: 15000, web searches: 20000).
- If no tools are needed, return {{"steps": []}}."""

        # Retry with backoff for rate limits (Gemini free tier: 15 req/min)
        for attempt in range(3):
            try:
                response = await complete_json(
                    prompt,
                    schema_type="workflow",
                    max_tokens=1500,
                )
                return self._parse_workflow(response, query)
            except Exception as e:
                err_str = str(e).lower()
                is_rate_limit = "429" in err_str or "rate" in err_str or "quota" in err_str
                if is_rate_limit and attempt < 2:
                    wait = 10 * (attempt + 1)  # 10s, 20s
                    logger.warning("Rate limited, retrying in %ds (attempt %d/3)", wait, attempt + 1)
                    await asyncio.sleep(wait)
                    continue
                logger.error("Workflow generation failed: %s", e)
                return Workflow(
                    workflow_id=f"wf_{uuid.uuid4().hex[:8]}",
                    query=query,
                    steps=[],
                )

    # Tools that require a 'query' parameter — inject user query if missing
    _QUERY_TOOLS = {"search_mcp_jobs", "web_search"}

    def _parse_workflow(self, response: dict[str, Any], query: str) -> Workflow:
        """Parse LLM response into a Workflow object."""
        steps = []
        for i, step_data in enumerate(response.get("steps", [])):
            tool_name = step_data.get("tool_name", "")
            if not tool_name:
                continue

            arguments = step_data.get("arguments", {})
            # Inject user query if tool requires it but LLM didn't provide it
            if tool_name in self._QUERY_TOOLS and "query" not in arguments:
                arguments["query"] = query

            steps.append(WorkflowStep(
                step_id=f"step_{i + 1}",
                tool_name=tool_name,
                arguments=arguments,
                depends_on=step_data.get("depends_on", []),
                timeout_ms=step_data.get("timeout_ms", 15000),
            ))

        return Workflow(
            workflow_id=f"wf_{uuid.uuid4().hex[:8]}",
            query=query,
            steps=steps,
            budget=WorkflowBudget(),
        )

    def _format_tools(self, tools: list[dict[str, Any]]) -> str:
        """Format tool list for the workflow generation prompt."""
        lines = []
        for tool in tools:
            name = tool.get("name", "unknown")
            desc = tool.get("description", "No description")
            source = tool.get("source", "builtin")
            params = tool.get("params", {})
            param_names = list(params.keys())
            param_str = f" (params: {', '.join(param_names)})" if param_names else ""
            lines.append(f"- {name} ({source}){param_str}: {desc}")
        return "\n".join(lines)


workflow_generator = WorkflowGenerator()
