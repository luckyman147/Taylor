"""Evidence Collector — tracks data sources and confidence.

Records which tools provided what data, enabling the answer generator
to cite sources and assess overall confidence.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class EvidenceCollector:
    """Tracks evidence sources and confidence for the agent loop."""

    def __init__(self) -> None:
        self._evidence: list[dict[str, Any]] = []

    def add(
        self,
        tool_name: str,
        data: Any,
        confidence: float = 1.0,
        source_url: str | None = None,
    ) -> None:
        """Record a piece of evidence."""
        self._evidence.append({
            "tool": tool_name,
            "data": data,
            "confidence": confidence,
            "source_url": source_url,
        })

    def get_all(self) -> list[dict[str, Any]]:
        """Get all collected evidence."""
        return self._evidence.copy()

    def get_high_confidence(self, threshold: float = 0.7) -> list[dict[str, Any]]:
        """Get evidence above a confidence threshold."""
        return [e for e in self._evidence if e["confidence"] >= threshold]

    def get_by_tool(self, tool_name: str) -> list[dict[str, Any]]:
        """Get evidence from a specific tool."""
        return [e for e in self._evidence if e["tool"] == tool_name]

    def average_confidence(self) -> float:
        """Calculate average confidence across all evidence."""
        if not self._evidence:
            return 0.0
        return sum(e["confidence"] for e in self._evidence) / len(self._evidence)

    def get_sources(self) -> list[str]:
        """Get unique source URLs."""
        sources = set()
        for e in self._evidence:
            if e.get("source_url"):
                sources.add(e["source_url"])
        return list(sources)

    def to_citations(self) -> str:
        """Format evidence as citations for the answer."""
        if not self._evidence:
            return ""

        lines = ["Sources:"]
        for i, e in enumerate(self._evidence, 1):
            tool = e["tool"]
            conf = e["confidence"]
            url = e.get("source_url", "")
            lines.append(f"{i}. {tool} (confidence: {conf:.0%})" + (f" - {url}" if url else ""))
        return "\n".join(lines)

    def clear(self) -> None:
        """Clear all evidence."""
        self._evidence.clear()


evidence_collector = EvidenceCollector()
