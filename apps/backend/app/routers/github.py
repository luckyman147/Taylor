"""GitHub integration — OAuth flow + repos."""

from __future__ import annotations

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
_token_dir = Path(__file__).resolve().parents[2] / "data"
_TOKEN_FILE = _token_dir / "github_token.json"

# GitHub OAuth app config — user registers their own at
# https://github.com/settings/developers → OAuth Apps → New
# Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env
# Fallback: instructions to create a personal access token

# In-process TTL cache for the repos response (the route fans out to ~200
# GitHub API calls for 100 repos; repos change rarely, so 10 minutes is safe).
_repos_cache: tuple[float, GitHubReposResponse] | None = None
_REPOS_CACHE_TTL = 10 * 60.0


def _cached_repos() -> GitHubReposResponse | None:
    """Return the cached repos response if still fresh, else None."""
    global _repos_cache
    if _repos_cache is None:
        return None
    stamped, response = _repos_cache
    if time.monotonic() - stamped > _REPOS_CACHE_TTL:
        _repos_cache = None
        return None
    return response


def _store_repos_cache(response: GitHubReposResponse) -> None:
    """Store the repos response with a fresh timestamp."""
    global _repos_cache
    _repos_cache = (time.monotonic(), response)


def _invalidate_repos_cache() -> None:
    """Drop the cached repos response (token changed or expired)."""
    global _repos_cache
    _repos_cache = None


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
            _invalidate_repos_cache()
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
    _invalidate_repos_cache()

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
    """Fetch the authenticated user's GitHub repositories with languages and topics.

    Responses are cached in-process for 10 minutes (the fetch fans out to
    hundreds of GitHub API calls); the cache is invalidated whenever the
    token changes or expires.
    """
    token = await _get_token()
    if not token:
        raise HTTPException(status_code=401, detail="Not connected to GitHub")

    cached = _cached_repos()
    if cached is not None:
        return cached

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
        for idx, r in enumerate(raw_repos):
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
                    name=r.get("name", ""),
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
        response = GitHubReposResponse(repos=repos, total=len(repos))
        _store_repos_cache(response)
        return response
    except RuntimeError as exc:
        if "401" in str(exc) or "expired" in str(exc).lower():
            _delete_token()
            _invalidate_repos_cache()
            raise HTTPException(status_code=401, detail="GitHub token expired")
        raise HTTPException(status_code=500, detail=f"Failed to fetch repos: {exc}")
