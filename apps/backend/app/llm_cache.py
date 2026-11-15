"""Content-addressed TTL memoization for deterministic LLM calls.

Every entry is keyed by a SHA-256 of the exact inputs (prompt + params), so a
cache hit can only ever replay the answer to *the same question* — no stale
cross-context results. Use only for calls whose output is a pure function of
their input (keyword extraction, classification, synthesis over fixed text);
never for free-form generation that should differ per request.

Concurrent callers with the same key share one in-flight computation (per-key
lock), so an ``asyncio.gather`` burst costs a single upstream request.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = 3600.0
MAX_ENTRIES = 256

_store: "OrderedDict[str, tuple[float, Any]]" = OrderedDict()
_locks: dict[str, asyncio.Lock] = {}
_inflight: dict[str, "asyncio.Future[Any]"] = {}


def make_key(*parts: object) -> str:
    """Stable SHA-256 key over JSON-serialized parts."""
    payload = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get(key: str) -> Any | None:
    """Return a live cached value, evicting the entry if expired."""
    entry = _store.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at <= time.monotonic():
        _store.pop(key, None)
        return None
    _store.move_to_end(key)
    return value


def set(key: str, value: Any, ttl: float = DEFAULT_TTL_SECONDS) -> None:
    """Store a value, evicting the oldest entries beyond MAX_ENTRIES."""
    _store[key] = (time.monotonic() + ttl, value)
    _store.move_to_end(key)
    while len(_store) > MAX_ENTRIES:
        _store.popitem(last=False)


async def get_or_compute(
    key: str,
    factory: Callable[[], Awaitable[Any]],
    ttl: float = DEFAULT_TTL_SECONDS,
) -> Any:
    """Return the cached value or compute it once for concurrent callers."""
    cached = get(key)
    if cached is not None:
        return cached

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = get(key)
        if cached is not None:
            return cached
        value = await factory()
        if value is not None:
            set(key, value, ttl)
        return value


def invalidate() -> None:
    """Drop everything (call when prompts/model config change)."""
    _store.clear()
    _locks.clear()
    _inflight.clear()


async def coalesce(key: str, factory: Callable[[], Awaitable[Any]]) -> Any:
    """Single-flight: concurrent callers with the same key share ONE in-flight
    computation, and nothing is retained once it settles.

    Unlike :func:`get_or_compute` this never caches — a later, separate call
    always recomputes. Use it for expensive user-visible generations where a
    duplicate (double-click, retried request) must not double-bill the LLM,
    but where serving a stale result afterwards would be wrong (e.g. the
    "Regenerate" button must actually generate a new draft).

    The waiter awaits the leader's future through a shield so cancelling a
    waiter can never cancel the leader's shared future.
    """
    existing = _inflight.get(key)
    if existing is not None:
        return await asyncio.shield(existing)

    # Check + register happen synchronously (no await between them), so two
    # tasks can never both become leaders for the same key.
    fut: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
    # Retrieve exceptions eagerly so a leader-only failure with no waiters
    # doesn't log "Future exception was never retrieved".
    fut.add_done_callback(lambda f: None if f.cancelled() else f.exception())
    _inflight[key] = fut
    try:
        value = await factory()
    except BaseException as exc:
        if not fut.done():
            fut.set_exception(exc)
        raise
    else:
        if not fut.done():
            fut.set_result(value)
        return value
    finally:
        _inflight.pop(key, None)


def stats() -> dict[str, int]:
    """Entry count for observability."""
    return {"entries": len(_store), "max_entries": MAX_ENTRIES}
