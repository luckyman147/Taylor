"""Tool Ranking — selects the best tools for a user query.

Combines capability match, BM25 keyword overlap, and reliability scores
to rank tools. This is Stage 2 of the 3-stage pipeline.
"""

import logging
from typing import Any

from app.database import db
from app.tools.registry import tool_registry

logger = logging.getLogger(__name__)


class ToolRanker:
    """Ranks candidate tools by relevance and reliability."""

    # Weights for the ranking formula
    W_CAPABILITY = 0.40
    W_KEYWORD = 0.25
    W_DOMAIN = 0.15
    W_RELIABILITY = 0.10
    W_RECENCY = 0.10

    async def rank(
        self,
        candidates: list[dict[str, Any]],
        query: str,
        context: dict[str, Any] | None = None,
        top_k: int = 8,
    ) -> list[dict[str, Any]]:
        """Rank candidate tools and return the top-k.

        Each tool gets a rank_score combining:
        - capability_match: how well tool capabilities match the query intent
        - keyword_overlap: BM25-lite keyword matching
        - domain_relevance: whether tool domain matches context
        - reliability: historical success rate
        - recency: how recently the tool was used successfully

        Returns top-k tools sorted by rank_score.
        """
        if not candidates:
            return []

        ranked = []
        for tool in candidates:
            score = await self._compute_score(tool, query, context)
            ranked.append({**tool, "rank_score": score})

        ranked.sort(key=lambda t: t["rank_score"], reverse=True)
        return ranked[:top_k]

    async def _compute_score(
        self,
        tool: dict[str, Any],
        query: str,
        context: dict[str, Any] | None,
    ) -> float:
        """Compute the final ranking score for a tool."""
        # 1. Capability match (from retriever)
        capability_score = tool.get("retrieval_score", 0.0) * self.W_CAPABILITY

        # 2. Keyword overlap (recompute with more weight for tool description)
        keyword_score = self._keyword_score(tool, query) * self.W_KEYWORD

        # 3. Domain relevance
        domain_score = self._domain_score(tool, context) * self.W_DOMAIN

        # 4. Reliability
        reliability_score = await self._reliability_score(tool) * self.W_RELIABILITY

        # 5. Recency
        recency_score = await self._recency_score(tool) * self.W_RECENCY

        return capability_score + keyword_score + domain_score + reliability_score + recency_score

    def _keyword_score(self, tool: dict[str, Any], query: str) -> float:
        """BM25-lite keyword overlap between tool and query."""
        query_words = set(query.lower().split())
        tool_text = f"{tool['name']} {tool.get('description', '')}".lower()
        tool_words = set(tool_text.split())
        if not query_words or not tool_words:
            return 0.0
        overlap = query_words & tool_words
        return len(overlap) / max(len(query_words), 1)

    def _domain_score(self, tool: dict[str, Any], context: dict[str, Any] | None) -> float:
        """Domain relevance bonus with skill boosts."""
        if not context:
            return 0.5  # neutral
        tool_domain = tool.get("domain", "general")
        tool_source = tool.get("source", "")
        mode = context.get("mode", "")
        skills = context.get("skills", [])

        # Skill-based domain boosts (highest priority)
        from app.prompts import CHAT_SKILLS
        for skill in skills:
            boosts = CHAT_SKILLS.get(skill, {}).get("domain_boost", {})
            if tool_domain in boosts:
                return boosts[tool_domain]

        # Search mode: boost web/MCP/adapter tools
        if mode == "search" and tool_source in ("mcp", "custom"):
            return 0.9

        if mode == "resume_analyst" and tool_domain == "career":
            return 1.0
        if mode == "coach" and tool_domain in ("career", "communication"):
            return 0.8
        if context.get("domain") and context.get("domain") == tool_domain:
            return 0.9
        return 0.5

    async def _reliability_score(self, tool: dict[str, Any]) -> float:
        """Historical reliability score (0.0 - 1.0)."""
        stats = await db.get_tool_usage(tool["name"])
        if not stats or stats["total_calls"] < 5:
            return 0.8  # Default for new tools (slightly optimistic)
        return stats["successful_calls"] / stats["total_calls"]

    async def _recency_score(self, tool: dict[str, Any]) -> float:
        """Recency bonus for recently used tools."""
        stats = await db.get_tool_usage(tool["name"])
        if not stats or not stats.get("last_used_at"):
            return 0.3  # Never used
        # Simple recency: used recently = higher score
        from datetime import datetime, timezone
        try:
            last_used = datetime.fromisoformat(stats["last_used_at"])
            now = datetime.now(timezone.utc)
            hours_ago = (now - last_used).total_seconds() / 3600
            if hours_ago < 1:
                return 1.0
            if hours_ago < 24:
                return 0.8
            if hours_ago < 168:  # 1 week
                return 0.5
        except (ValueError, TypeError):
            pass
        return 0.3


tool_ranker = ToolRanker()
