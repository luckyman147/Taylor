"""Render smoke tests for app/pdf.py — the 'resume won't render' incident class.

A live demo of Resume-Matcher once broke a YouTuber's stream because PDF
rendering failed. These tests give real coverage to the render path:

* Pure helpers (format/margins) always run — no browser required.
* A real headless-Chromium render proves the happy path actually emits PDF
  bytes (magic header + non-trivial size), not just "no exception".

The real frontend is not available under test, so the render targets a
self-contained ``data:`` URL that already contains the ``.resume-print``
selector. ``networkidle`` and ``wait_for_selector`` both resolve on a static
data: URL, exercising the same goto → wait → page.pdf flow as production.

Real-render tests skip cleanly (never hard-fail) when no Chromium binary can
be launched.
"""

import asyncio
import socket
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from playwright.async_api import Error as PlaywrightError

import app.pdf as pdf
from app.pdf import (
    PDFRenderError,
    _raise_playwright_error,
    _render_page_to_pdf,
    _resolve_pdf_format,
    _resolve_pdf_margins,
    _render_resume_pdf_sync,
    close_pdf_renderer,
    init_pdf_renderer,
    render_resume_pdf,
)

DRIVER_DEATH = Exception("Connection closed while reading from the driver")


# A self-contained page that satisfies wait_for_selector(".resume-print")
# without needing the real frontend running.
RESUME_PRINT_DATA_URL = (
    "data:text/html,"
    "<html><body><div class='resume-print'>Hello PDF</div></body></html>"
)


