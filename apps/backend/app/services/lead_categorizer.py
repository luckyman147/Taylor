"""Lead categorization — heuristics first, AI only for ambiguous leftovers."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

AGENCY_KEYWORDS = (
    "agency",
    "recruiting",
    "recruitment",
    "staffing",
    "talent acquisition",
    "headhunt",
    "executive search",
    "counsel",
    "consulting",
    "consultancy",
    "partners",
    "associates",
    "media agency",
    "digital agency",
    "creative agency",
    "marketing agency",
    "advertising",
    "manpower",
    "hr services",
)

_GENERIC_EMAILS = frozenset(
    {
        "info",
        "hello",
        "hi",
        "contact",
        "support",
        "sales",
        "office",
        "admin",
        "team",
        "mail",
        "noreply",
        "no-reply",
    }
)


def looks_like_agency(text: str | None) -> bool:
    """Whether a name/type/description smells like an agency."""
    if not text:
        return False
    lowered = text.casefold()
    return any(keyword in lowered for keyword in AGENCY_KEYWORDS)


def is_generic_email(email: str | None) -> bool:
    """Role-based inbox (info@, sales@…) rather than a personal address."""
    if not email or "@" not in email:
        return False
    local = email.split("@", 1)[0]
    return local in _GENERIC_EMAILS


def heuristic_suggest(record: dict[str, Any]) -> tuple[str, float, str]:
    """Suggest (suggested_type, confidence, category_source) from shape alone.

    ``suggested_type`` ∈ contact | company | agency | unsure. Confidence is
    deterministic — no LLM — so results are reproducible.
    """
    lead_type = str(record.get("lead_type") or "").lower()
    linkedin = str(record.get("linkedin_url") or "").lower()
    name = str(record.get("name") or "")
    title = str(record.get("title") or "")
    industry = str(record.get("industry") or "")
    company_size = str(record.get("company_size") or "")
    description = str(record.get("description") or "")

    agency_signal = (
        looks_like_agency(name)
        or looks_like_agency(industry)
        or looks_like_agency(description[:300])
        or looks_like_agency(title)
    )

    if lead_type == "person" or "/in/" in linkedin:
        if agency_signal and looks_like_agency(title):
            # An "Agency Owner" person still saves as a contact; the company
            # side is handled by create_linked_company on save.
            return "contact", 0.8, "heuristic"
        if title or "/in/" in linkedin:
            return "contact", 0.9, "heuristic"
        return "unsure", 0.4, "unsure"

    if agency_signal:
        return "agency", 0.85, "heuristic"

    company_signals = (
        "/company/" in linkedin
        or bool(industry)
        or bool(company_size)
        or bool(str(record.get("website") or ""))
    )
    if lead_type == "company" or company_signals:
        if company_signals:
            return "company", 0.85, "heuristic"
        # A bare name tagged "company" by a web hit has no evidence either
        # way — let the AI (or the user) decide.
        return "unsure", 0.4, "unsure"

    return "unsure", 0.3, "unsure"


def apply_heuristics(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Tag every record with a heuristic suggestion.

    Returns (tagged_records, unsure_records) — the unsure list is what the
    AI classifier should see (one batched call).
    """
    unsure: list[dict[str, Any]] = []
    for record in records:
        suggested, confidence, source = heuristic_suggest(record)
        record["suggested_type"] = suggested
        record["category_source"] = source
        record["category_confidence"] = confidence
        if suggested == "unsure":
            unsure.append(record)
    return records, unsure


def apply_ai_classification(
    records: list[dict[str, Any]], classifications: dict[str, str]
) -> list[dict[str, Any]]:
    """Apply AI ``{lead_id-ish key: suggested_type}`` results to unsure records.

    ``classifications`` is keyed by the record's stable key (linkedin_url or
    normalized name). Only values in {contact, company, agency} are applied;
    anything else keeps the unsure state.
    """
    for record in records:
        if record.get("suggested_type") != "unsure":
            continue
        key = str(record.get("linkedin_url") or "").lower() or str(record.get("name") or "").lower()
        pick = classifications.get(key) or classifications.get(str(record.get("name") or "").lower())
        if pick in ("contact", "company", "agency"):
            record["suggested_type"] = pick
            record["category_source"] = "ai"
            record["category_confidence"] = 0.7
    return records
