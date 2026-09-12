"""Gateway layer: fast intent classifier that routes user messages.

Runs BEFORE the planner. No LLM calls — pure keyword + heuristic matching.
Returns a routing decision that the orchestrator uses to skip or augment the planner.
"""

from __future__ import annotations

import logging
import re
from enum import Enum
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Intent enum
# ---------------------------------------------------------------------------

class ChatIntent(str, Enum):
    GENERAL = "general"
    PROFILE = "profile"
    JOB_SEARCH = "job_search"
    RESUME_AUDIT = "resume_audit"
    APPLICATIONS = "applications"
    SKILLS = "skills"
    MARKET = "market"


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
    r"resume\s*feedback|improve\s*(my\s*)?resume|"
    r"dit\s*(my\s*)?resume|edit\s*(my\s*)?resume|"
    r"score\s*my\s*cv|cv\s*score|audit\s*my\s*cv|cv\s*audit|"
    r"review\s*my\s*cv|check\s*my\s*cv"
    r")\b",
    re.IGNORECASE,
)

_RESUME_ID_PATTERN = re.compile(
    r"\b(?:resume|cv)[_\s]*(?:id)?[:\s]+([a-f0-9-]{20,})\b",
    re.IGNORECASE,
)

_MASTER_PATTERN = re.compile(
    r"\b(master|base|primary|main)\s+resume\b",
    re.IGNORECASE,
)

_JOB_SEARCH_PATTERNS = re.compile(
    r"\b("
    r"find\b.*\bjobs?\b|search\b.*\bjobs?\b|"
    r"look\s+for\b.*\bpositions?\b|"
    r"openings?\b|vacancies?\b|"
    r"remote\b.*\b(role|position|job)s?\b|"
    r"hiring\b|"
    r"any\s+jobs?\b|"
    r"show\s+me\b.*\bjobs?\b"
    r")\b",
    re.IGNORECASE,
)

_PROFILE_PATTERNS = re.compile(
    r"\b(my\s+(profile|skills|experience|career)|"
    r"what\s+skills\s+do\s+i\s+have|"
    r"tell\s+me\s+about\s+my\s+profile|"
    r"career\s+summary)\b",
    re.IGNORECASE,
)

_APPLICATION_PATTERNS = re.compile(
    r"\b(my\s+applications?\b|"
    r"application\s+funnel\b|"
    r"where\s+did\s+i\s+apply|"
    r"how\s+many\s+applications?)\b",
    re.IGNORECASE,
)

_MARKET_PATTERNS = re.compile(
    r"\b(market\s+position|market\s+demand|"
    r"industry\s+trends|salary|compensation)\b",
    re.IGNORECASE,
)

_SKILLS_PATTERNS = re.compile(
    r"\b(skill\s+(gap|suggestion|roi|analysis)|"
    r"missing\s+skills?|forgotten\s+skills?)\b",
    re.IGNORECASE,
)

