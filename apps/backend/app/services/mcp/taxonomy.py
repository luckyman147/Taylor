"""Canonical Capability Taxonomy — normalizes tool capabilities.

Maps MCP tool names to canonical capability categories so the ranker
can match user intent to tools even when naming varies across providers.
"""

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


# Canonical capability categories
CAPABILITIES = {
    # Search & Discovery
    "search": {"keywords": ["search", "find", "query", "lookup", "discover", "explore"]},
    "web_search": {"keywords": ["web", "internet", "online", "browse", "scrape", "fetch"]},
    "job_search": {"keywords": ["job", "career", "position", "role", "opening", " vacancy"]},
    "company_search": {"keywords": ["company", "employer", "organization", "firm", "business"]},
    "people_search": {"keywords": ["people", "person", "contact", "network", "connection", "professional"]},
    "news_search": {"keywords": ["news", "article", "press", "media", "blog", "post"]},
    "academic_search": {"keywords": ["paper", "research", "academic", "scholar", "publication"]},

    # Content Generation
    "write": {"keywords": ["write", "generate", "create", "draft", "compose"]},
    "email": {"keywords": ["email", "mail", "message", "outreach", "correspondence"]},
    "resume": {"keywords": ["resume", "cv", "curriculum", "profile"]},
    "cover_letter": {"keywords": ["cover letter", "letter", "application letter"]},
    "document": {"keywords": ["document", "report", "summary", "analysis"]},

    # Data & Analysis
    "analyze": {"keywords": ["analyze", "analysis", "evaluate", "assess", "review", "audit"]},
    "data": {"keywords": ["data", "statistics", "metrics", "numbers", "stats"]},
    "compare": {"keywords": ["compare", "comparison", "vs", "difference", "contrast"]},
    "extract": {"keywords": ["extract", "parse", "read", "import", "ingest"]},

    # Communication
    "social": {"keywords": ["social", "twitter", "linkedin", "facebook", "instagram", "post"]},
    "message": {"keywords": ["message", "chat", "dm", "direct message", "conversation"]},
    "notification": {"keywords": ["notify", "alert", "notification", "ping"]},

    # System & Integration
    "api": {"keywords": ["api", "endpoint", "webhook", "integration", "connect"]},
    "file": {"keywords": ["file", "upload", "download", "storage", "document"]},
    "calendar": {"keywords": ["calendar", "event", "schedule", "meeting", "appointment"]},
    "task": {"keywords": ["task", "todo", "action", "item", "checklist"]},

    # Career-specific
    "career": {"keywords": ["career", "professional", "work", "employment"]},
    "interview": {"keywords": ["interview", "preparation", "practice", "question"]},
    "salary": {"keywords": ["salary", "compensation", "pay", "wage", "income"]},
    "skills": {"keywords": ["skill", "ability", "competency", "proficiency", "expertise"]},
}


class CapabilityTaxonomy:
    """Maps raw tool names/capabilities to canonical categories."""

    def __init__(self) -> None:
        self._category_index: dict[str, set[str]] = {}
        self._build_index()

    def _build_index(self) -> None:
        """Build reverse index: keyword -> category."""
        for category, info in CAPABILITIES.items():
            for keyword in info["keywords"]:
                if keyword not in self._category_index:
                    self._category_index[keyword] = set()
                self._category_index[keyword].add(category)

    def classify_tool(self, tool_name: str, description: str = "") -> list[str]:
        """Classify a tool into canonical categories based on name and description.

        Returns list of matching categories (sorted by specificity).
        """
        text = f"{tool_name} {description}".lower()
        matches: dict[str, int] = {}

        for keyword, categories in self._category_index.items():
            if keyword in text:
                for cat in categories:
                    matches[cat] = matches.get(cat, 0) + 1

        if not matches:
            return ["general"]

        # Sort by match count (more specific = higher)
        return [cat for cat, _ in sorted(matches.items(), key=lambda x: -x[1])]

    def classify_capabilities(self, capabilities: list[str]) -> list[str]:
        """Classify a list of raw capability strings to canonical categories."""
        all_categories: dict[str, int] = {}
        for cap in capabilities:
            categories = self.classify_tool(cap, cap)
            for cat in categories:
                all_categories[cat] = all_categories.get(cat, 0) + 1
        return sorted(all_categories.keys(), key=lambda c: -all_categories[c])

    def get_domain(self, categories: list[str]) -> str:
        """Map categories to a domain (career, research, communication, etc.)."""
        career = {"career", "job_search", "resume", "cover_letter", "interview", "salary", "skills", "company_search", "people_search"}
        research = {"search", "web_search", "academic_search", "news_search", "analyze", "data"}
        communication = {"email", "message", "social", "notification"}
        system = {"api", "file", "calendar", "task"}

        cat_set = set(categories)
        if cat_set & career:
            return "career"
        if cat_set & research:
            return "research"
        if cat_set & communication:
            return "communication"
        if cat_set & system:
            return "system"
        return "general"


taxonomy = CapabilityTaxonomy()
