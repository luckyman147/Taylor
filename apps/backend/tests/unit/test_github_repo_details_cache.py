"""Unit tests for the selected-repo details cache used by the tailor pipeline."""

import pytest

from app.services.mcp import github as gh


@pytest.fixture(autouse=True)
def _clear_repos_cache() -> None:
    gh._repos_cache.clear()


def _repo(name: str) -> dict:
    return {"name": name, "languages": ["Python"], "description": None, "readme": ""}


class TestRepoDetailsCache:
    def test_roundtrip(self) -> None:
        repos = [_repo("a"), _repo("b")]
        gh._cache_repo_details("tok-1", repos)
        assert gh._cached_repo_details("tok-1") == repos
        assert gh._cached_repo_details("tok-2") is None

    def test_key_is_deterministic_and_opaque(self) -> None:
        assert gh._token_cache_key("tok") == gh._token_cache_key("tok")
        assert gh._token_cache_key("tok") != "tok"
        assert len(gh._token_cache_key("tok")) == 64

    def test_ttl_expiry(self) -> None:
        gh._cache_repo_details("tok-1", [_repo("a")])
        key = gh._token_cache_key("tok-1")
        stored_at, _ = gh._repos_cache[key]
        gh._repos_cache[key] = (stored_at - gh._REPOS_CACHE_TTL - 1, [_repo("a")])
        assert gh._cached_repo_details("tok-1") is None

    @pytest.mark.asyncio
    async def test_fetch_serves_filtered_cache_hit(self, monkeypatch) -> None:
        details = [_repo("alpha"), _repo("beta")]
        gh._cache_repo_details("tok", details)
        called = False

        async def boom(*args, **kwargs):
            nonlocal called
            called = True
            raise AssertionError("should not hit GitHub API on cache hit")

        monkeypatch.setattr(gh, "_github_api", boom)
        result = await gh._fetch_selected_repo_details("tok", ["beta"])
        assert result == [_repo("beta")]
        assert not called

    @pytest.mark.asyncio
    async def test_fetch_stores_cache_after_miss(self, monkeypatch) -> None:
        raw_repos = [
            {"name": "alpha", "languages_url": "https://api.github.com/langs/alpha",
             "html_url": "https://github.com/u/alpha", "description": "Alpha repo",
             "topics": ["fastapi"], "language": "Python"},
            {"name": "zeta", "languages_url": "https://api.github.com/langs/zeta",
             "html_url": "https://github.com/u/zeta", "description": None,
             "topics": [], "language": None},
        ]

        async def fake_api(url: str, token: str) -> dict | list:
            assert token == "tok"
            if url.endswith("/user/repos?per_page=100&sort=updated"):
                return raw_repos
            if url.endswith("/user"):
                return {"login": "u"}
            if "/langs/" in url:
                if url.endswith("/langs/alpha"):
                    return {"Python": 100, "TypeScript": 40}
                return {}
            if "/readme" in url:
                if url.endswith("/alpha/readme"):
                    return {"content": "QmxhLg=="}  # "Bla."
                return {"content": ""}
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr(gh, "_github_api", fake_api)
        result = await gh._fetch_selected_repo_details("tok", ["alpha", "zeta", "nope"])
        assert [r["name"] for r in result] == ["alpha", "zeta"]
        assert result[0]["languages"] == ["Python", "TypeScript"]
        assert result[0]["readme"] == "Bla."
        assert gh._cached_repo_details("tok") == result