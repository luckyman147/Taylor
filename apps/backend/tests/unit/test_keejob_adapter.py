"""Unit tests for the Keejob adapter (HTML scraping)."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from app.schemas.job_scraper import JobSearchFilters, JobType
from app.services.mcp.keejob import (
    BASE_URL,
    LISTINGS_PATH,
    KeejobAdapter,
    _clean,
    _parse_posted_date,
)

SAMPLE_ARTICLE = """
<article class="bg-white rounded-lg shadow-sm border p-4">
  <div class="flex flex-col sm:flex-row">
    <div class="w-24 h-24">
      <i class="fas fa-building"></i>
    </div>
    <div class="flex-1 min-w-0">
      <h2>
        <a class="hover:text-blue-600" href="/offres-emploi/244465/developpeur-wordpress-hf-sousse/">
          Développeur WordPress
        </a>
      </h2>
      <p class="text-sm text-gray-600 mb-2">
        <span>
          Entreprise Anonyme
        </span>
      </p>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span class="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-blue-100">
          <i class="fas fa-briefcase mr-1"></i>
          CDI
        </span>
        <span class="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-green-100">
          <i class="fas fa-money-bill-wave mr-1"></i>
          1000 - 1111 TND
        </span>
      </div>
      <div class="mb-3">
        <p class="text-sm text-gray-700 leading-relaxed">
          Vous interviendrez sur la refonte et la maintenance de notre site institutionnel.
        </p>
      </div>
      <div class="flex flex-wrap items-center text-sm text-gray-500 gap-x-4">
        <div class="flex items-center whitespace-nowrap">
          <i class="fas fa-map-marker-alt mr-1"></i>
          <span>
            Sousse Jaouhara,
            Sousse
          </span>
        </div>
        <div class="flex items-center whitespace-nowrap">
          <i class="fas fa-clock mr-1"></i>
          <span>
            4 août 2026
          </span>
        </div>
      </div>
    </div>
  </div>
</article>
"""

SAMPLE_PAGE = (
    "<!doctype html><html><body>"
    "<h1>Résultats de recherche</h1>"
    f"{SAMPLE_ARTICLE}"
    "</body></html>"
)

LISTINGS_URL = BASE_URL + LISTINGS_PATH


def _run(coro) -> object:
    return asyncio.run(coro)


def test_parse_listing_html_extracts_fields() -> None:
    jobs = KeejobAdapter()._parse_listing_html(SAMPLE_PAGE)

    assert len(jobs) == 1
    job = jobs[0]
    assert job.title == "Développeur WordPress"
    assert job.company == "Entreprise Anonyme"
    assert job.location == "Sousse Jaouhara, Sousse"
    assert job.url == f"{BASE_URL}/offres-emploi/244465/developpeur-wordpress-hf-sousse/"
    assert job.source == "keejob"
    assert job.posted_date == "2026-08-04"
    assert job.job_type == "full_time"
    assert job.salary == "1000 - 1111 TND"
    assert job.description == "Vous interviendrez sur la refonte et la maintenance de notre site institutionnel."
    assert not job.remote


def test_parse_listing_html_skips_non_job_links() -> None:
    html = SAMPLE_PAGE.replace(
        "/offres-emploi/244465/developpeur-wordpress-hf-sousse/",
        "/formations/advanced/",
    )
    jobs = KeejobAdapter()._parse_listing_html(html)
    assert jobs == []


def test_parse_listing_html_remote_detection() -> None:
    html = SAMPLE_PAGE.replace(
        "Vous interviendrez", "Travail à distance. Vous interviendrez"
    )
    jobs = KeejobAdapter()._parse_listing_html(html)
    assert jobs[0].remote is True


def test_search_jobs_fetches_two_pages(respx_mock: respx.MockRouter) -> None:
    """Search hits page 1 and page 2 and dedupes by URL."""
    page_2 = SAMPLE_PAGE.replace(
        "/offres-emploi/244465/developpeur-wordpress-hf-sousse/",
        "/offres-emploi/244466/autre-offre/",
    ).replace("Développeur WordPress", "Développeur Python")
    route = respx.get(url__startswith=LISTINGS_URL)
    route.mock(
        side_effect=[
            httpx.Response(200, text=SAMPLE_PAGE),
            httpx.Response(200, text=page_2),
        ]
    )

    jobs = _run(
        KeejobAdapter().search_jobs(
            "developpeur", JobSearchFilters(keywords="developpeur", max_pages=2)
        )
    )

    assert len(jobs) == 2
    assert {j.title for j in jobs} == {"Développeur WordPress", "Développeur Python"}
    # Second request carried the page param
    assert route.calls[1].request.url.params["page"] == "2"
    # Country param is always sent
    assert route.calls[0].request.url.params["country"] == "788"


def test_search_jobs_filters_job_types(respx_mock: respx.MockRouter) -> None:
    """JobType filters are mapped to keejob contract-type ids."""
    route = respx.get(url__startswith=LISTINGS_URL)
    route.mock(return_value=httpx.Response(200, text=SAMPLE_PAGE))

    filters = JobSearchFilters(
        keywords="dev",
        job_types=[JobType.FULL_TIME, JobType.FREELANCE],
        max_pages=1,
    )
    _run(KeejobAdapter().search_jobs("dev", filters))

    assert route.called
    request = route.calls[0].request
    assert set(request.url.params.get_list("job_types")) == {"1", "5"}


def test_search_jobs_handles_failure(respx_mock: respx.MockRouter) -> None:
    """A non-200 listing returns no jobs without raising."""
    respx.get(url__startswith=LISTINGS_URL).mock(return_value=httpx.Response(500))

    jobs = _run(
        KeejobAdapter().search_jobs("dev", JobSearchFilters(keywords="dev", max_pages=1))
    )
    assert jobs == []


def test_parse_posted_date() -> None:
    assert _parse_posted_date("4 août 2026") == "2026-08-04"
    assert _parse_posted_date("31 juillet 2026") == "2026-07-31"
    assert _parse_posted_date("1 mars 2025") == "2025-03-01"
    assert _parse_posted_date("Aujourd'hui") is not None
    assert _parse_posted_date("") is None
    assert _parse_posted_date(None) is None
    assert _parse_posted_date("n'importe quoi") is None


def test_clean() -> None:
    assert _clean("  a \n  b ") == "a b"
