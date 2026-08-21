"""URL verification for LLM-proposed learning resources.

The LLM proposes resource links; this module proves each URL actually
resolves (2xx/3xx) and extracts a real page title before anything reaches
the user, so hallucinated or dead links never appear in the UI. Pure enough
to test with ``respx``; never raises on network trouble.
"""

import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 5.0
_READ_LIMIT_BYTES = 64 * 1024
_MAX_TITLE_CHARS = 200
_UA = "ResumeMatcher/1.0 (resource verification)"
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _extract_title(html: str) -> str:
    """Pull the page <title>, whitespace-collapsed and truncated."""
    match = _TITLE_RE.search(html)
    if match is None:
        return ""
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    return title[:_MAX_TITLE_CHARS]


async def verify_resource_link(url: str) -> dict[str, Any] | None:
    """Fetch ``url``; return ``{title, url}`` on success, ``None`` on failure.

    Only http(s) URLs are allowed. Redirects are followed and the final URL
    is reported; a title-less page still counts as verified.
    """
    if not url.startswith(("http://", "https://")):
        return None
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            response = await client.get(
                url, headers={"User-Agent": _UA}
            )
        if response.status_code >= 400:
            return None
        title = _extract_title(response.text[:_READ_LIMIT_BYTES])
        return {"title": title, "url": str(response.url)}
    except Exception:
        logger.debug("Resource link verification failed: %s", url, exc_info=True)
        return None


async def verify_resource_links(
    resources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Verify a list of ``{title, url, source}``; drop dead or invalid links.

    The LLM-proposed title is kept as a fallback when no <title> is found;
    the resolved (final) URL and a real title are preferred when present.
    """
    verified: list[dict[str, Any]] = []
    for resource in resources:
        url = str(resource.get("url") or "").strip()
        if not url:
            continue
        checked = await verify_resource_link(url)
        if checked is None:
            continue
        verified.append(
            {
                "title": checked["title"] or str(resource.get("title") or "").strip(),
                "url": checked["url"],
                "source": str(resource.get("source") or "").strip()[:40],
            }
        )
    return verified
