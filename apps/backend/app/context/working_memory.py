"""Working Memory — manages context for the agent loop.

Stores tool results, conversation history, and extracted entities
for the current agent execution.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class WorkingMemory:
    """Manages working memory for a single agent execution."""

    def __init__(self) -> None:
        self._tool_results: list[dict[str, Any]] = []
        self._entities: dict[str, Any] = {}
        self._compressed_summaries: list[str] = []

    def add_tool_result(self, tool_name: str, result: Any, success: bool = True) -> None:
        """Add a tool result to working memory."""
        self._tool_results.append({
            "tool": tool_name,
            "result": result,
            "success": success,
        })

    def get_all_results(self) -> list[dict[str, Any]]:
        """Get all tool results."""
        return self._tool_results.copy()

    def get_successful_results(self) -> list[dict[str, Any]]:
        """Get only successful tool results."""
        return [r for r in self._tool_results if r["success"]]

    def set_entity(self, key: str, value: Any) -> None:
        """Store an extracted entity (e.g. resume_id, job_id)."""
        self._entities[key] = value

    def get_entity(self, key: str) -> Any:
        """Get an extracted entity."""
        return self._entities.get(key)

    def add_compressed_summary(self, summary: str) -> None:
        """Add a compressed summary of tool results."""
        self._compressed_summaries.append(summary)

    def get_context_window(self, max_tokens: int = 20000) -> str:
        """Build a context window fitting within the token budget.

        Prioritizes: compressed summaries > recent results > entities.
        """
        parts = []

        # Compressed summaries first (most important)
        for s in self._compressed_summaries:
            parts.append(s)

        # Recent tool results
        for r in reversed(self._tool_results[-5:]):
            if r["success"] and r["result"] is not None:
                result_str = str(r["result"])[:500]
                parts.append(f"[{r['tool']}] {result_str}")

        # Entities
        if self._entities:
            parts.append(f"Entities: {self._entities}")

        return "\n".join(parts)

    def clear(self) -> None:
        """Clear working memory."""
        self._tool_results.clear()
        self._entities.clear()
        self._compressed_summaries.clear()

    def stats(self) -> dict[str, Any]:
        """Get memory statistics."""
        return {
            "tool_results": len(self._tool_results),
            "entities": len(self._entities),
            "compressed_summaries": len(self._compressed_summaries),
        }


working_memory = WorkingMemory()
