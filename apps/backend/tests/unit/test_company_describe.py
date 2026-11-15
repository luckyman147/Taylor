"""Unit tests for the one-time company description fetcher."""

import pytest

from app.services.company_describe import (
    _MAX_DESCRIPTION_CHARS,
    condense,
    fetch_company_description,
)


class TestCondense:
    def test_collapses_whitespace(self):
        assert condense("  hello \n\n world\t!") == "hello world !"

    def test_caps_length(self):
        out = condense("x" * (_MAX_DESCRIPTION_CHARS + 500))
        assert len(out) == _MAX_DESCRIPTION_CHARS
        assert out == "x" * _MAX_DESCRIPTION_CHARS

    def test_short_text_unchanged(self):
        assert condense("Builds robots.") == "Builds robots."

    def test_empty_inputs(self):
        assert condense("") == ""
        assert condense("   \n  ") == ""


class TestFetchCompanyDescription:
    async def test_uses_crawl4ai_first(self, monkeypatch):
        from app.services.mcp.crawl4ai import Crawl4AIAdapter
        from app.services.mcp.web import WebAdapter

        async def _crawl(*args):
            return "Crawled content."

        async def _jina(*args):
            pytest.fail("Jina fallback must not run when crawl4ai succeeds")

        monkeypatch.setattr(Crawl4AIAdapter, "fetch_page", _crawl)
        monkeypatch.setattr(WebAdapter, "fetch_page", _jina)
        assert await fetch_company_description("https://x.test") == "Crawled content."

    async def test_falls_back_to_jina_when_crawl_empty(self, monkeypatch):
        from app.services.mcp.crawl4ai import Crawl4AIAdapter
        from app.services.mcp.web import WebAdapter

        async def _crawl(*args):
            return ""

        async def _jina(*args):
            return "Jina content."

        monkeypatch.setattr(Crawl4AIAdapter, "fetch_page", _crawl)
        monkeypatch.setattr(WebAdapter, "fetch_page", _jina)
        assert await fetch_company_description("https://x.test") == "Jina content."

    async def test_never_raises_when_both_fetchers_fail(self, monkeypatch):
        from app.services.mcp.crawl4ai import Crawl4AIAdapter
        from app.services.mcp.web import WebAdapter

        async def _crawl(*args):
            raise RuntimeError("crawl boom")

        async def _jina(*args):
            raise RuntimeError("jina boom")

        monkeypatch.setattr(Crawl4AIAdapter, "fetch_page", _crawl)
        monkeypatch.setattr(WebAdapter, "fetch_page", _jina)
        assert await fetch_company_description("https://x.test") == ""

    async def test_blank_url_short_circuits(self, monkeypatch):
        from app.services.mcp.crawl4ai import Crawl4AIAdapter

        async def _crawl(*args):
            pytest.fail("No fetch should happen for a blank URL")

        monkeypatch.setattr(Crawl4AIAdapter, "fetch_page", _crawl)
        assert await fetch_company_description("") == ""
        assert await fetch_company_description("   ") == ""

    async def test_result_is_condensed_and_capped(self, monkeypatch):
        from app.services.mcp.crawl4ai import Crawl4AIAdapter

        async def _crawl(*args):
            return "  huge \n\n " + "a" * (_MAX_DESCRIPTION_CHARS + 1000)

        monkeypatch.setattr(Crawl4AIAdapter, "fetch_page", _crawl)
        out = await fetch_company_description("https://x.test")
        assert out.startswith("huge")
        assert len(out) <= _MAX_DESCRIPTION_CHARS