_CONTEXTUAL_FOLLOWUP_PATTERNS = re.compile(
    r"\b(best|worst|top|filter|compare|which|from\s+those|of\s+that|of\s+those|"
    r"from\s+the\s+list|summarize|analyze|rank|sort|of\s+these|from\s+this|"
    r"tell\s+me\s+more\s+about|pick|choose|select|narrow|refine)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Gateway decision
# ---------------------------------------------------------------------------

class GatewayDecision:
    """Result of the gateway classification."""

    def __init__(
        self,
        intent: ChatIntent,
        resume_id: str | None = None,
        needs_selection: bool = False,
        resumes: list[dict[str, Any]] | None = None,
        preferred_tools: list[str] | None = None,
        confidence: float = 0.0,
        contextual_follow_up: bool = False,
    ):
        self.intent = intent
        self.resume_id = resume_id
        self.needs_selection = needs_selection
        self.resumes = resumes
        self.preferred_tools = preferred_tools or []
        self.confidence = confidence
        self.contextual_follow_up = contextual_follow_up

    def __repr__(self) -> str:
        return (
            f"GatewayDecision(intent={self.intent!r}, resume_id={self.resume_id!r}, "
            f"needs_selection={self.needs_selection}, confidence={self.confidence}, "
            f"contextual_follow_up={self.contextual_follow_up})"
        )


async def classify_intent(user_message: str, resume_id: str | None = None) -> GatewayDecision:
    """Classify user intent and determine routing.

    Fast, no LLM calls. Returns a routing decision with intent,
    preferred tools, and confidence score.
    """
    msg = user_message.strip()

    # If a resume_id was explicitly provided (e.g. from file upload), use it directly
    if resume_id:
        logger.info("Gateway: explicit resume_id from upload=%s", resume_id)
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id=resume_id,
            confidence=1.0,
        )

    # Check for explicit resume ID in message
    id_match = _RESUME_ID_PATTERN.search(msg)
    if id_match:
        logger.info("Gateway: explicit resume_id=%s", id_match.group(1))
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id=id_match.group(1),
            confidence=1.0,
        )

    # Check for master resume reference
    if _MASTER_PATTERN.search(msg):
        logger.info("Gateway: master resume reference detected")
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id="master",
            confidence=0.95,
        )

    # Check if this is a resume audit intent
    if _AUDIT_KEYWORDS.search(msg):
        return await _classify_audit_intent()

    # Contextual follow-up — references to previous results (check before job search)
    if _CONTEXTUAL_FOLLOWUP_PATTERNS.search(msg):
        # Don't flag if it's also a new job search (e.g., "find the best jobs")
        is_new_search = bool(_JOB_SEARCH_PATTERNS.search(msg))
        if not is_new_search:
            logger.info("Gateway: contextual follow-up detected")
            return GatewayDecision(
                intent=ChatIntent.GENERAL,
                confidence=0.8,
                contextual_follow_up=True,
            )

    # Job search
    if _JOB_SEARCH_PATTERNS.search(msg):
        logger.info("Gateway: job search intent detected")
        return GatewayDecision(
            intent=ChatIntent.JOB_SEARCH,
            preferred_tools=["search_mcp_jobs"],
            confidence=0.95,
        )

    # Profile
    if _PROFILE_PATTERNS.search(msg):
        logger.info("Gateway: profile intent detected")
        return GatewayDecision(
            intent=ChatIntent.PROFILE,
            preferred_tools=["get_career_summary"],
            confidence=0.9,
        )

    # Applications
    if _APPLICATION_PATTERNS.search(msg):
        logger.info("Gateway: applications intent detected")
        return GatewayDecision(
            intent=ChatIntent.APPLICATIONS,
            preferred_tools=["get_applications", "get_funnel_stats"],
            confidence=0.9,
        )

    # Skills
    if _SKILLS_PATTERNS.search(msg):
        logger.info("Gateway: skills intent detected")
        return GatewayDecision(
            intent=ChatIntent.SKILLS,
            preferred_tools=["get_skill_suggestions", "get_skill_roi"],
            confidence=0.85,
        )

    # Market
    if _MARKET_PATTERNS.search(msg):
        logger.info("Gateway: market intent detected")
        return GatewayDecision(
            intent=ChatIntent.MARKET,
            preferred_tools=["get_market_position"],
            confidence=0.85,
        )

    return GatewayDecision(intent=ChatIntent.GENERAL, confidence=0.5)


async def _classify_audit_intent() -> GatewayDecision:
    """Classify resume audit intent and determine if selection is needed."""
    resumes = await db.list_resumes()
    master_resumes = [r for r in resumes if r.get("is_master", False)]

    if not master_resumes:
        # No master — if only one resume overall, auto-select it
        if len(resumes) == 1:
            return GatewayDecision(
                intent=ChatIntent.RESUME_AUDIT,
                resume_id=resumes[0].get("resume_id"),
                confidence=0.9,
            )
        return GatewayDecision(intent=ChatIntent.RESUME_AUDIT, confidence=0.7)

    if len(master_resumes) == 1:
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id=master_resumes[0].get("resume_id"),
            confidence=0.95,
        )

    # Multiple master resumes — show selection card
    return GatewayDecision(
        intent=ChatIntent.RESUME_AUDIT,
        needs_selection=True,
        confidence=0.8,
        resumes=[
            {
                "resume_id": r.get("resume_id"),
                "title": r.get("title") or r.get("filename") or "Untitled",
                "is_master": True,
                "has_data": bool(r.get("processed_data")),
            }
            for r in master_resumes
        ],
    )
