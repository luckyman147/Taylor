"""Outreach email analytics.

Deterministic response-rate statistics over the ``sent_emails`` history
(`compute_email_stats` — a pure, unit-testable function) plus an LLM analysis
that explains what works, what fails, and concrete fixes
(`analyze_outreach`).
"""

import json
import logging
from collections import defaultdict
from typing import Any, Callable

from app.config_cache import get_content_language
from app.llm import (
    complete_json,
    get_llm_config,
    get_model_name,
    get_safe_max_tokens,
)
from app.prompts import OUTREACH_ANALYSIS_PROMPT, get_language_name
from app.schemas.models import OutreachAnalysisReport

logger = logging.getLogger(__name__)

ANALYSIS_EMAIL_LIMIT = 40
ANALYSIS_BODY_CHARS = 1500

_KNOWN_OUTCOMES = ("pending", "responded", "not_interested", "bounced")


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 3) if denominator else 0.0


def _recipient_type(email: dict[str, Any]) -> str:
    return "contact" if email.get("contact_id") else "company"


def _segment_stats(
    emails: list[dict[str, Any]],
    key_fn: Callable[[dict[str, Any]], str],
) -> list[dict[str, Any]]:
    """Group emails by ``key_fn`` and compute sent/responded/rate per bucket."""
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for email in emails:
        buckets[key_fn(email) or "unknown"].append(email)

    segments: list[dict[str, Any]] = []
    for key in sorted(buckets):
        group = buckets[key]
        responded = sum(1 for e in group if e.get("outcome") == "responded")
        segments.append(
            {
                "key": key,
                "sent": len(group),
                "responded": responded,
                "response_rate": _rate(responded, len(group)),
            }
        )
    return segments


def compute_email_stats(emails: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute deterministic outreach performance statistics.

    Pure function over the sent-email history so it is unit-testable.
    ``response_rate = responded / (total - bounced)`` (bounces are not
    deliverable attempts).
    """
    counts = {outcome: 0 for outcome in _KNOWN_OUTCOMES}
    for email in emails:
        outcome = email.get("outcome")
        counts[outcome if outcome in counts else "pending"] += 1

    total = len(emails)
    bounced = counts["bounced"]
    responded = counts["responded"]
    deliverable = total - bounced

    responded_bodies = [
        len(e.get("body") or "") for e in emails if e.get("outcome") == "responded"
    ]
    non_responded_bodies = [
        len(e.get("body") or "")
        for e in emails
        if e.get("outcome") in ("pending", "not_interested")
    ]

    # Subjects that produced at least one reply, grouped by exact subject.
    subject_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for email in emails:
        subject_groups[email.get("subject") or ""].append(email)
    top_subjects = sorted(
        (
            {
                "subject": subject,
                "sent": len(group),
                "responded": sum(
                    1 for e in group if e.get("outcome") == "responded"
                ),
            }
            for subject, group in subject_groups.items()
            if subject
            and any(e.get("outcome") == "responded" for e in group)
        ),
        key=lambda item: (-item["responded"], -item["sent"]),
    )[:5]
    for item in top_subjects:
        item["response_rate"] = _rate(item["responded"], item["sent"])

    # One point per send-day; a reply counts on the day the email was sent.
    by_day: dict[str, dict[str, int]] = defaultdict(lambda: {"sent": 0, "responded": 0})
    for email in emails:
        day = str(email.get("sent_at") or "")[:10]
        if not day:
            continue
        by_day[day]["sent"] += 1
        if email.get("outcome") == "responded":
            by_day[day]["responded"] += 1
    timeline = [
        {"date": day, "sent": data["sent"], "responded": data["responded"]}
        for day, data in sorted(by_day.items())
    ]

    return {
        "total_sent": total,
        "pending": counts["pending"],
        "responded": responded,
        "not_interested": counts["not_interested"],
        "bounced": bounced,
        "response_rate": _rate(responded, deliverable),
        "avg_body_length_responded": (
            round(sum(responded_bodies) / len(responded_bodies), 1)
            if responded_bodies
            else None
        ),
        "avg_body_length_not_responded": (
            round(sum(non_responded_bodies) / len(non_responded_bodies), 1)
            if non_responded_bodies
            else None
        ),
        "by_recipient_type": _segment_stats(emails, _recipient_type),
        "by_mode": _segment_stats(
            emails, lambda e: (e.get("email_mode") or "personalized")
        ),
        "by_purpose": _segment_stats(
            emails, lambda e: (e.get("purpose") or "general")
        ),
        "top_subjects": top_subjects,
        "timeline": timeline,
    }


def _serialize_stats(stats: dict[str, Any]) -> str:
    return json.dumps(stats, ensure_ascii=False, indent=2)


def _serialize_emails_for_prompt(emails: list[dict[str, Any]]) -> str:
    samples = [
        {
            "recipient_type": _recipient_type(e),
            "email_mode": e.get("email_mode"),
            "purpose": e.get("purpose"),
            "subject": e.get("subject"),
            "body": (e.get("body") or "")[:ANALYSIS_BODY_CHARS],
            "outcome": e.get("outcome") or "pending",
            "sent_at": e.get("sent_at"),
        }
        for e in emails[:ANALYSIS_EMAIL_LIMIT]
    ]
    return json.dumps(samples, ensure_ascii=False, indent=1)


async def analyze_outreach(
    emails: list[dict[str, Any]],
    language: str | None = None,
) -> OutreachAnalysisReport:
    """LLM analysis of the sent-email history: what works, what to change.

    ``emails`` should already be ordered newest-first (as returned by
    ``db.list_sent_emails``). Wrapped by the router in
    ``llm_cache.coalesce`` for single-flight.
    """
    language = language or get_content_language()
    stats = compute_email_stats(emails)
    prompt = OUTREACH_ANALYSIS_PROMPT.format(
        output_language=get_language_name(language),
        stats_summary=_serialize_stats(stats),
        emails=_serialize_emails_for_prompt(emails),
    )
    config = get_llm_config()
    max_tokens = get_safe_max_tokens(get_model_name(config), requested=2500)

    result = await complete_json(
        prompt=prompt,
        system_prompt=(
            "You are a senior outbound-recruiting coach. Output truthful, "
            "data-grounded analysis as JSON only."
        ),
        max_tokens=max_tokens,
        schema_type="outreach_analysis",
    )
    return OutreachAnalysisReport.model_validate(result)
