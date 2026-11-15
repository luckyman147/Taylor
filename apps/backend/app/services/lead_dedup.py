"""Three-tier lead deduplication and merge.

Tiers (applied in order):
1. Exact identity — normalized email and canonical LinkedIn URL.
2. Exact name — normalized name + lead type (+ company for persons).
3. Fuzzy — token-set Jaccard similarity on names within the same lead type.

Merges keep the richest record: non-null fields win, longer descriptions win,
and ``sources`` are unioned so provenance survives every merge.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse, urlunparse

FUZZY_THRESHOLD = 0.85

_NAME_SUFFIXES = (
    " jr",
    " jr.",
    " sr",
    " sr.",
    " ii",
    " iii",
    " iv",
    " phd",
    " ph.d.",
    " mba",
    " md",
    " dr",
    " dr.",
    " prof",
    " prof.",
)

_COMPANY_SUFFIXES = (
    " inc",
    " inc.",
    " llc",
    " l.l.c.",
    " ltd",
    " ltd.",
    " limited",
    " gmbh",
    " sa",
    " s.a.",
    " s.a.s.",
    " s.r.l.",
    " pty",
    " plc",
    " co",
    " co.",
    " corp",
    " corp.",
    " corporation",
    " group",
    " holding",
    " holdings",
)

# Fields filled from the secondary record when the primary lacks them.
_BACKFILL_FIELDS = (
    "title",
    "company",
    "email",
    "phone",
    "linkedin_url",
    "website",
    "location",
    "industry",
    "company_size",
    "description",
)


def normalize_email(email: str | None) -> str | None:
    """Lowercase, strip ``mailto:`` and whitespace; None when empty."""
    if not email:
        return None
    cleaned = email.strip().lower()
    if cleaned.startswith("mailto:"):
        cleaned = cleaned[len("mailto:") :].strip()
    cleaned = cleaned.rstrip(".,;").strip()
    return cleaned or None


def canonical_linkedin_url(url: str | None) -> str | None:
    """Canonicalize a LinkedIn URL for identity comparison.

    Lowercases the host, forces https, drops query/fragment/trailing slash,
    and maps profile URLs to ``linkedin.com/in/<slug>`` form so tracking
    suffixes (``-en``, ``?trk=...``) never split one identity.
    """
    if not url or not url.strip():
        return None
    raw = url.strip()
    if raw.startswith("mailto:"):
        return None
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in ("linkedin.com", "linkedin.fr", "lnkd.in"):
        # Not LinkedIn — keep a light canonical form instead.
        path = re.sub(r"/+$", "", parsed.path or "")
        return urlunparse(("https", host, path, "", "", "")).rstrip("/")
    if host == "lnkd.in":
        return "https://lnkd.in" + re.sub(r"/+$", "", parsed.path or "")
    parts = [p for p in (parsed.path or "").split("/") if p]
    if len(parts) >= 2 and parts[0] in ("in", "company", "school", "showcase"):
        slug = parts[1].lower()
        return f"https://www.linkedin.com/{parts[0]}/{slug}"
    path = re.sub(r"/+$", "", parsed.path or "").lower()
    return f"https://www.linkedin.com{path}".rstrip("/")


def normalize_name(name: str | None) -> str:
    """Casefold, strip punctuation/suffixes, collapse whitespace."""
    if not name:
        return ""
    normalized = name.casefold()
    normalized = re.sub(r"[^\w\s'-]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    for suffix in _NAME_SUFFIXES:
        if normalized.endswith(suffix) and len(normalized) > len(suffix) + 1:
            normalized = normalized[: -len(suffix)].strip()
            break
    return normalized


def normalize_company_name(name: str | None) -> str:
    """Casefold a company name and strip common legal suffixes."""
    if not name:
        return ""
    # Split location/qualifier segments BEFORE punctuation normalization
    # (which would otherwise destroy the "|" separator).
    base = name.split("|")[0].split(" - ")[0]
    normalized = normalize_name(base)
    for suffix in _COMPANY_SUFFIXES:
        if normalized.endswith(suffix) and len(normalized) > len(suffix) + 1:
            normalized = normalized[: -len(suffix)].strip()
            break
    return normalized.strip()


def name_tokens(name: str | None) -> set[str]:
    """Whitespace tokens of a normalized name (length >= 2)."""
    return {t for t in normalize_name(name).split() if len(t) >= 2}


def jaccard(a: set[str], b: set[str]) -> float:
    """Token-set Jaccard similarity in [0, 1]."""
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union else 0.0


def _sources_list(record: dict[str, Any]) -> list[str]:
    sources = record.get("sources")
    if isinstance(sources, list) and sources:
        return [str(s) for s in sources]
    single = record.get("source")
    return [single] if single else []


def merge_records(primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
    """Merge ``secondary`` into ``primary`` (non-null / longer wins)."""
    merged = dict(primary)
    for field in _BACKFILL_FIELDS:
        current = merged.get(field)
        incoming = secondary.get(field)
        if incoming and not current:
            merged[field] = incoming
        elif incoming and current and field == "description":
            if len(str(incoming)) > len(str(current)):
                merged[field] = incoming
    # Identity/type: prefer a person/company classification over empty.
    if not merged.get("lead_type") and secondary.get("lead_type"):
        merged["lead_type"] = secondary["lead_type"]
    # Provenance union, stable order.
    seen: list[str] = []
    for src in _sources_list(primary) + _sources_list(secondary):
        if src and src not in seen:
            seen.append(src)
    merged["sources"] = seen
    if seen:
        merged["source"] = seen[0]
    return merged


def _identity_keys(record: dict[str, Any]) -> list[tuple[str, str]]:
    """Tier-1 exact identity keys for a record."""
    keys: list[tuple[str, str]] = []
    email = normalize_email(record.get("email"))
    if email:
        keys.append(("email", email))
    li = canonical_linkedin_url(record.get("linkedin_url"))
    if li:
        keys.append(("linkedin", li))
    return keys


def _name_key(record: dict[str, Any]) -> tuple[str, str, str]:
    """Tier-2 exact name key: (lead_type, normalized name, company key)."""
    lead_type = str(record.get("lead_type") or "").lower()
    company_key = normalize_company_name(record.get("company")) if lead_type == "person" else ""
    return (lead_type, normalize_name(record.get("name")), company_key)


class LeadDeduper:
    """Deduplicates a batch of raw lead records across the three tiers.

    ``existing`` seeds the index with already-persisted leads so a new search
    never re-inserts something the database already knows about — matched
    records are reported in ``already_in_db`` instead.
    """

    def __init__(self, existing: list[dict[str, Any]] | None = None) -> None:
        self._by_identity: dict[tuple[str, str], dict[str, Any]] = {}
        self._by_name: dict[tuple[str, str, str], dict[str, Any]] = {}
        self._fuzzy_pool: list[tuple[set[str], dict[str, Any]]] = []
        self._existing_ids: set[str] = set()
        self._already_in_db: set[str] = set()
        for record in existing or []:
            self._index(record, is_existing=True)

    def _index(self, record: dict[str, Any], is_existing: bool = False) -> None:
        for key in _identity_keys(record):
            self._by_identity.setdefault(key, record)
        name_key = _name_key(record)
        if name_key[1]:
            self._by_name.setdefault(name_key, record)
        tokens = name_tokens(record.get("name"))
        if tokens:
            self._fuzzy_pool.append((tokens, record))
        if is_existing and record.get("lead_id"):
            self._existing_ids.add(str(record["lead_id"]))

    def _find_existing_match(self, record: dict[str, Any]) -> dict[str, Any] | None:
        for key in _identity_keys(record):
            match = self._by_identity.get(key)
            if match is not None and match.get("lead_id") in self._existing_ids:
                return match
        name_key = _name_key(record)
        match = self._by_name.get(name_key) if name_key[1] else None
        if match is not None and match.get("lead_id") in self._existing_ids:
            return match
        return None

    def _find_fuzzy_match(self, record: dict[str, Any]) -> dict[str, Any] | None:
        tokens = name_tokens(record.get("name"))
        if not tokens:
            return None
        lead_type = str(record.get("lead_type") or "").lower()
        company = normalize_company_name(record.get("company")) if lead_type == "person" else ""
        for existing_tokens, candidate in self._fuzzy_pool:
            if str(candidate.get("lead_type") or "").lower() != lead_type:
                continue
            if lead_type == "person":
                cand_company = normalize_company_name(candidate.get("company"))
                if company and cand_company and company != cand_company:
                    continue
            if jaccard(tokens, existing_tokens) >= FUZZY_THRESHOLD:
                return candidate
        return None

    def dedupe(
        self, candidates: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
        """Deduplicate ``candidates``; returns (merged_records, stats).

        Records that match something already in the DB (seeded via
        ``existing``) are merged into that DB row's dict and tagged with
        ``_already_in_db``; the caller backfills missing fields and skips
        re-insertion.
        """
        raw = len(candidates)
        exact_kept: list[dict[str, Any]] = []
        for record in candidates:
            name = normalize_name(record.get("name"))
            if not name:
                continue
            merged_into: dict[str, Any] | None = None
            for key in _identity_keys(record):
                existing_hit = self._by_identity.get(key)
                if existing_hit is not None:
                    merged_into = existing_hit
                    break
            if merged_into is None:
                name_key = _name_key(record)
                merged_into = self._by_name.get(name_key) if name_key[1] else None
            if merged_into is not None:
                if merged_into.get("lead_id") in self._existing_ids:
                    self._already_in_db.add(str(merged_into.get("lead_id")))
                self._merge_into(merged_into, record)
                continue
            clean = dict(record)
            clean.setdefault("sources", _sources_list(record))
            exact_kept.append(clean)
            self._index(clean)

        fuzzy_kept: list[dict[str, Any]] = []
        for record in exact_kept:
            match = self._find_fuzzy_match(record)
            if match is record:
                # Self-hit from the in-batch index — keep the record as-is.
                fuzzy_kept.append(record)
                continue
            if match is not None and match.get("lead_id") in self._existing_ids:
                # Same person/company already persisted under a fuzzy-equal
                # name — backfill the DB row in place, never re-insert.
                self._already_in_db.add(str(match["lead_id"]))
                self._merge_into(match, record)
                continue
            if match is not None:
                # In-batch fuzzy match: merge into the earlier record, which
                # stays in ``fuzzy_kept`` (it was already processed).
                self._merge_into(match, record)
                continue
            fuzzy_kept.append(record)
            self._index(record)

        final = fuzzy_kept
        already = len(self._already_in_db)
        stats = {
            "raw": raw,
            "after_exact": len(exact_kept),
            "after_fuzzy": len(final),
            "merged": max(0, raw - len(final) - already),
            "already_in_db": already,
        }
        return final, stats

    @staticmethod
    def _merge_into(primary: dict[str, Any], secondary: dict[str, Any]) -> None:
        """Merge ``secondary`` into ``primary`` in place (identity preserved).

        Index slots keep pointing at ``primary``; only its content changes.
        """
        merged = merge_records(primary, secondary)
        primary.clear()
        primary.update(merged)

    @property
    def already_in_db_ids(self) -> set[str]:
        return set(self._already_in_db)
