"""Crawl4AIAdapter — every fetch must be bounded.

Regression cover for the 'stays at [INIT] → Crawl4AI 0.9.2' incident: a stalled
site (crawl4ai's rate limiter / dispatch waits log nothing) used to hang the
chat web_search and enrichment research requests forever because neither
fetch_page nor fetch_pages had a timeout.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import crawl4ai

from app.services.mcp.crawl4ai import Crawl4AIAdapter, _MAX_PAGE_CHARS


def _fake_crawler(monkeypatch, *, arun=None, arun_many=None) -> None:
    """Replace crawl4ai.AsyncWebCrawler with a controllable double."""

    class _FakeCrawler:
        def __init__(self, crawler_strategy=None) -> None:
            self.crawler_strategy = crawler_strategy

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def arun(self, url: str):
            return await arun(url)

        async def arun_many(self, urls):
            return await arun_many(urls)

    monkeypatch.setattr(crawl4ai, "AsyncWebCrawler", _FakeCrawler)


async def _stall(_):
    await asyncio.Event().wait()


class TestFetchBounded:
    async def test_fetch_page_times_out_instead_of_hanging(self, monkeypatch):
        _fake_crawler(monkeypatch, arun=_stall)
        adapter = Crawl4AIAdapter()
        adapter.timeout = 0.05
        assert await adapter.fetch_page("https://example.com") == ""

    async def test_fetch_pages_times_out_instead_of_hanging(self, monkeypatch):
        _fake_crawler(monkeypatch, arun_many=_stall)
        adapter = Crawl4AIAdapter()
        adapter.timeout = 0.05
        result = await adapter.fetch_pages(
            ["https://a.com", "https://b.com"]
        )
        assert result == {}

    async def test_fetch_pages_empty_urls_is_noop(self):
        assert await Crawl4AIAdapter().fetch_pages([]) == {}


class TestFetchResults:
    async def test_fetch_page_returns_truncated_markdown(self, monkeypatch):
        async def _ok(url: str):
            return SimpleNamespace(success=True, markdown="x" * 10_000)

        _fake_crawler(monkeypatch, arun=_ok)
        result = await Crawl4AIAdapter().fetch_page("https://example.com")
        assert result == "x" * _MAX_PAGE_CHARS

    async def test_fetch_page_unwraps_markdown_dict(self, monkeypatch):
        async def _ok(url: str):
            return SimpleNamespace(
                success=True,
                markdown={"fit_markdown": "fit", "raw_markdown": "raw"},
            )

        _fake_crawler(monkeypatch, arun=_ok)
        assert await Crawl4AIAdapter().fetch_page("https://example.com") == "fit"

    async def test_fetch_page_failure_returns_empty(self, monkeypatch):
        async def _boom(url: str):
            raise RuntimeError("boom")

        _fake_crawler(monkeypatch, arun=_boom)
        assert await Crawl4AIAdapter().fetch_page("https://example.com") == ""

    async def test_fetch_pages_success_mapping(self, monkeypatch):
        async def _ok(urls):
            return [
                SimpleNamespace(success=True, markdown="md", url=u) for u in urls
            ]

        _fake_crawler(monkeypatch, arun_many=_ok)
        result = await Crawl4AIAdapter().fetch_pages(
            ["https://a.com", "https://b.com"]
        )
        assert result == {"https://a.com": "md", "https://b.com": "md"}

    async def test_fetch_pages_failure_returns_empty(self, monkeypatch):
        async def _boom(urls):
            raise RuntimeError("boom")

        _fake_crawler(monkeypatch, arun_many=_boom)
        assert await Crawl4AIAdapter().fetch_pages(["https://a.com"]) == {}
