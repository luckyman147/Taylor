"""GitHub adapter — uses OAuth token for GitHub API access."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import httpx

from app.llm import complete_json
from app.prompts import DIFF_PROJECT_BULLETS_PROMPT, get_language_name
from app.schemas.job_scraper import JobListing, JobSearchFilters
from app.services.mcp.base import BaseMCPAdapter

logger = logging.getLogger(__name__)

# Backend data dir — MUST stay in sync with routers/github.py. This file sits
# one package deeper (app/services/mcp/), so parents[3] == apps/backend.
_token_dir = Path(__file__).resolve().parents[3] / "data"
_TOKEN_FILE = _token_dir / "github_token.json"

# Selected-repo details cache: fetching languages + READMEs for a repo is
# heavy (~3 GitHub API calls), and the tailor preview/improve flows refetch
# selected repos on every run. Cache per access token (10 min) so repeated
# tailoring doesn't re-hit GitHub. Module-level state is safe: single-worker
# uvicorn (see config_cache.py). Keyed by token hash, never the token itself.
_repos_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_REPOS_CACHE_TTL: float = 600.0


def _token_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_repo_details(token: str) -> list[dict[str, Any]] | None:
    hit = _repos_cache.get(_token_cache_key(token))
    if not hit:
        return None
    cached_at, repos = hit
    if time.monotonic() - cached_at > _REPOS_CACHE_TTL:
        return None
    return repos


def _cache_repo_details(token: str, repos: list[dict[str, Any]]) -> None:
    _repos_cache[_token_cache_key(token)] = (time.monotonic(), repos)


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


async def _fetch_selected_repo_details(
    token: str, repo_names: list[str]
) -> list[dict[str, Any]]:
    """Fetch languages + README for the named repos owned by the user.

    Filters ``repo_names`` against the authenticated user's own repos so a
    client can never smuggle in a repo the user doesn't own.

    Results are cached per access token (10 min): the tailor preview and
    improve flows refetch selected repos on every run, so serving the
    languages/README fan-out from cache prevents repeat GitHub calls.
    """
    wanted = {name.strip() for name in repo_names if name and name.strip()}
    if not wanted:
        return []

    cached = _cached_repo_details(token)
    if cached is not None:
        return [r for r in cached if r.get("name") in wanted]

    try:
        raw_repos = await _github_api(
            "https://api.github.com/user/repos?per_page=100&sort=updated",
            token,
        )
    except Exception as exc:
        logger.debug("Failed to fetch user repos for selection: %s", exc)
        return []

    selected = [r for r in raw_repos if r.get("name") in wanted]
    if not selected:
        return []

    sem = asyncio.Semaphore(10)

    async def fetch_langs(url: str) -> list[str]:
        async with sem:
            try:
                data = await _github_api(url, token)
                return list(data.keys())[:8]
            except Exception:
                return []

    async def fetch_readme(owner: str, repo_name: str) -> str:
        async with sem:
            try:
                url = f"https://api.github.com/repos/{owner}/{repo_name}/readme"
                data = await _github_api(url, token)
                content = base64.b64decode(data.get("content", "")).decode(
                    "utf-8", errors="replace"
                )
                return content[:3000]
            except Exception:
                return ""

    user_data = await _github_api("https://api.github.com/user", token)
    username = user_data.get("login", "")

    lang_tasks = [
        fetch_langs(r["languages_url"]) for r in selected if r.get("languages_url")
    ]
    readme_tasks = [fetch_readme(username, r["name"]) for r in selected]
    all_langs, all_readmes = await asyncio.gather(
        asyncio.gather(*lang_tasks),
        asyncio.gather(*readme_tasks),
    )

    details = []
    for idx, r in enumerate(selected):
        langs = all_langs[idx] if idx < len(all_langs) else []
        if not langs and r.get("language"):
            langs = [r["language"]]
        details.append({
            "name": r.get("name", ""),
            "description": r.get("description", ""),
            "languages": langs,
            "topics": r.get("topics", []) or [],
            "url": r.get("html_url", ""),
            "readme": all_readmes[idx] if idx < len(all_readmes) else "",
        })

    _cache_repo_details(token, details)
    return details


def _repo_facts_for_prompt(repo: dict[str, Any]) -> str:
    """One-line factual summary of a repo for LLM grounding."""
    parts = [f"name: {repo.get('name', '')}"]
    if repo.get("description"):
        parts.append(f"description: {repo['description'][:200]}")
    if repo.get("languages"):
        parts.append("languages: " + ", ".join(repo["languages"][:8]))
    if repo.get("topics"):
        parts.append("topics: " + ", ".join(repo["topics"][:8]))
    if repo.get("readme"):
        parts.append("README excerpt: " + repo["readme"][:2000].replace("\n", " "))
    parts.append(f"url: {repo.get('url', '')}")
    return "\n".join(parts)


def format_selected_repos_for_prompt(repos: list[dict[str, Any]]) -> str:
    """Format the user-selected repos as a prompt section (blank if none)."""
    if not repos:
        return ""
    return "\n\n".join(_repo_facts_for_prompt(repo) for repo in repos)


async def generate_repo_project_bullets(
    repo: dict[str, Any], job_description: str, language: str
) -> list[str]:
    """LLM bullets for one repo, grounded strictly in its README/description.

    Falls back to deterministic bullets on LLM failure.
    """
    facts = _repo_facts_for_prompt(repo)
    prompt = DIFF_PROJECT_BULLETS_PROMPT.format(
        repo_facts=facts,
        job_description=(
            job_description[:4000] if job_description else "No job description provided."
        ),
        output_language=get_language_name(language),
    )
    try:
        result = await complete_json(
            prompt=prompt,
            system_prompt="You are a resume editor. Output only valid JSON.",
            max_tokens=512,
            schema_type="keywords",
        )
        bullets = result.get("bullets", [])
        if isinstance(bullets, list):
            cleaned = [str(b).strip() for b in bullets if str(b).strip()]
            if cleaned:
                return cleaned[:1]
    except Exception as exc:
        logger.debug("Repo bullet generation failed, falling back: %s", exc)

    fallback = _deterministic_project_paragraph(repo)
    return fallback


_README_BOILERPLATE = (
    "this template provides",
    "this is a template",
    "template for",
    "getting started with create",
    "minimal setup",
    "a minimal",
    "an example of",
    "example app",
    "boilerplate",
)


def _clean_readme_line(line: str) -> str:
    """Normalize one README line for tagline extraction."""
    line = line.lstrip("\ufeff\u200b").strip()
    if not line:
        return ""
    if line.startswith(("`", "|", ">", "---", "+++", "* ", "- ", "1. ", "2. ", "3. ")):
        return ""
    line = re.sub(r"<[^>]+>", "", line).strip()  # strip inline HTML like <p align="center">
    if not line or line.startswith(("#", "!")):
        return ""
    if "![" in line:
        return ""
    if line.casefold() in _README_BOILERPLATE:
        return ""
    if line.casefold().startswith(_README_BOILERPLATE):
        return ""
    return line


def _project_idea(repo: dict[str, Any]) -> str:
    """One-line 'what the project does'.

    GitHub description is preferred (user-written). Fall back to the first
    clean README tagline (BOM/HTML/headings/fences/boilerplate filtered).
    Empty string when no usable source exists.
    """
    description = str(repo.get("description") or "").strip()
    if description:
        return _clip_line(description, 160)
    readme = repo.get("readme") or ""
    for raw_line in readme.splitlines():
        line = _clean_readme_line(raw_line)
        if line and len(line) > 12:
            return _clip_line(line, 160)
    return ""


def _clip_line(text: str, limit: int) -> str:
    """Clip a sentence to ``limit`` chars at a word boundary."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(".,;: ") + "..."


