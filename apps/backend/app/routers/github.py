"""GitHub integration — OAuth flow + repos."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
import urllib.parse
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.schemas.github import (
    GitHubRepo,
    GitHubReposResponse,
    GitHubStatusResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/github", tags=["GitHub"])

# Token storage file
# Backend data dir — MUST stay in sync with services/mcp/github.py.
_token_dir = Path(__file__).resolve().parents[2] / "data"
_TOKEN_FILE = _token_dir / "github_token.json"

# GitHub OAuth app config — user registers their own at
# https://github.com/settings/developers → OAuth Apps → New
# Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env
# Fallback: instructions to create a personal access token

# Repos cache: fetching languages + READMEs for 100 repos is heavy
# (up to ~400 GitHub API calls). Cache per-token so repeated page loads —
# e.g. the tailor page repo picker — don't refire the whole fan-out.
# Module-level state is safe: single-worker uvicorn (see config_cache.py).
_repos_cache: dict[str, tuple[float, list[GitHubRepo]]] = {}
_REPOS_CACHE_TTL: float = 600.0  # 10 minutes


def _cache_key(token: str) -> str:
    """Cache key derived from the token — never store the token itself."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cache_project_repos(token: str, repos: list[GitHubRepo]) -> None:
    _repos_cache[_cache_key(token)] = (time.monotonic(), repos)


def _cached_repos(token: str) -> list[GitHubRepo] | None:
    hit = _repos_cache.get(_cache_key(token))
    if not hit:
        return None
    cached_at, repos = hit
    if time.monotonic() - cached_at > _REPOS_CACHE_TTL:
        return None
    return repos


def _invalidate_repos_cache() -> None:
    _repos_cache.clear()


def _load_token() -> dict | None:
    """Load stored GitHub token."""
    try:
        if _TOKEN_FILE.exists():
            return json.loads(_TOKEN_FILE.read_text())
    except Exception:
        pass
    return None


def _save_token(data: dict) -> None:
    """Save GitHub token to disk."""
    _TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    _TOKEN_FILE.write_text(json.dumps(data, indent=2))


def _delete_token() -> None:
    """Delete stored GitHub token."""
    try:
        _TOKEN_FILE.unlink(missing_ok=True)
    except Exception:
        pass


async def _get_token() -> str | None:
    """Get a valid GitHub access token."""
    data = _load_token()
    if not data:
        return None
    token = data.get("access_token")
    if not token:
        return None
    return token


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


@router.get("/github/status", response_model=GitHubStatusResponse)
async def github_status() -> GitHubStatusResponse:
    """Check if GitHub is connected via OAuth token."""
    token = await _get_token()
    if not token:
        return GitHubStatusResponse(
            installed=False,
            authenticated=False,
            message="Not connected. Click 'Connect GitHub' to authorize.",
        )
    try:
        user_data = await _github_api("https://api.github.com/user", token)
        return GitHubStatusResponse(
            installed=True,
            authenticated=True,
            user=user_data.get("login"),
            message=f"Connected as {user_data.get('login')}",
        )
    except Exception as exc:
        return GitHubStatusResponse(
            installed=True,
            authenticated=False,
            message=f"Connection expired: {exc}",
        )


@router.get("/github/auth-url")
async def github_auth_url() -> dict:
    """Generate GitHub OAuth authorization URL."""
    from app.config import settings

    client_id = settings.github_client_id
    if not client_id:
        return {
            "url": None,
            "error": "GitHub OAuth not configured. Set GITHUB_CLIENT_ID in .env, "
            "or create a Personal Access Token at https://github.com/settings/tokens "
            "and use the manual token entry.",
        }

    state = secrets.token_urlsafe(32)
    _save_token({"oauth_state": state})

    params = {
        "client_id": client_id,
        "redirect_uri": f"{settings.frontend_url}/settings",
        "scope": "read:user repo",
        "state": state,
    }
    url = f"https://github.com/login/oauth/authorize?{urllib.parse.urlencode(params)}"
    return {"url": url, "state": state}


@router.post("/github/callback")
async def github_callback(request: Request) -> dict:
    """Handle GitHub OAuth callback (or manual token entry)."""
    body = await request.json()
    code = body.get("code")
    token = body.get("token")

    # Manual token flow
    if token:
        try:
            user_data = await _github_api("https://api.github.com/user", token)
            _save_token({"access_token": token, "user": user_data.get("login")})
            return {
                "authenticated": True,
                "user": user_data.get("login"),
                "message": f"Connected as {user_data.get('login')}",
            }
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid token: {exc}",
            )

    # OAuth code flow
    if not code:
        raise HTTPException(status_code=400, detail="Missing code or token")

    from app.config import settings

    client_id = settings.github_client_id
    client_secret = settings.github_client_secret
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500,
            detail="GitHub OAuth not configured",
        )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
            timeout=15.0,
        )
        data = resp.json()

    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(
            status_code=400,
            detail=f"OAuth failed: {data.get('error_description', 'Unknown error')}",
        )

    user_data = await _github_api("https://api.github.com/user", access_token)
    _save_token({"access_token": access_token, "user": user_data.get("login")})

    return {
        "authenticated": True,
        "user": user_data.get("login"),
        "message": f"Connected as {user_data.get('login')}",
    }


