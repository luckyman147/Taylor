"""Retry with exponential backoff and jitter."""

from __future__ import annotations

import asyncio
import logging
import random

logger = logging.getLogger(__name__)


async def retry_with_backoff(
    func,  # type: ignore[no-untyped-def]
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    jitter_factor: float = 0.1,
):
    """Execute *func* with exponential backoff on failure.

    Delays: 1s, 2s, 4s ... capped at *max_delay*.  Each delay gets
    +/- *jitter_factor* randomised to avoid thundering-herd effects.
    """
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            return await func()
        except Exception as exc:
            last_exc = exc
            if attempt == max_retries - 1:
                break
            delay = min(base_delay * (2**attempt), max_delay)
            jitter = delay * jitter_factor * (2 * random.random() - 1)
            sleep_time = delay + jitter
            logger.debug(
                "Retry %d/%d after %.1fs (error: %s)",
                attempt + 1,
                max_retries,
                sleep_time,
                exc,
            )
            await asyncio.sleep(sleep_time)
    raise last_exc  # type: ignore[misc]
