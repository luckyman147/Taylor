"""Scorecard — CLI + JSON report generation."""

from __future__ import annotations

import json
from typing import Any

from eval.sample import EvalReport


class Scorecard:
    """Generates evaluation reports."""

    def __init__(self, report: EvalReport) -> None:
        self.report = report

    def to_dict(self) -> dict[str, Any]:
        """Full report as dict."""
        return {
            "mode": self.report.mode,
            "summary": self.report.summary,
            "metrics": [m.to_dict() for m in self.report.metric_results],
            "traces_count": len(self.report.traces),
        }

    def to_json(self) -> str:
        """Full report as JSON string."""
        return json.dumps(self.to_dict(), indent=2, default=str)

    def print_cli(self) -> str:
        """Formatted CLI output."""
        lines = []
        lines.append(f"\nTAYLOR Evaluation — {self.report.mode}")
        lines.append("─" * 40)

        for m in self.report.metric_results:
            if m.passed is not None:
                icon = "✓" if m.passed else "✗"
                lines.append(f"  {icon} {m.metric_name:30s} {m.value:.1%}")
            else:
                lines.append(f"  · {m.metric_name:30s} {m.value:.4f}")

        if self.report.summary:
            lines.append("")
            for k, v in self.report.summary.items():
                lines.append(f"  {k:30s} {v}")

        lines.append("")
        return "\n".join(lines)
