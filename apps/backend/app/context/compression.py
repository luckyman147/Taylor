"""Context Compression — summarizes tool results for the LLM.

Reduces token usage by compressing tool results before passing to the planner.
"""

import logging
from typing import Any

from app.llm import complete

logger = logging.getLogger(__name__)


class ContextCompressor:
    """Compresses tool results for efficient LLM consumption."""

    MAX_RESULT_LENGTH = 500  # Max characters per result before compression

    async def compress_tool_results(
        self,
        results: list[dict[str, Any]],
        query: str,
        max_tokens: int = 2000,
    ) -> str:
        """Compress multiple tool results into a concise summary.

        Returns a string summary that fits within the token budget.
        """
        if not results:
            return "No data collected."

        # Format results for compression
        raw = self._format_raw(results)

        # If already short enough, return as-is
        if len(raw) < self.MAX_RESULT_LENGTH * len(results):
            return raw

        # Use LLM to compress
        prompt = f"""Compress the following tool results into a concise summary.
Focus on key facts relevant to: {query}

Raw results:
{raw}

Provide a summary under {max_tokens} tokens. Keep:
- Key numbers, names, dates
- Actionable information
- Critical findings
Remove redundancy and filler."""

        try:
            response = await complete(prompt, temperature=0.2, max_tokens=max_tokens)
            return response.get("content", raw[:2000])
        except Exception as e:
            logger.warning("Compression failed: %s", e)
            return raw[:2000]

    async def compress_single_result(
        self,
        tool_name: str,
        result: Any,
        query: str,
    ) -> str:
        """Compress a single tool result."""
        if result is None:
            return f"{tool_name}: no result"

        result_str = str(result)
        if len(result_str) <= self.MAX_RESULT_LENGTH:
            return f"{tool_name}: {result_str}"

        prompt = f"""Compress this tool result into a concise summary.
Tool: {tool_name}
Relevant to: {query}

Result:
{result_str[:2000]}

Provide a summary under 200 tokens focusing on key information."""

        try:
            response = await complete(prompt, temperature=0.2, max_tokens=300)
            return f"{tool_name}: {response.get('content', result_str[:500])}"
        except Exception:
            return f"{tool_name}: {result_str[:500]}"

    def _format_raw(self, results: list[dict[str, Any]]) -> str:
        """Format results as raw text."""
        parts = []
        for r in results:
            tool = r.get("tool", "unknown")
            result = r.get("result")
            if isinstance(result, dict):
                lines = [f"{k}: {str(v)[:200]}" for k, v in result.items()]
                parts.append(f"[{tool}]\n" + "\n".join(lines))
            elif isinstance(result, list):
                parts.append(f"[{tool}] {len(result)} items")
            else:
                parts.append(f"[{tool}] {str(result)[:500]}")
        return "\n\n".join(parts)


context_compressor = ContextCompressor()
