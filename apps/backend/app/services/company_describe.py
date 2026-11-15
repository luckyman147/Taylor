"""Fetch a one-time company description from its website.

Used when a company is created (or given a website later) so downstream
flows — bulk email research, outreach generation — reuse the stored text
instead of re-crawling the site on every run.

The fetcher chain (crawl4ai → Jina Reader) is isolated behind
``fetch_company_description`` so swapping the underlying crawler touches
only this module.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Matches the per-source budget in enrichment._build_research_summary.
_MAX_DESCRIPTION_CHARS = 2000


def condense(raw: str, max_chars: int = _MAX_DESCRIPTION_CHARS) -> str:
    """Collapse whitespace and cap raw crawled Markdown to ``max_chars``."""
    text = re.sub(r"\s+", " ", raw or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip()


async def fetch_company_description(url: str) -> str:
    """Return a condensed description of ``url``'s page, or ``""``.

    Never raises — a failed fetch just means the caller stores no
    description (the user can add one manually later).
    """
    if not url or not url.strip():
        return ""
    url = url.strip()

    content = ""
    try:
        from app.services.mcp.crawl4ai import Crawl4AIAdapter

        content = await Crawl4AIAdapter().fetch_page(url)
    except Exception as exc:  # defensive — fetch_page itself does not raise
        logger.warning("crawl4ai description fetch failed for %s: %s", url, exc)

    if not content:
        try:
            from app.services.mcp.web import WebAdapter

            content = await WebAdapter().fetch_page(url)
        except Exception as exc:
            logger.warning("Jina description fetch failed for %s: %s", url, exc)

    description = condense(content)
    if description:
        logger.info("Fetched company description for %s (%d chars)", url, len(description))
    else:
        logger.info("No description content fetched for %s", url)
    return description