def _name_derived_idea(repo: dict[str, Any]) -> str:
    """Catch-all fallback: a readable title derived from the repo name."""
    name = str(repo.get("name") or "").strip()
    clean = re.sub(r"[-_]+", " ", name)
    clean = re.sub(r"([a-z])([A-Z])", r"\1 \2", clean).strip()
    return _clip_line(clean[:1].upper() + clean[1:], 60) if clean else ""


def _deterministic_project_paragraph(repo: dict[str, Any]) -> list[str]:
    """A single sentence describing what the project does (no LLM call).

    Purpose first — what the project is for, not how it was built. Never
    returns empty: description → clean README tagline → a readable title
    derived from the repo name.
    """
    idea = _project_idea(repo) or _name_derived_idea(repo)
    if not idea:
        return []
    return [_clip_line(idea, 220)]


def build_project_entry(repo: dict[str, Any], description: list[str]) -> dict[str, Any]:
    """Server-minted project entry for a selected repo (github URL is authoritative).

    GitHub projects render as a paragraph ("plain" style, no bullet marker).
    """
    return {
        "name": repo.get("name", ""),
        "role": "",
        "years": "",
        "github": repo.get("url", "") or None,
        "website": None,
        "description": description,
        "descriptionStyles": ["plain"] * len(description),
    }


async def get_selected_repos_for_tailoring(
    repo_names: list[str] | None,
    job_description: str,
    language: str,
) -> tuple[list[dict[str, Any]], str]:
    """Fetch the user-selected repos and return (entries, prompt_context).

    Returns empty parts when unconnected or no valid selection, so callers
    degrade gracefully. Repository names are validated server-side against
    the authenticated user's own repos.
    """
    if not repo_names:
        return [], ""

    try:
        data = _load_token()
        if not data:
            return [], ""
        token = data.get("access_token")
        if not token:
            return [], ""
        repos = await _fetch_selected_repo_details(token, repo_names)
        if not repos:
            return [], ""
    except Exception as exc:
        logger.debug("Failed to fetch selected GitHub repos: %s", exc)
        return [], ""

    entries: list[dict[str, Any]] = []
    for repo in repos:
        bullets = await generate_repo_project_bullets(repo, job_description, language)
        entries.append(build_project_entry(repo, bullets))

    context = format_selected_repos_for_prompt(repos)
    return entries, context


async def get_selected_repos_for_diff(
    repo_names: list[str] | None,
) -> tuple[dict[str, str], str, list[dict[str, Any]]]:
    """Fetch user-selected repos for the diff prompt (no bullet LLM calls).

    Returns (name -> GitHub URL map, prompt context, deterministic project
    entries). Empty values when unconnected or no selection, so callers
    degrade gracefully. Repository names are validated server-side against
    the authenticated user's own repos.
    """
    if not repo_names:
        return {}, "", []

    try:
        data = _load_token()
        if not data:
            return {}, "", []
        token = data.get("access_token")
        if not token:
            return {}, "", []
        repos = await _fetch_selected_repo_details(token, repo_names)
        if not repos:
            return {}, "", []
    except Exception as exc:
        logger.debug("Failed to fetch selected GitHub repos: %s", exc)
        return {}, "", []

    name_to_url = {
        str(repo.get("name")): str(repo.get("url"))
        for repo in repos
        if repo.get("name") and repo.get("url")
    }
    entries = [
        build_project_entry(repo, _deterministic_project_paragraph(repo)) for repo in repos
    ]
    return name_to_url, format_selected_repos_for_prompt(repos), entries
