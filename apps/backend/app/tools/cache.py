"""Tool Cache — L1 (in-memory) + L2 (DB-backed) caching for tool results.

Reduces redundant tool calls by caching results with configurable TTLs.
"""

import hashlib
import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


class ToolCache:
    """Two-level cache: L1 (in-memory dict) + L2 (placeholder for DB-backed)."""

    # Default TTLs per tool type (seconds)
    TTL_DEFAULT = 300  # 5 minutes
    TTL_SEARCH = 120   # 2 minutes (search results change fast)
    TTL_STATIC = 3600  # 1 hour (static data like career stats)

    def __init__(self) -> None:
        self._l1: dict[str, tuple[float, Any]] = {}

    def _cache_key(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """Generate a deterministic cache key."""
        payload = json.dumps({"tool": tool_name, "args": arguments}, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def _get_ttl(self, tool_name: str) -> int:
        """Get TTL for a tool."""
        if "search" in tool_name or "query" in tool_name:
            return self.TTL_SEARCH
        if "stats" in tool_name or "career" in tool_name:
            return self.TTL_STATIC
        return self.TTL_DEFAULT

    async def get(self, tool_name: str, arguments: dict[str, Any]) -> Any | None:
        """Get a cached result if available and not expired."""
        key = self._cache_key(tool_name, arguments)
        if key in self._l1:
            expires_at, value = self._l1[key]
            if time.monotonic() < expires_at:
                logger.debug("Cache HIT for %s", tool_name)
                return value
            else:
                del self._l1[key]
        return None

    async def set(self, tool_name: str, arguments: dict[str, Any], result: Any) -> None:
        """Store a result in the cache."""
        key = self._cache_key(tool_name, arguments)
        ttl = self._get_ttl(tool_name)
        self._l1[key] = (time.monotonic() + ttl, result)
        logger.debug("Cached result for %s (TTL=%ds)", tool_name, ttl)

    async def invalidate(self, tool_name: str, arguments: dict[str, Any] | None = None) -> int:
        """Invalidate cached results. Returns count of entries removed."""
        if arguments:
            key = self._cache_key(tool_name, arguments)
            if key in self._l1:
                del self._l1[key]
                return 1
            return 0

        # Invalidate all entries for this tool
        count = 0
        keys_to_remove = [k for k in self._l1 if tool_name in k]
        for k in keys_to_remove:
            del self._l1[k]
            count += 1
        return count

    async def clear(self) -> None:
        """Clear the entire cache."""
        self._l1.clear()

    def stats(self) -> dict[str, Any]:
        """Get cache statistics."""
        now = time.monotonic()
        active = sum(1 for expires, _ in self._l1.values() if now < expires)
        expired = len(self._l1) - active
        return {"total": len(self._l1), "active": active, "expired": expired}


tool_cache = ToolCache()
