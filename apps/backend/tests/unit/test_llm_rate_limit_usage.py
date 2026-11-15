"""Unit tests for LLM rate-limit discipline, usage accounting, and llm_cache.

Covers the rate-limit optimisation work:
- ``rate_limit_wait``: Retry-After-aware single-extra-attempt helper
- global concurrency semaphore in ``app.llm`` (burst suppression)
- per-call token usage counters (``record_llm_usage`` / ``get_llm_usage``)
- Router RPM pacing wiring (``LLM_RPM`` → pre-call check)
- ``app.llm_cache`` memoization (dedupe, TTL, eviction)
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import litellm
import pytest
from fastapi import HTTPException

import app.llm as llm
from app import llm_cache
from app.llm import LLMConfig


def _usage_response(prompt: int, completion: int) -> SimpleNamespace:
    """Minimal LiteLLM-shaped response carrying a usage block."""
    return SimpleNamespace(
        usage=SimpleNamespace(prompt_tokens=prompt, completion_tokens=completion)
    )


@pytest.fixture(autouse=True)
def _clean_state():
    """Keep global usage counters and the memo store isolated per test."""
    llm.reset_llm_usage()
    llm_cache.invalidate()
    yield
    llm.reset_llm_usage()
    llm_cache.invalidate()


# ---------------------------------------------------------------------------
# rate_limit_wait
# ---------------------------------------------------------------------------


class TestRateLimitWait:
    def test_non_rate_limit_error_returns_none(self):
        assert llm.rate_limit_wait(ValueError("No JSON found in response")) is None

    def test_bare_429_message_uses_default_wait(self):
        assert llm.rate_limit_wait(Exception("429 Too Many Requests")) == 15.0

    def test_quota_message_detected(self):
        assert llm.rate_limit_wait(Exception("Quota exceeded for gemini")) == 15.0

    def test_wrapped_provider_error_detected(self):
        # complete() wraps provider errors as ValueError with the text intact
        assert llm.rate_limit_wait(ValueError("LLM completion failed: 429 rate limit")) == 15.0

    def test_retry_after_header_honoured(self):
        err = Exception("Rate limited")
        err.response = SimpleNamespace(headers={"retry-after": "7"})
        assert llm.rate_limit_wait(err) == 7.0

    def test_retry_after_capped_at_two_minutes(self):
        err = Exception("429")
        err.response = SimpleNamespace(headers={"Retry-After": "9999"})
        assert llm.rate_limit_wait(err) == 120.0

    def test_non_numeric_retry_after_falls_back(self):
        err = Exception("429")
        err.response = SimpleNamespace(headers={"retry-after": "nonsense"})
        assert llm.rate_limit_wait(err) == 15.0


# ---------------------------------------------------------------------------
# Token usage accounting
# ---------------------------------------------------------------------------


class TestUsageAccounting:
    def test_records_and_aggregates_per_tag(self):
        llm.record_llm_usage(_usage_response(10, 20), "chat_planner")
        llm.record_llm_usage(_usage_response(5, 7), "chat_planner")

        stats = llm.get_llm_usage()
        assert stats["chat_planner"] == {
            "calls": 2,
            "prompt_tokens": 15,
            "completion_tokens": 27,
        }

    def test_missing_usage_block_is_ignored(self):
        llm.record_llm_usage(SimpleNamespace(usage=None), "probe")
        assert llm.get_llm_usage() == {}

    def test_get_llm_usage_returns_a_copy(self):
        llm.record_llm_usage(_usage_response(1, 1), "x")
        llm.get_llm_usage()["x"]["calls"] = 999
        assert llm.get_llm_usage()["x"]["calls"] == 1

    def test_tag_prefers_trace_name_then_tags_then_fallback(self):
        assert (
            llm._usage_tag({"trace_name": "chat_planner", "tags": ["chat"]}, "resume")
            == "chat_planner"
        )
        assert llm._usage_tag({"tags": ["chat", "turn"]}, "resume") == "chat"
        assert llm._usage_tag(None, "keywords") == "keywords"
        assert llm._usage_tag({}, "") == "unattributed"

    @pytest.mark.asyncio
    async def test_complete_records_usage_with_fallback_tag(self, monkeypatch):
        router = _FakeRouter()
        config = LLMConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")
        monkeypatch.setattr(llm, "get_router", lambda c=None: (router, config))

        result = await llm.complete("hi")

        assert result == "ok"
        stats = llm.get_llm_usage()
        assert stats["complete"]["calls"] == 1
        assert stats["complete"]["prompt_tokens"] == 3
        assert stats["complete"]["completion_tokens"] == 4


# ---------------------------------------------------------------------------
# Global concurrency semaphore
# ---------------------------------------------------------------------------


class _FakeRouter:
    """Router stand-in that tracks how many calls are in flight."""

    def __init__(self, delay: float = 0.05) -> None:
        self.in_flight = 0
        self.peak = 0
        self.calls = 0
        self._delay = delay

    async def acompletion(self, **kwargs: object) -> SimpleNamespace:
        self.in_flight += 1
        self.calls += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.sleep(self._delay)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="ok", tool_calls=None)
                    )
                ],
                usage=SimpleNamespace(prompt_tokens=3, completion_tokens=4),
            )
        finally:
            self.in_flight -= 1


class TestGlobalConcurrencyLimit:
    @pytest.mark.asyncio
    async def test_burst_is_capped_at_llm_max_concurrency(self, monkeypatch):
        router = _FakeRouter()
        config = LLMConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")
        monkeypatch.setattr(llm, "get_router", lambda c=None: (router, config))

        results = await asyncio.gather(*(llm.complete("hi") for _ in range(8)))

        assert results == ["ok"] * 8
        assert router.calls == 8
        # The whole point: no more than LLM_MAX_CONCURRENCY upstream calls at once
        assert router.peak <= llm.LLM_MAX_CONCURRENCY
        # ...and the cap is actually engaged (tasks were queued, not serialised to 1)
        assert router.peak >= 2

    @pytest.mark.asyncio
    async def test_slot_is_released_after_failure(self, monkeypatch):
        """A failing call must not leak a semaphore slot."""

        class _FailingRouter:
            async def acompletion(self, **kwargs: object) -> SimpleNamespace:
                raise RuntimeError("boom")

        config = LLMConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")
        monkeypatch.setattr(
            llm, "get_router", lambda c=None: (_FailingRouter(), config)
        )

        with pytest.raises(ValueError, match="boom"):
            await llm.complete("hi")

        # Slot must be free: a healthy call still works afterwards.
        router = _FakeRouter()
        monkeypatch.setattr(llm, "get_router", lambda c=None: (router, config))
        assert await llm.complete("hi") == "ok"
        assert router.peak <= llm.LLM_MAX_CONCURRENCY


# ---------------------------------------------------------------------------
# Router RPM pacing (LLM_RPM)
# ---------------------------------------------------------------------------


class TestRouterRpmPacing:
    def test_pre_call_checks_disabled_by_default(self, monkeypatch):
        monkeypatch.setattr(llm.settings, "llm_rpm", 0)
        config = LLMConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")
        router = llm._build_router(config)
        assert router.enable_pre_call_checks is False
        assert "rpm" not in router.model_list[0]["litellm_params"]

    def test_rpm_enables_pre_call_check(self, monkeypatch):
        monkeypatch.setattr(llm.settings, "llm_rpm", 30)
        config = LLMConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")
        router = llm._build_router(config)
        assert router.enable_pre_call_checks is True
        assert router.model_list[0]["litellm_params"]["rpm"] == 30

    def test_router_spaces_transport_retries(self, monkeypatch):
        # litellm's default backoff fires all retries inside ~4s, which never
        # rides out a Gemini 503 demand spike. retry_after=8 spaces them out
        # (litellm's MAX_RETRY_DELAY caps the wait at 8s per attempt).
        monkeypatch.setattr(llm.settings, "llm_rpm", 0)
        config = LLMConfig(provider="openai", model="gpt-4o-mini", api_key="test-key")
        router = llm._build_router(config)
        assert router.retry_after == 8


# ---------------------------------------------------------------------------
# Transient error classification (503 mapping for endpoints)
# ---------------------------------------------------------------------------


class TestIsTransientLlmError:
    def test_provider_5xx_and_rate_limits_are_transient(self):
        assert llm.is_transient_llm_error(
            litellm.ServiceUnavailableError("high demand", "gemini", "g")
        )
        assert llm.is_transient_llm_error(
            litellm.InternalServerError("boom", "gemini", "g")
        )
        assert llm.is_transient_llm_error(litellm.RateLimitError("429", "gemini", "g"))
        assert llm.is_transient_llm_error(litellm.Timeout("timeout", "gemini", "g"))

    def test_connection_errors_are_transient(self):
        exc = litellm.APIConnectionError(
            message="conn refused", llm_provider="gemini", model="g"
        )
        assert llm.is_transient_llm_error(exc)

    def test_wrapped_value_error_from_complete_is_classified_via_cause(self):
        # complete() re-raises everything as ValueError(... ) from e — the
        # cause chain must still reveal the transient provider status.
        cause = litellm.ServiceUnavailableError("high demand", "gemini", "g")
        try:
            raise ValueError(f"LLM completion failed: {cause}") from cause
        except ValueError as wrapped:
            assert llm.is_transient_llm_error(wrapped)

    def test_application_errors_are_not_transient(self):
        assert not llm.is_transient_llm_error(ValueError("No JSON found in response"))
        assert not llm.is_transient_llm_error(
            litellm.BadRequestError("bad request", "gemini", "g")
        )
        assert not llm.is_transient_llm_error(
            litellm.AuthenticationError("bad key", "gemini", "g")
        )

    def test_http_exceptions_are_not_reclassified(self):
        # Endpoints re-raise their own HTTPException first; a 404 must never
        # be mapped onto a transient 503 by this helper.
        assert not llm.is_transient_llm_error(HTTPException(status_code=404))


# ---------------------------------------------------------------------------
# llm_cache memoization
# ---------------------------------------------------------------------------


class TestLlmCache:
    @pytest.mark.asyncio
    async def test_get_or_compute_runs_factory_once_for_concurrent_callers(self):
        calls = 0

        async def factory() -> dict[str, int]:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.02)
            return {"v": 1}

        key = llm_cache.make_key("dedupe", "same-input")
        results = await asyncio.gather(
            *(llm_cache.get_or_compute(key, factory) for _ in range(5))
        )

        assert calls == 1
        assert results == [{"v": 1}] * 5

    @pytest.mark.asyncio
    async def test_cached_value_reused_across_calls(self):
        calls = 0

        async def factory() -> str:
            nonlocal calls
            calls += 1
            return "answer"

        key = llm_cache.make_key("reuse")
        assert await llm_cache.get_or_compute(key, factory) == "answer"
        assert await llm_cache.get_or_compute(key, factory) == "answer"
        assert calls == 1

    @pytest.mark.asyncio
    async def test_expired_entry_is_recomputed(self):
        key = llm_cache.make_key("ttl")
        llm_cache.set(key, "stale", ttl=0.01)
        await asyncio.sleep(0.03)

        async def factory() -> str:
            return "fresh"

        assert await llm_cache.get_or_compute(key, factory) == "fresh"

    def test_different_inputs_yield_different_keys(self):
        assert llm_cache.make_key("resume", "jd-a") != llm_cache.make_key(
            "resume", "jd-b"
        )

    def test_stats_reflect_entries_and_invalidate_clears(self):
        llm_cache.set(llm_cache.make_key("s"), 1, ttl=60)
        assert llm_cache.stats()["entries"] == 1
        llm_cache.invalidate()
        assert llm_cache.stats()["entries"] == 0


class TestLlmCacheCoalesce:
    """Single-flight: share an in-flight computation, never cache the result."""

    @pytest.mark.asyncio
    async def test_concurrent_callers_share_one_computation(self):
        calls = 0

        async def factory() -> str:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return "value"

        results = await asyncio.gather(
            *(llm_cache.coalesce("flight-key", factory) for _ in range(5))
        )

        assert calls == 1
        assert results == ["value"] * 5

    @pytest.mark.asyncio
    async def test_later_call_recomputes_instead_of_serving_stale(self):
        calls = 0

        async def factory() -> int:
            nonlocal calls
            calls += 1
            return calls

        assert await llm_cache.coalesce("recompute-key", factory) == 1
        assert await llm_cache.coalesce("recompute-key", factory) == 2
        assert calls == 2

    @pytest.mark.asyncio
    async def test_failure_is_shared_with_waiters_and_not_retained(self):
        calls = 0

        async def factory() -> str:
            nonlocal calls
            calls += 1
            # Yield so the second caller joins the in-flight future before the
            # leader fails — a synchronous failure would let both become leaders.
            await asyncio.sleep(0.05)
            raise RuntimeError("generation failed")

        results = await asyncio.gather(
            *(llm_cache.coalesce("failing-key", factory) for _ in range(2)),
            return_exceptions=True,
        )
        assert calls == 1
        assert all(isinstance(r, RuntimeError) for r in results)

        # The failure must not stick around: the next call retries the factory.
        with pytest.raises(RuntimeError):
            await llm_cache.coalesce("failing-key", factory)
        assert calls == 2
