"""Unit tests for the GitHub repos cache helpers."""

from app.routers.github import (
    _cache_key,
    _cache_project_repos,
    _cached_repos,
    _invalidate_repos_cache,
    _repos_cache,
    _REPOS_CACHE_TTL,
)


def _repo(name: str) -> dict:
    return {"name": name, "languages": [], "description": None}


class TestGithubReposCache:
    def setup_method(self) -> None:
        _invalidate_repos_cache()

    def test_cache_roundtrip(self) -> None:
        repos = [_repo("a"), _repo("b")]
        _cache_project_repos("tok-1", repos)
        assert _cached_repos("tok-1") == repos
        # Different token never gets served another user's repos
        assert _cached_repos("tok-2") is None

    def test_cache_key_is_deterministic_and_opaque(self) -> None:
        assert _cache_key("tok") == _cache_key("tok")
        assert _cache_key("tok") != "tok"
        assert len(_cache_key("tok")) == 64

    def test_ttl_expiry(self) -> None:
        _cache_project_repos("tok-1", [_repo("a")])
        key = _cache_key("tok-1")
        stored_at, _ = _repos_cache[key]
        # Force the entry past its TTL
        _repos_cache[key] = (stored_at - _REPOS_CACHE_TTL - 1, [_repo("a")])
        assert _cached_repos("tok-1") is None

    def test_invalidate_clears_all_tokens(self) -> None:
        _cache_project_repos("tok-1", [_repo("a")])
        _cache_project_repos("tok-2", [_repo("b")])
        _invalidate_repos_cache()
        assert _cached_repos("tok-1") is None
        assert _cached_repos("tok-2") is None