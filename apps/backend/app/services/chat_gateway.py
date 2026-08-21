"""Gateway layer: fast intent classifier that decides resume selection flow.

Runs BEFORE the planner. No LLM calls — pure keyword + heuristic matching.
Returns a routing decision that the orchestrator uses to skip or augment the planner.
"""

from __future__ import annotations

import re
from typing import Any

from app.database import db


# ---------------------------------------------------------------------------
# Intent patterns
# ---------------------------------------------------------------------------

_AUDIT_KEYWORDS = re.compile(
    r"\b("
    r"ats\s*audit|audit\s*(my\s*)?resume|resume\s*audit|"
    r"score\s*(my\s*)?resume|resume\s*score|"
    r"how\s*(does|do)\s*(my\s*)?resume\s*look|"
    r"check\s*(my\s*)?resume|review\s*(my\s*)?resume|"
    r"resume\s*review|resume\s*check|"
    r"optimize\s*(my\s*)?resume|resume\s*optimization|"
    r"resume\s*feedback|improve\s*(my\s*)?resume"
    r")\b",
    re.IGNORECASE,
)

_RESUME_ID_PATTERN = re.compile(
    r"\bresume[_\s]*(?:id)?[:\s]+([a-f0-9-]{20,})\b",
    re.IGNORECASE,
)

_MASTER_PATTERN = re.compile(
    r"\b(master|base|primary|main)\s+resume\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Gateway decision
# ---------------------------------------------------------------------------

class GatewayDecision:
    """Result of the gateway classification."""

    def __init__(
        self,
        intent: str,
        resume_id: str | None = None,
        needs_selection: bool = False,
        resumes: list[dict[str, Any]] | None = None,
    ):
        self.intent = intent  # "resume_audit" | "general"
        self.resume_id = resume_id  # specific resume to audit (None = not determined)
        self.needs_selection = needs_selection  # True = show selection card
        self.resumes = resumes  # available resumes for selection

    def __repr__(self) -> str:
        return (
            f"GatewayDecision(intent={self.intent!r}, resume_id={self.resume_id!r}, "
            f"needs_selection={self.needs_selection})"
        )


async def classify_intent(user_message: str) -> GatewayDecision:
    """Classify user intent and determine if resume selection is needed.

    Fast, no LLM calls. Returns a routing decision.
    """
    msg = user_message.strip()

    # Check for explicit resume ID in message
    id_match = _RESUME_ID_PATTERN.search(msg)
    if id_match:
        return GatewayDecision(intent="resume_audit", resume_id=id_match.group(1))

    # Check for master resume reference
    if _MASTER_PATTERN.search(msg):
        return GatewayDecision(intent="resume_audit", resume_id="master")

    # Check if this is a resume audit intent
    if not _AUDIT_KEYWORDS.search(msg):
        return GatewayDecision(intent="general")

    # Audit intent detected — check available resumes
    resumes = await db.list_resumes()
    if not resumes:
        return GatewayDecision(intent="resume_audit")

    if len(resumes) == 1:
        # Auto-select the only resume
        return GatewayDecision(
            intent="resume_audit",
            resume_id=resumes[0].get("resume_id"),
        )

    # Multiple resumes — need user selection
    return GatewayDecision(
        intent="resume_audit",
        needs_selection=True,
        resumes=[
            {
                "resume_id": r.get("resume_id"),
                "title": r.get("title") or r.get("filename") or "Untitled",
                "is_master": r.get("is_master", False),
                "has_data": bool(r.get("processed_data")),
            }
            for r in resumes
        ],
    )
