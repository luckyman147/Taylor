"""SSE (Server-Sent Events) transport for MCP connections.

Uses the mcp Python SDK for SSE transport.
Falls back to httpx if the SDK is not available.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.services.mcp.authentication import ResolvedMCPCredentials
from app.services.mcp.transports.base import BaseTransport, TransportFactory, TransportResult

logger = logging.getLogger(__name__)

_MCP_SDK_AVAILABLE = False
try:
    from mcp import ClientSession
    from mcp.client.sse import sse_client
    _MCP_SDK_AVAILABLE = True
except ImportError:
    logger.debug("mcp SDK not installed; SSE will use httpx fallback")


class SSETransport(BaseTransport):
    """SSE transport using the mcp SDK."""

    name = "sse"
    default_timeout = 30.0

    async def connect(
        self,
        url: str,
        credentials: ResolvedMCPCredentials,
        timeout: float | None = None,
    ) -> TransportResult:
        """Connect using SSE transport."""
        start = time.monotonic()
        effective_timeout = timeout or self.default_timeout

        if not _MCP_SDK_AVAILABLE:
            return await self._connect_httpx(url, credentials, effective_timeout, start)

        try:
            headers = dict(credentials.headers)
            read_stream, write_stream = await sse_client(
                url,
                headers=headers,
                timeout=effective_timeout,
            )
            session = ClientSession(read_stream, write_stream)
            await session.initialize()
            latency_ms = int((time.monotonic() - start) * 1000)
            return TransportResult(success=True, session=session, latency_ms=latency_ms)
        except TimeoutError:
            latency_ms = int((time.monotonic() - start) * 1000)
            return TransportResult(
                success=False,
                error="Connection timed out",
                error_code="TIMEOUT",
                latency_ms=latency_ms,
            )
        except Exception as e:
            latency_ms = int((time.monotonic() - start) * 1000)
            return TransportResult(
                success=False,
                error=f"{type(e).__name__}: {e}",
                error_code="CONNECT_ERROR",
                latency_ms=latency_ms,
            )

    async def _connect_httpx(
        self,
        url: str,
        credentials: ResolvedMCPCredentials,
        timeout: float,
        start: float,
    ) -> TransportResult:
        """Fallback connection using httpx."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, headers=credentials.headers)
                latency_ms = int((time.monotonic() - start) * 1000)
                if resp.status_code < 400:
                    return TransportResult(success=True, latency_ms=latency_ms)
                return TransportResult(
                    success=False,
                    error=f"HTTP {resp.status_code}",
                    error_code="HTTP_ERROR",
                    latency_ms=latency_ms,
                )
        except httpx.TimeoutException:
            latency_ms = int((time.monotonic() - start) * 1000)
            return TransportResult(
                success=False,
                error="Connection timed out",
                error_code="TIMEOUT",
                latency_ms=latency_ms,
            )
        except Exception as e:
            latency_ms = int((time.monotonic() - start) * 1000)
            return TransportResult(
                success=False,
                error=f"{type(e).__name__}: {e}",
                error_code="CONNECT_ERROR",
                latency_ms=latency_ms,
            )

    async def disconnect(self, session: Any) -> None:
        """Disconnect from an SSE session."""
        if session:
            try:
                await session.close()
            except Exception:
                pass

    async def list_tools(self, session: Any) -> list[dict[str, Any]]:
        """List tools from an SSE session."""
        if not session:
            return []
        try:
            result = await session.list_tools()
            tools = []
            for tool in result.tools:
                tools.append({
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": tool.inputSchema if hasattr(tool, "inputSchema") else {"type": "object", "properties": {}},
                })
            return tools
        except Exception as e:
            logger.error("Failed to list tools: %s", e)
            return []

    async def call_tool(
        self,
        session: Any,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Call a tool on an SSE session."""
        if not session:
            return {"success": False, "result": None, "error": "No session"}
        try:
            result = await session.call_tool(tool_name, arguments)
            content = result.content if hasattr(result, "content") else result
            return {"success": True, "result": content, "error": None}
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            logger.error("Tool call failed: %s", error_msg)
            return {"success": False, "result": None, "error": error_msg}


# Register this transport
TransportFactory.register("sse", SSETransport)
