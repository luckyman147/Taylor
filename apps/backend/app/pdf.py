"""PDF rendering utilities using headless Chromium."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Awaitable, NoReturn, Optional

from playwright.async_api import (
    Browser,
    Error as PlaywrightError,
    Page,
    Playwright,
    async_playwright,
)

logger = logging.getLogger(__name__)

# Explicit, bounded navigation/selector timeout. Chosen over Playwright's
# implicit 30s default so a slow-but-working render (large resume, cold cache,
# modest hardware) still completes, while a genuinely stuck page still fails
# in finite time rather than hanging.
_NAV_TIMEOUT_MS = 60_000


class PDFRenderError(Exception):
    """Custom exception for PDF rendering errors with helpful messages."""

    pass


_playwright = None
_browser: Optional[Browser] = None
_init_lock = asyncio.Lock()  # Lock to prevent race condition during initialization
_subprocess_lock = asyncio.Lock()
_subprocess_supported = True

# One quick retry when the Playwright driver (node) subprocess dies right
# after spawn — transient on Windows (AV/resource contention) and it surfaces
# as a plain Exception, not a playwright Error.
_DRIVER_RETRY_DELAY = 1.0
_DRIVER_CLOSED_MSG = "Connection closed while reading from the driver"


def _is_driver_connection_error(error: BaseException) -> bool:
    """True when the Playwright driver subprocess died mid-connection.

    Playwright raises this as a *plain* Exception (see
    ``playwright/_impl/_transport.py``), so it is NOT a ``playwright.Error``
    and would otherwise escape every ``except PlaywrightError`` handler as a
    raw ASGI 500 with a full traceback.
    """
    return _DRIVER_CLOSED_MSG in str(error)


async def _dispose_renderer_state() -> None:
    """Best-effort teardown of the module-global browser/driver state.

    Used when the persistent driver died: close anything half-open, swallow
    secondary errors from the dead connection, and clear the globals so the
    next call re-initializes from scratch. Never raises.
    """
    global _playwright, _browser
    browser, playwright = _browser, _playwright
    _browser = None
    _playwright = None
    if browser is not None:
        try:
            await asyncio.wait_for(browser.close(), timeout=5)
        except Exception:
            pass
    if playwright is not None:
        try:
            await asyncio.wait_for(playwright.stop(), timeout=5)
        except Exception:
            pass


async def init_pdf_renderer() -> None:
    """Initialize the Playwright browser instance.

    Uses asyncio.Lock to prevent race conditions when multiple
    concurrent requests try to initialize the browser simultaneously.
    Retries once when the driver connection drops during startup.
    """
    global _playwright, _browser

    # Fast path: already initialized
    if _browser is not None:
        return

    # Use lock to prevent race condition during initialization
    async with _init_lock:
        # Double-check after acquiring lock
        if _browser is not None:
            return
        for attempt in (0, 1):
            started = None
            try:
                started = await async_playwright().start()
                _playwright = started
                _browser = await _launch_browser(_playwright)
                return
            except Exception as e:
                # Drop any half-open state so the retry (or the next request)
                # starts clean instead of reusing a dead driver.
                _playwright = None
                _browser = None
                if started is not None:
                    try:
                        await asyncio.wait_for(started.stop(), timeout=5)
                    except Exception:
                        pass
                if attempt == 0 and _is_driver_connection_error(e):
                    logger.warning(
                        "Playwright driver connection dropped during init; "
                        "retrying once: %s",
                        e,
                    )
                    await asyncio.sleep(_DRIVER_RETRY_DELAY)
                    continue
                raise


def _resolve_pdf_format(page_size: str) -> str:
    format_map = {
        "A4": "A4",
        "LETTER": "Letter",
    }
    return format_map.get(page_size, "A4")


def _resolve_pdf_margins(margins: Optional[dict]) -> dict:
    if margins:
        return {
            "top": f"{margins.get('top', 10)}mm",
            "right": f"{margins.get('right', 10)}mm",
            "bottom": f"{margins.get('bottom', 10)}mm",
            "left": f"{margins.get('left', 10)}mm",
        }
    return {"top": "10mm", "right": "10mm", "bottom": "10mm", "left": "10mm"}


def _find_chromium_executable() -> Optional[str]:
    """Find system Chrome/Chromium/Edge executable across platforms."""
    if sys.platform == "win32":
        candidates = [
            Path(os.environ.get("PROGRAMFILES", "C:/Program Files"))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)"))
            / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES", "C:/Program Files"))
            / "Microsoft/Edge/Application/msedge.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)"))
            / "Microsoft/Edge/Application/msedge.exe",
        ]
    elif sys.platform == "darwin":
        # macOS application paths
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ]
    else:
        # Linux paths: standard locations, Snap, and Flatpak
        candidates = [
            Path("/usr/bin/google-chrome"),
            Path("/usr/bin/google-chrome-stable"),
            Path("/usr/bin/chromium"),
            Path("/usr/bin/chromium-browser"),
            Path("/usr/bin/microsoft-edge"),
            Path("/snap/bin/chromium"),
            Path("/var/lib/flatpak/exports/bin/com.google.Chrome"),
            Path("/var/lib/flatpak/exports/bin/org.chromium.Chromium"),
            Path(os.path.expanduser("~/.local/share/flatpak/exports/bin/com.google.Chrome")),
            Path(os.path.expanduser("~/.local/share/flatpak/exports/bin/org.chromium.Chromium")),
        ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


async def _launch_browser(playwright: Playwright) -> Browser:
    try:
        return await playwright.chromium.launch()
    except PlaywrightError as e:
        if "Executable doesn't exist" not in str(e):
            raise
        fallback_executable = _find_chromium_executable()
        if not fallback_executable:
            raise PDFRenderError(
                "Playwright browser executable is missing, and no system Chrome/Edge "
                "installation was found. Install Playwright browsers or install Chrome/Edge."
            ) from e
        return await playwright.chromium.launch(executable_path=fallback_executable)


async def _render_page_to_pdf(
    page: Page,
    url: str,
    selector: str,
    pdf_format: str,
    pdf_margins: dict,
) -> bytes:
    # NOTE: do NOT use wait_until="networkidle" here. The Next.js dev server
    # (HMR/Turbopack + RSC streaming) keeps the network busy, so "idle" may
    # never arrive and goto silently hangs until timeout → 503 (issues
    # #799/#808), with the failure depending on environment/network noise.
    # Wait on the real readiness condition instead — document "load", the
    # resume content selector, and fonts — all bounded by an explicit timeout
    # so the outcome is deterministic.
    await page.goto(url, wait_until="load", timeout=_NAV_TIMEOUT_MS)
    await page.wait_for_selector(selector, timeout=_NAV_TIMEOUT_MS)
    # Bound the fonts wait too — plain page.evaluate has no timeout, so a stuck
    # font load could otherwise hang the render past _NAV_TIMEOUT_MS.
    await page.wait_for_function(
        "() => document.fonts.ready.then(() => true)", timeout=_NAV_TIMEOUT_MS
    )
    # Wait for all images (e.g. avatar) to finish loading before generating PDF.
    await page.wait_for_function(
        "() => Array.from(document.images).every(img => img.complete)",
        timeout=_NAV_TIMEOUT_MS,
    )
    return await page.pdf(
        format=pdf_format,
        print_background=True,
        margin=pdf_margins,
    )


async def _render_with_browser(
    browser: Browser,
    url: str,
    selector: str,
    pdf_format: str,
    pdf_margins: dict,
) -> bytes:
    page: Page = await browser.new_page()
    try:
        return await _render_page_to_pdf(page, url, selector, pdf_format, pdf_margins)
    finally:
        # Never let page teardown clobber an already-successful render or the
        # real error (a dead driver fails close() too).
        try:
            await page.close()
        except Exception:
            pass


def _run_in_new_loop(coro: Awaitable[bytes]) -> bytes:
    if sys.platform == "win32":
        from asyncio.windows_events import ProactorEventLoop

        loop = ProactorEventLoop()
    else:
        loop = asyncio.new_event_loop()

    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        finally:
            loop.close()
            asyncio.set_event_loop(None)


def _render_resume_pdf_sync(
    url: str,
    selector: str,
    pdf_format: str,
    pdf_margins: dict,
) -> bytes:
    async def _run() -> bytes:
        for attempt in (0, 1):
            try:
                async with async_playwright() as playwright:
                    browser = await _launch_browser(playwright)
                    try:
                        return await _render_with_browser(
                            browser, url, selector, pdf_format, pdf_margins
                        )
                    finally:
                        # A dead driver also fails close(); never let teardown
                        # clobber an already-successful render (or the real
                        # error we want to retry on).
                        try:
                            await browser.close()
                        except Exception:
                            pass
            except Exception as e:
                # Fresh driver per attempt: if the driver subprocess died at
                # startup, retry once with a clean one before failing.
                if attempt == 0 and _is_driver_connection_error(e):
                    logger.warning(
                        "Playwright driver died during render; retrying once: %s",
                        e,
                    )
                    await asyncio.sleep(_DRIVER_RETRY_DELAY)
                    continue
                raise

    return _run_in_new_loop(_run())


async def _render_resume_pdf_in_thread(
    url: str,
    selector: str,
    pdf_format: str,
    pdf_margins: dict,
) -> bytes:
    return await asyncio.to_thread(
        _render_resume_pdf_sync, url, selector, pdf_format, pdf_margins
    )


def _raise_playwright_error(error: Exception, url: str) -> NoReturn:
    # Already-mapped errors pass through unchanged (keeps the curated
    # "executable missing" message instead of the generic fallback).
    if isinstance(error, PDFRenderError):
        raise error
    # NotImplementedError signals "this loop can't spawn subprocesses" — the
    # caller uses it to switch to the thread-based renderer, so it must
    # propagate raw (also relied on by the test suite's skip logic).
    if isinstance(error, NotImplementedError):
        raise error
    error_msg = str(error)
    if "Executable doesn't exist" in error_msg:
        exe = sys.executable.replace("\\", "/")
        command = f"{exe} -m playwright install chromium"
        raise PDFRenderError(
            "Playwright browser executable is missing or out of date. "
            "Command shown for reference; quote the path if it contains spaces: "
            f"{command}"
        ) from error
    if "net::ERR_CONNECTION_REFUSED" in error_msg:
        raise PDFRenderError(
            f"Cannot connect to frontend for PDF generation. "
            f"Attempted URL: {url}. "
            f"Please ensure: 1) The frontend is running, "
            f"2) The FRONTEND_BASE_URL environment variable in the backend .env file "
            f"matches the URL where your frontend is accessible."
        ) from error
    # Catch-all: the raw Playwright message can carry internal navigation URLs
    # and a full call log. Log it server-side; return a generic message to the
    # client (CLAUDE.md rule 5 — and it stops the verbose trace from overflowing
    # the client error modal, #811).
    logger.error("PDF rendering failed for %s: %s", url, error_msg)
    raise PDFRenderError(
        "PDF rendering failed. Please try again, or try a simpler resume or a "
        "different template."
    ) from error


def _loop_supports_subprocess() -> bool:
    if sys.platform != "win32":
        return True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return True
    return loop.__class__.__name__ == "ProactorEventLoop"


async def close_pdf_renderer() -> None:
    """Close the Playwright browser instance."""
    global _playwright, _browser
    if _browser is not None:
        await _browser.close()
        _browser = None
    if _playwright is not None:
        await _playwright.stop()
        _playwright = None


async def render_resume_pdf(
    url: str,
    page_size: str = "A4",
    selector: str = ".resume-print",
    margins: Optional[dict] = None,
) -> bytes:
    """Render a URL to PDF bytes.

    Args:
        url: The URL to render (print route)
        page_size: Page size format - "A4" or "LETTER"
        selector: CSS selector to wait for before rendering (default: ".resume-print")
        margins: Page margins dict with top/right/bottom/left in mm (applied to every page)

    Note:
        Margins are applied via Playwright's PDF margins, ensuring they appear
        on every page (not just the first page like HTML padding would).
    """
    global _subprocess_supported

    pdf_format = _resolve_pdf_format(page_size)
    pdf_margins = _resolve_pdf_margins(margins)

    if _browser is not None:
        try:
            return await _render_with_browser(_browser, url, selector, pdf_format, pdf_margins)
        except Exception as e:
            if not _is_driver_connection_error(e):
                _raise_playwright_error(e, url)
            # Persistent driver died mid-render: tear down the dead state and
            # fall through to the init path, which re-launches (and itself
            # retries once on driver death).
            logger.error(
                "Persistent Playwright driver died mid-render; reinitializing: %s", e
            )
            await _dispose_renderer_state()

    async with _subprocess_lock:
        subprocess_supported = _subprocess_supported
        if subprocess_supported and not _loop_supports_subprocess():
            _subprocess_supported = False
            subprocess_supported = False
            logger.warning(
                "PDF: event loop %s lacks subprocess support; using the "
                "per-request renderer for the rest of this process (uvicorn "
                "picks SelectorEventLoop on Windows when --reload or "
                "workers > 1 is used).",
                asyncio.get_running_loop().__class__.__name__,
            )

    if subprocess_supported:
        try:
            await init_pdf_renderer()
        except NotImplementedError:
            async with _subprocess_lock:
                _subprocess_supported = False
            subprocess_supported = False
            logger.warning(
                "PDF: loop cannot spawn subprocesses (NotImplementedError); "
                "using the per-request renderer for the rest of this process."
            )
        except Exception as e:
            _raise_playwright_error(e, url)

    if not subprocess_supported:
        try:
            return await _render_resume_pdf_in_thread(
                url, selector, pdf_format, pdf_margins
            )
        except Exception as e:
            _raise_playwright_error(e, url)

    if _browser is None:
        raise PDFRenderError("PDF renderer failed to initialize.")

    try:
        return await _render_with_browser(_browser, url, selector, pdf_format, pdf_margins)
    except Exception as e:
        _raise_playwright_error(e, url)