@router.post("/github/disconnect")
async def github_disconnect() -> dict:
    """Disconnect GitHub — remove stored token."""
    _delete_token()
    _invalidate_repos_cache()
    return {"authenticated": False, "message": "Disconnected from GitHub"}


def _generate_description(name: str, languages: list[str], topics: list[str]) -> str:
    """Generate a description from repo metadata when none exists."""
    import re

    # Clean up the repo name
    clean = re.sub(r"[-_]+", " ", name)
    # Insert space before uppercase letters (camelCase)
    clean = re.sub(r"([a-z])([A-Z])", r"\1 \2", clean)
    # Remove dots, special chars
    clean = re.sub(r"[^a-zA-Z0-9 ]", "", clean).strip()
    clean = re.sub(r"\s+", " ", clean)

    # Skip github.io suffixes
    clean = re.sub(r"\s*github\s*io\s*$", "", clean, flags=re.IGNORECASE).strip()

    # Build description
    parts: list[str] = []
    if clean:
        title = clean[0].upper() + clean[1:]
        if len(title) > 60:
            title = title[:57] + "..."
        parts.append(title)

    stack: list[str] = []
    if topics:
        stack.extend(topics[:3])
    if languages:
        stack.extend(l for l in languages[:3] if l not in stack)
    if stack:
        parts.append("Built with " + ", ".join(stack[:4]))

    return ". ".join(parts) + "." if parts else ""


@router.get("/github/repos", response_model=GitHubReposResponse)
async def github_repos() -> GitHubReposResponse:
    """Fetch the authenticated user's GitHub repositories with languages and topics."""
    token = await _get_token()
    if not token:
        raise HTTPException(status_code=401, detail="Not connected to GitHub")

    # Serve from cache when fresh — the languages/README fan-out is expensive.
    cached = _cached_repos(token)
    if cached is not None:
        return GitHubReposResponse(repos=cached, total=len(cached))

    try:
        raw_repos = await _github_api(
            "https://api.github.com/user/repos?per_page=100&sort=updated",
            token,
        )

        # Fetch languages and READMEs in parallel (max 10 concurrent)
        import asyncio

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
                    import base64
                    content = base64.b64decode(data.get("content", "")).decode("utf-8", errors="replace")
                    # Truncate to first 500 chars for context
                    return content[:500]
                except Exception:
                    return ""

        # Get username for README URLs
        user_data = await _github_api("https://api.github.com/user", token)
        username = user_data.get("login", "")

        lang_tasks = [
            fetch_langs(r["languages_url"])
            for r in raw_repos
            if r.get("languages_url")
        ]
        readme_tasks = [
            fetch_readme(username, r["name"])
            for r in raw_repos
        ]
        all_langs, all_readmes = await asyncio.gather(
            asyncio.gather(*lang_tasks),
            asyncio.gather(*readme_tasks),
        )

        repos = []
        seen_names: set[str] = set()
        for idx, r in enumerate(raw_repos):
            repo_name = r.get("name", "")
            if not repo_name or repo_name in seen_names:
                continue
            seen_names.add(repo_name)

            # Languages from parallel fetch
            langs = all_langs[idx] if idx < len(all_langs) else []
            if not langs and r.get("language"):
                langs = [r["language"]]

            # README from parallel fetch
            readme = all_readmes[idx] if idx < len(all_readmes) else ""

            # Topics/frameworks from repo data
            topics = r.get("topics", []) or []

            # Skip empty repos (no size, no languages, no topics, no original description)
            size = r.get("size", 0)
            has_description = bool(r.get("description"))
            if size == 0 and not langs and not topics and not has_description:
                continue

            repos.append(
                GitHubRepo(
                    name=repo_name,
                    description=r.get("description") or _generate_description(r.get("name", ""), langs, topics),
                    visibility=r.get("visibility", "public").upper(),
                    url=r.get("html_url", ""),
                    pushed_at=r.get("pushed_at"),
                    stargazer_count=r.get("stargazers_count", 0),
                    is_fork=r.get("fork", False),
                    is_archived=r.get("archived", False),
                    languages=langs,
                    topics=topics,
                    readme=readme,
                )
            )
        _cache_project_repos(token, repos)
        return GitHubReposResponse(repos=repos, total=len(repos))
    except RuntimeError as exc:
        if "401" in str(exc) or "expired" in str(exc).lower():
            _delete_token()
            _invalidate_repos_cache()
            raise HTTPException(status_code=401, detail="GitHub token expired")
        raise HTTPException(status_code=500, detail=f"Failed to fetch repos: {exc}")
