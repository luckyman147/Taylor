"""Integration tests for POST /enrichment/research-company.

Regression cover: the LLM URL-search and LLM synthesis steps were removed to
stop the crawler flow from burning tokens — research-company must now make
ZERO LLM calls and assemble research_summary directly from crawled content.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from httpx import ASGITransport, AsyncClient

from app.main import app


async def _post(payload: dict, crawl_urls: list[str]) -> tuple:
    transport = ASGITransport(app=app)
    with (
        patch(
            "app.routers.enrichment.complete_json",
            new_callable=AsyncMock,
            side_effect=AssertionError("research-company must not call the LLM"),
        ) as llm_mock,
        patch(
            "app.services.mcp.crawl4ai.Crawl4AIAdapter.fetch_pages",
            new_callable=AsyncMock,
            return_value={u: f"Crawled content for {u}" for u in crawl_urls},
        ) as crawl_mock,
        patch(
            "app.services.job_scraper.get_mcp_manager",
            new=lambda: SimpleNamespace(adapters={}),
        ),
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/research-company", json=payload
            )
    return response, llm_mock, crawl_mock


async def test_research_company_makes_no_llm_calls() -> None:
    website = "https://acme.example"
    payload = {
        "company_name": f"Acme {uuid4().hex[:8]}",
        "website": website,
    }
    response, llm_mock, crawl_mock = await _post(payload, [website])

    assert response.status_code == 200
    body = response.json()
    assert llm_mock.await_count == 0
    assert crawl_mock.await_count == 1
    assert body["website_content"] == f"Crawled content for {website}"
    assert body["research_summary"] == (
        f"Website content:\nCrawled content for {website}"
    )
    assert body["sources"] == [website]


async def test_research_company_crawls_only_provided_urls() -> None:
    """No LLM URL suggestion anymore — crawl exactly what the caller sent."""
    website = "https://acme.example/about"
    linkedin = "https://linkedin.com/company/acme"
    payload = {
        "company_name": f"Acme {uuid4().hex[:8]}",
        "website": website,
        "linkedin_url": linkedin,
    }
    response, llm_mock, crawl_mock = await _post(payload, [website, linkedin])

    assert response.status_code == 200
    body = response.json()
    assert llm_mock.await_count == 0
    crawl_mock.assert_awaited_once_with([website, linkedin])
    assert f"Website content:\nCrawled content for {website}" in body["research_summary"]
    assert f"LinkedIn content:\nCrawled content for {linkedin}" in (
        body["research_summary"]
    )
    assert body["sources"] == [website, linkedin]