def _refused_url():
    """Return a URL on a closed, connection-refusing localhost port.

    Bind an ephemeral port to claim a free number, read it, then CLOSE the
    socket: with nothing bound, the kernel answers a connect with RST, so
    Chromium navigation fails fast with net::ERR_CONNECTION_REFUSED — the signal
    this test needs.

    We deliberately close rather than hold the socket bound-but-unlistening:
    that was tried, and on macOS a bound, non-listening socket does NOT refuse —
    the SYN is dropped and Chromium hangs until its 30s navigation timeout (a
    different, slower failure path), so the test would stop exercising
    connection-refused. The residual window between close() and connect() is
    sub-millisecond on a loopback ephemeral port, and a collision would only
    *delay* the same failure, never mask it. (Port 9/discard is on Chromium's
    unsafe-ports blocklist and yields ERR_UNSAFE_PORT, which also doesn't
    exercise this mapping.)
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"http://127.0.0.1:{port}/"


async def _render_or_skip(url, **kwargs):
    """Render ``url`` to PDF, or skip the test if Chromium is unavailable.

    Distinguishes "Chromium can't launch" (skip — environment limitation) from
    a genuine render/navigation failure (re-raise — that's the bug we test for).
    A missing-browser failure surfaces as a PDFRenderError mentioning the
    executable, or as a raw PlaywrightError about a missing executable.
    """
    try:
        return await render_resume_pdf(url, **kwargs)
    except PDFRenderError as exc:
        if "executable" in str(exc).lower():
            pytest.skip(f"chromium unavailable: {exc}")
        raise
    except PlaywrightError as exc:
        if "Executable doesn't exist" in str(exc):
            pytest.skip(f"chromium unavailable: {exc}")
        raise
    except NotImplementedError as exc:
        # Subprocess launch unsupported on this event loop policy.
        pytest.skip(f"chromium subprocess launch unsupported: {exc}")


class TestResolvePdfFormat:
    """_resolve_pdf_format — page-size string → Playwright PDF format."""

    def test_a4_maps_to_a4(self):
        assert _resolve_pdf_format("A4") == "A4"

    def test_letter_maps_to_letter(self):
        # Note the case change: input "LETTER" → Playwright's "Letter".
        assert _resolve_pdf_format("LETTER") == "Letter"

    def test_unknown_defaults_to_a4(self):
        assert _resolve_pdf_format("TABLOID") == "A4"

    def test_empty_string_defaults_to_a4(self):
        assert _resolve_pdf_format("") == "A4"


class TestResolvePdfMargins:
    """_resolve_pdf_margins — margin dict → mm-suffixed Playwright margins."""

    def test_none_returns_ten_mm_on_all_sides(self):
        assert _resolve_pdf_margins(None) == {
            "top": "10mm",
            "right": "10mm",
            "bottom": "10mm",
            "left": "10mm",
        }

    def test_empty_dict_falls_back_to_defaults(self):
        # Empty dict is falsy, so it takes the same default path as None.
        assert _resolve_pdf_margins({}) == {
            "top": "10mm",
            "right": "10mm",
            "bottom": "10mm",
            "left": "10mm",
        }

    def test_custom_values_are_formatted_as_mm(self):
        result = _resolve_pdf_margins(
            {"top": 20, "right": 15, "bottom": 25, "left": 5}
        )
        assert result == {
            "top": "20mm",
            "right": "15mm",
            "bottom": "25mm",
            "left": "5mm",
        }

    def test_partial_dict_fills_missing_sides_with_ten(self):
        # Provided keys win; absent keys default to 10mm.
        result = _resolve_pdf_margins({"top": 30})
        assert result == {
            "top": "30mm",
            "right": "10mm",
            "bottom": "10mm",
            "left": "10mm",
        }


class TestRenderPageWaitStrategy:
    """#799/#808: rendering must wait on a deterministic readiness condition
    (document 'load' + the resume content selector + fonts), NOT the
    environment-fragile 'networkidle' that hangs against the Next.js dev server
    (HMR/Turbopack/RSC streaming keep the network busy, so idle never arrives →
    30s timeout → 503). These are browser-free: they mock the Playwright Page.
    """

    async def test_goto_uses_load_with_bounded_timeout(self):
        page = AsyncMock()
        page.pdf.return_value = b"%PDF-1.4 fake"
        await _render_page_to_pdf(page, "http://f/print/r", ".resume-print", "A4", {"top": "10mm"})
        _, goto_kwargs = page.goto.call_args
        assert goto_kwargs.get("wait_until") == "load"
        # An explicit, positive, bounded navigation timeout (not the fragile default).
        timeout = goto_kwargs.get("timeout")
        assert isinstance(timeout, (int, float)) and timeout > 0

    async def test_still_gates_on_content_selector(self):
        """The real readiness signal — the resume content must be present."""
        page = AsyncMock()
        page.pdf.return_value = b"%PDF-1.4 fake"
        await _render_page_to_pdf(page, "http://f/print/r", ".resume-print", "A4", {"top": "10mm"})
        page.wait_for_selector.assert_awaited()
        selector_arg = page.wait_for_selector.call_args.args[0]
        assert selector_arg == ".resume-print"

    async def test_still_waits_for_fonts_bounded(self):
        """Fonts must be loaded before snapshot (else text renders unstyled), and
        the wait must be bounded by the nav timeout — not Playwright's default."""
        page = AsyncMock()
        page.pdf.return_value = b"%PDF-1.4 fake"
        await _render_page_to_pdf(page, "http://f/print/r", ".resume-print", "A4", {"top": "10mm"})
        page.wait_for_function.assert_awaited()
        assert "fonts" in page.wait_for_function.call_args.args[0]
        assert page.wait_for_function.call_args.kwargs.get("timeout")


class TestPlaywrightErrorMapping:
    """#811 + info-disclosure (CLAUDE.md rule 5): the catch-all must NOT leak raw
    Playwright internals (call log, internal navigation URLs) to the client;
    curated, safe messages must be preserved.
    """

    def test_catch_all_is_generic_and_hides_internals(self):
        raw = (
            "Page.goto: Timeout 30000ms exceeded.\n"
            "Call log:\n"
            '  - navigating to "http://localhost:3000/print/resumes/SECRET-RESUME-ID"'
        )
        with pytest.raises(PDFRenderError) as exc_info:
            _raise_playwright_error(PlaywrightError(raw), "http://localhost:3000/print/resumes/SECRET-RESUME-ID")
        msg = str(exc_info.value)
        assert "Call log" not in msg
        assert "SECRET-RESUME-ID" not in msg
        assert "30000ms" not in msg

    def test_connection_refused_message_preserved(self):
        with pytest.raises(PDFRenderError) as exc_info:
            _raise_playwright_error(
                PlaywrightError("net::ERR_CONNECTION_REFUSED at http://localhost:3000"),
                "http://localhost:3000/print/x",
            )
        assert "cannot connect to frontend" in str(exc_info.value).lower()

    def test_missing_executable_message_preserved(self):
        with pytest.raises(PDFRenderError) as exc_info:
            _raise_playwright_error(
                PlaywrightError("Executable doesn't exist at /ms-playwright/chromium"),
                "http://x/",
            )
        assert "playwright install" in str(exc_info.value).lower()


class TestRenderResumePdf:
    """render_resume_pdf — real headless-Chromium render of a self-contained page.

    These require a launchable Chromium and skip cleanly when one is absent.
    Teardown tears down the module-global browser so a leaked process can't
    bleed into other tests.
    """

    @pytest.fixture(autouse=True)
    async def _teardown_renderer(self):
        # Yield first; close the shared browser after every test in this class.
        yield
        await close_pdf_renderer()

    async def test_renders_valid_pdf_bytes(self):
        """THE proof rendering works: real PDF magic header + non-trivial size."""
        pdf = await _render_or_skip(RESUME_PRINT_DATA_URL)
        assert isinstance(pdf, (bytes, bytearray))
        assert pdf[:4] == b"%PDF"
        assert len(pdf) > 1000

    async def test_renders_letter_size_with_custom_margins(self):
        """Format + margins flow through into a valid render (LETTER, custom mm)."""
        pdf = await _render_or_skip(
            RESUME_PRINT_DATA_URL,
            page_size="LETTER",
            margins={"top": 20, "right": 15, "bottom": 20, "left": 15},
        )
        assert pdf[:4] == b"%PDF"
        assert len(pdf) > 1000


class TestRenderResumePdfErrors:
    """render_resume_pdf error mapping — connection failures become PDFRenderError."""

    @pytest.fixture(autouse=True)
    async def _teardown_renderer(self):
        yield
        await close_pdf_renderer()

    async def test_connection_refused_raises_pdf_render_error(self):
        """A refused target must surface as PDFRenderError, not a raw Playwright
        error — this is the 'cannot connect to frontend' incident path.

        Skips only when Chromium itself can't launch (it still needs a browser
        to *attempt* the connection); a genuine connection failure must raise.
        """
        try:
            with pytest.raises(PDFRenderError) as exc_info:
                await render_resume_pdf(_refused_url())
        except PlaywrightError as exc:
            if "Executable doesn't exist" in str(exc):
                pytest.skip(f"chromium unavailable: {exc}")
            raise
        # The browser launched but couldn't reach the frontend — but if the only
        # failure was a missing executable surfaced as PDFRenderError, treat that
        # as a skip rather than a false-positive pass.
        message = str(exc_info.value).lower()
        if "executable" in message:
            pytest.skip(f"chromium unavailable: {exc_info.value}")
        assert "cannot connect to frontend" in message


class TestDriverDeathResilience:
    """The Playwright driver (node) dying right after spawn raises a PLAIN
    Exception (playwright/_impl/_transport.py), not a playwright.Error — it
    used to escape every handler as a raw ASGI 500 (the 'Connection closed
    while reading from the driver' incident). Rendering must instead retry
    once with a fresh driver and, if it still dies, map to a generic
    PDFRenderError with no internals leaked.
    """

    @pytest.fixture(autouse=True)
    def _reset_renderer_state(self, monkeypatch):
        monkeypatch.setattr(pdf, "_DRIVER_RETRY_DELAY", 0.0)
        yield
        pdf._browser = None
        pdf._playwright = None
        pdf._subprocess_supported = True

    async def test_init_retries_once_after_driver_death(self):
        """A driver death during init must not fail the first attempt's caller:
        init starts a fresh driver once before giving up."""
        state = SimpleNamespace(starts=0)

        class _FakePlaywright:
            async def stop(self):
                pass

        class _FakeCM:
            async def start(self):
                state.starts += 1
                if state.starts == 1:
                    raise DRIVER_DEATH
                return _FakePlaywright()

        sentinel_browser = object()
        with (
            pytest.MonkeyPatch.context() as mp,
            _fake_driver(mp, cm=_FakeCM(), browser=sentinel_browser),
        ):
            await init_pdf_renderer()

        assert state.starts == 2
        assert pdf._browser is sentinel_browser

    async def test_init_gives_up_after_second_driver_death(self):
        """Two consecutive deaths: init re-raises (mapped upstream) and leaves
        no half-initialized globals behind."""
        state = SimpleNamespace(starts=0)

        class _AlwaysDead:
            async def start(self):
                state.starts += 1
                raise DRIVER_DEATH

        with pytest.MonkeyPatch.context() as mp, _fake_driver(mp, cm=_AlwaysDead()):
            with pytest.raises(Exception, match="Connection closed"):
                await init_pdf_renderer()

        assert state.starts == 2
        assert pdf._browser is None
        assert pdf._playwright is None

    async def test_sync_render_retries_once_after_driver_death(self):
        """The thread-fallback renderer (per-request driver) must also retry
        once — this is the path taken under `uvicorn --reload` on Windows.
        Runs via to_thread like production, so its private event loop can't
        disturb the test runner's loop bookkeeping."""
        state = SimpleNamespace(attempts=0)

        class _FakeCM:
            async def __aenter__(self):
                state.attempts += 1
                if state.attempts == 1:
                    raise DRIVER_DEATH
                return SimpleNamespace()

            async def __aexit__(self, *exc_info):
                return False

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(pdf, "async_playwright", lambda: _FakeCM())
            mp.setattr(
                pdf, "_launch_browser", AsyncMock(return_value=AsyncMock())
            )
            mp.setattr(
                pdf, "_render_with_browser", AsyncMock(return_value=b"%PDF-1.4 fake")
            )
            result = await asyncio.to_thread(
                _render_resume_pdf_sync,
                "http://x/print",
                ".resume-print",
                "A4",
                {"top": "10mm"},
            )

        assert result == b"%PDF-1.4 fake"
        assert state.attempts == 2

    async def test_driver_death_after_retries_maps_to_generic_error(self):
        """Exhausted retries must surface as the curated generic PDFRenderError —
        never the raw driver text (CLAUDE.md rule 2, info-disclosure)."""
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(pdf, "_browser", None)
            mp.setattr(pdf, "_playwright", None)
            mp.setattr(pdf, "_subprocess_supported", True)
            mp.setattr(pdf, "_loop_supports_subprocess", lambda: True)
            mp.setattr(
                pdf,
                "init_pdf_renderer",
                AsyncMock(side_effect=DRIVER_DEATH),
            )
            with pytest.raises(PDFRenderError) as exc_info:
                await render_resume_pdf("http://x/print")

        message = str(exc_info.value)
        assert "PDF rendering failed" in message
        assert "Connection closed" not in message

    async def test_driver_death_on_persistent_browser_reinitializes(self):
        """A dead persistent driver must not poison the renderer: the dead
        state is torn down, re-initialized, and the render retried."""
        dead_browser = SimpleNamespace(close=AsyncMock())
        dead_driver = SimpleNamespace(stop=AsyncMock())
        fresh_browser = object()

        async def _fake_init():
            pdf._browser = fresh_browser
            pdf._playwright = SimpleNamespace(stop=AsyncMock())

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(pdf, "_browser", dead_browser)
            mp.setattr(pdf, "_playwright", dead_driver)
            mp.setattr(pdf, "_subprocess_supported", True)
            mp.setattr(pdf, "_loop_supports_subprocess", lambda: True)
            mp.setattr(pdf, "init_pdf_renderer", _fake_init)
            render_mock = AsyncMock(side_effect=[DRIVER_DEATH, b"%PDF-1.4 healed"])
            mp.setattr(pdf, "_render_with_browser", render_mock)
            result = await render_resume_pdf("http://x/print")

        assert result == b"%PDF-1.4 healed"
        assert render_mock.await_count == 2
        # Dead state was actually torn down (best-effort, never raises).
        dead_browser.close.assert_awaited()
        dead_driver.stop.assert_awaited()


def _fake_driver(mp, cm=None, browser=None):
    """Patch app.pdf's Playwright factory (and launcher) for init tests."""
    if cm is not None:
        mp.setattr(pdf, "async_playwright", lambda: cm)
    mp.setattr(
        pdf,
        "_launch_browser",
        AsyncMock(return_value=browser if browser is not None else object()),
    )
    return nullcontext()
