"""Tool Retriever — finds tools that could solve a user's query.

Uses capability matching + BM25 keyword search to find candidate tools.
This is Stage 1 of the 3-stage pipeline.
"""

import logging
import re
from typing import Any

from app.tools.registry import tool_registry

logger = logging.getLogger(__name__)


class ToolRetriever:
    """Finds candidate tools for a user query using capability matching."""

    # Minimum score threshold to include a tool
    MIN_SCORE = 0.1
    # Default number of candidates to return
    DEFAULT_TOP_K = 12

    async def retrieve(
        self,
        query: str,
        top_k: int = DEFAULT_TOP_K,
        context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve candidate tools for a user query.

        Strategy:
        1. Extract keywords from query
        2. Match against tool capabilities (taxonomy-based)
        3. Keyword overlap scoring (lightweight BM25-like)
        4. Domain bonus if query context matches

        Returns list of tool dicts with relevance scores.
        """
        self._ensure_loaded()
        query_lower = query.lower()
        query_words = set(self._tokenize(query_lower))

        candidates = []
        for tool in tool_registry.list_tools():
            score = self._score_tool(tool, query_lower, query_words, context)
            if score >= self.MIN_SCORE:
                candidates.append({**tool, "retrieval_score": score})

        # Sort by score descending
        candidates.sort(key=lambda t: t["retrieval_score"], reverse=True)
        return candidates[:top_k]

    def _score_tool(
        self,
        tool: dict[str, Any],
        query_lower: str,
        query_words: set[str],
        context: dict[str, Any] | None,
    ) -> float:
        """Score a tool against a query."""
        score = 0.0

        # 1. Capability match (0.0 - 0.4)
        capabilities = tool.get("capabilities", [])
        for cap in capabilities:
            if cap.lower() in query_lower:
                score += 0.4
                break
            # Partial keyword match
            cap_words = set(cap.lower().split("_"))
            overlap = cap_words & query_words
            if overlap:
                score += 0.2 * (len(overlap) / len(cap_words))

        # 2. Description keyword overlap (0.0 - 0.3)
        desc_words = set(self._tokenize(tool.get("description", "").lower()))
        if desc_words:
            overlap = desc_words & query_words
            score += 0.3 * (len(overlap) / len(desc_words))

        # 3. Tool name match (0.0 - 0.2)
        name_words = set(tool["name"].lower().split("_"))
        name_overlap = name_words & query_words
        if name_overlap:
            score += 0.2 * (len(name_overlap) / len(name_words))

        # 4. Domain bonus (0.0 - 0.1)
        if context and context.get("mode") == "resume_analyst":
            if tool.get("domain") == "career":
                score += 0.1

        # 5. Skill allowlist bonus (0.0 - 0.15)
        if context:
            skills = context.get("skills", [])
            if skills:
                from app.prompts import get_skill_allowlist
                allowlist = get_skill_allowlist(skills)
                if tool["name"] in allowlist:
                    score += 0.15

        return min(score, 1.0)

    def _tokenize(self, text: str) -> list[str]:
        """Simple tokenization: split on non-alphanumeric, filter short tokens."""
        return [w for w in re.split(r"[^a-z0-9]+", text) if len(w) > 2]

    def _ensure_loaded(self) -> None:
        """Ensure built-in tools are loaded."""
        from app.tools.registry import tool_registry as _reg
        _reg.list_tools()  # triggers lazy load


tool_retriever = ToolRetriever()
