"""Unit tests for chat pending action store (TTL, confirm, cancel)."""

import time

import pytest

from app.services.chat_engine import (
    _cleanup_pending,
    _get_pending,
    _remove_pending,
    _store_pending,
    cancel_pending,
    confirm_pending,
)


class TestPendingStore:
    def test_store_and_retrieve(self):
        token = _store_pending("create_skill", {"name": "Python"}, "Add skill: Python")
        entry = _get_pending(token)
        assert entry is not None
        assert entry["tool"] == "create_skill"
        assert entry["args"]["name"] == "Python"
        _remove_pending(token)

    def test_retrieve_nonexistent_returns_none(self):
        assert _get_pending("nonexistent") is None

    def test_remove(self):
        token = _store_pending("create_skill", {"name": "Python"}, "Add skill: Python")
        _remove_pending(token)
        assert _get_pending(token) is None

    def test_expires_after_ttl(self):
        token = _store_pending("create_skill", {"name": "Python"}, "Add skill: Python")
        # Manually set created_at to past
        from app.services.chat_engine import _pending_store

        _pending_store[token]["created_at"] = time.time() - 3600  # 1 hour ago

        entry = _get_pending(token)
        assert entry is None  # Should be expired and removed

    def test_cleanup_removes_expired(self):
        t1 = _store_pending("create_skill", {"name": "A"}, "Add A")
        t2 = _store_pending("create_skill", {"name": "B"}, "Add B")

        from app.services.chat_engine import _pending_store

        _pending_store[t1]["created_at"] = time.time() - 3600
        # t2 is still valid

        _cleanup_pending()
        assert _get_pending(t1) is None
        assert _get_pending(t2) is not None

        _remove_pending(t2)


class TestConfirmPending:
    @pytest.mark.asyncio
    async def test_confirm_nonexistent_raises(self):
        with pytest.raises(ValueError, match="not found"):
            await confirm_pending("nonexistent", "test-thread")

    @pytest.mark.asyncio
    async def test_confirm_expired_raises(self):
        token = _store_pending("create_skill", {"name": "Python"}, "Add Python")
        from app.services.chat_engine import _pending_store

        _pending_store[token]["created_at"] = time.time() - 3600

        with pytest.raises(ValueError, match="not found"):
            await confirm_pending(token, "test-thread")


class TestCancelPending:
    @pytest.mark.asyncio
    async def test_cancel_nonexistent_raises(self):
        with pytest.raises(ValueError, match="not found"):
            await cancel_pending("nonexistent")

    @pytest.mark.asyncio
    async def test_cancel_removes_entry(self):
        token = _store_pending("create_skill", {"name": "Python"}, "Add Python")
        result = await cancel_pending(token)
        assert result["ok"] is True
        assert _get_pending(token) is None
