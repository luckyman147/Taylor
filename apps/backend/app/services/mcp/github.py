"""GitHub adapter — uses OAuth token for GitHub API access."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from pathlib import Path

import httpx

from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

_token_dir = Path(__file__).resolve().parents[2] / "data"
_TOKEN_FILE = _token_dir / "github_token.json"


class GitHubAdapter(BaseMCPAdapter):
    """Adapter for GitHub via OAuth token (no gh CLI needed)."""

    name = "github"
    description = "GitHub (OAuth)"
    timeout = 15.0

    async def is_available(self) -> bool:
        try:
            from app.routers.github import _get_token
            token = await _get_token()
            return token is not None
        except Exception:
            return False

    async def search_jobs(
        self, keywords: str, filters: JobSearchFilters
    ) -> list[JobListing]:
        """GitHub doesn't have job listings — return empty."""
        return []


def _load_token() -> dict | None:
    """Load stored GitHub token."""
    try:
        if _TOKEN_FILE.exists():
            return json.loads(_TOKEN_FILE.read_text())
    except Exception:
        pass
    return None


async def _github_api(url: str, token: str) -> dict | list:
    """Call the GitHub API with a token."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=15.0,
        )
        if resp.status_code == 401:
            raise RuntimeError("Token expired or invalid")
        resp.raise_for_status()
        return resp.json()


def _score_repo(repo: dict, keyword_terms: list[str]) -> int:
    """Score a repo by relevance to job keywords."""
    score = 0
    repo_text = f"{repo.get('description', '')} {' '.join(repo.get('topics', []))}".lower()
    repo_langs = [l.lower() for l in repo.get("languages", [])]

    for term in keyword_terms:
        term_lower = term.lower()
        # Language match: +3
        if any(term_lower == lang or term_lower in lang for lang in repo_langs):
            score += 3
        # Topic match: +2
        if any(term_lower in t.lower() for t in repo.get("topics", [])):
            score += 2
        # Description match: +1
        if term_lower in repo_text:
            score += 1

    return score


def _format_repos_for_prompt(repos: list[dict]) -> str:
    """Format matched repos as context for the LLM prompt."""
    if not repos:
        return "No GitHub repos available."

    lines = []
    for repo in repos:
        name = repo.get("name", "unknown")
        desc = repo.get("description", "")
        langs = repo.get("languages", [])
        url = repo.get("url", "")
        parts = []
        if langs:
            parts.append("Built with " + ", ".join(langs[:4]))
        if desc:
            parts.append(desc[:200])
        detail = ". ".join(parts) + "." if parts else ""
        lines.append(f"- **{name}**: {detail} | {url}")

    return "\n".join(lines)


async def get_matched_repos_for_job(job_keywords: str) -> str:
    """Fetch GitHub repos and return top matches formatted for LLM context.

    Args:
        job_keywords: Space-separated keywords extracted from the job description.

    Returns:
        Formatted string of matched repos, or empty string if no token/repos.
    """
    try:
        data = _load_token()
        if not data:
            return ""
        token = data.get("access_token")
        if not token:
            return ""

        # Fetch repos
        raw_repos = await _github_api(
            "https://api.github.com/user/repos?per_page=100&sort=updated",
            token,
        )

        # Fetch languages in parallel (max 10 concurrent)
        sem = asyncio.Semaphore(10)

        async def fetch_langs(url: str) -> list[str]:
            async with sem:
                try:
                    data = await _github_api(url, token)
                    return list(data.keys())[:8]
                except Exception:
                    return []

        lang_tasks = [fetch_langs(r["languages_url"]) for r in raw_repos if r.get("languages_url")]
        all_langs = await asyncio.gather(*lang_tasks)

        repos = []
        for idx, r in enumerate(raw_repos):
            langs = all_langs[idx] if idx < len(all_langs) else []
            if not langs and r.get("language"):
                langs = [r["language"]]

            topics = r.get("topics", []) or []

            # Skip empty repos
            if r.get("size", 0) == 0 and not langs and not topics and not r.get("description"):
                continue

            repos.append({
                "name": r.get("name", ""),
                "description": r.get("description", ""),
                "languages": langs,
                "topics": topics,
                "url": r.get("html_url", ""),
            })

        if not repos:
            return ""

        # Score and rank
        keyword_terms = [t.strip() for t in job_keywords.split() if len(t.strip()) >= 2]
        scored = [(repo, _score_repo(repo, keyword_terms)) for repo in repos]
        scored = [(r, s) for r, s in scored if s > 0]
        scored.sort(key=lambda x: x[1], reverse=True)
        top = [r for r, s in scored[:5]]

        return _format_repos_for_prompt(top)
    except Exception as exc:
        logger.debug("Failed to fetch GitHub repos for tailoring: %s", exc)
        return ""
