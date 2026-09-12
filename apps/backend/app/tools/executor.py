"""Tool Executor — executes tools with timeout, retries, and parallel support.

Dispatches tool calls to built-in handlers or MCP servers with proper
error handling, timeout management, and result compression.
"""

import asyncio
import logging
import time
from typing import Any

from app.services.mcp.connection import connection_manager
from app.services.mcp.health import health_monitor
from app.services.chat_tools import ToolRequiresConfirmation
from app.tools.reliability import tool_reliability

logger = logging.getLogger(__name__)


class ToolExecutor:
    """Executes tools with timeout, retries, and parallel support."""

    DEFAULT_TIMEOUT_MS = 15000
    MAX_RETRIES = 2
    RETRY_DELAY_MS = 1000

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        timeout_ms: int | None = None,
        retries: int | None = None,
    ) -> dict[str, Any]:
        """Execute a single tool.

        Args:
            tool_name: The tool name (e.g. "analyze_resume" or "mcp_exa_search").
            arguments: Tool arguments.
            timeout_ms: Override default timeout.
            retries: Override default retry count.

        Returns:
            {"success": bool, "result": Any, "error": str | None, "latency_ms": float}
        """
        timeout = timeout_ms or self.DEFAULT_TIMEOUT_MS
        max_retries = retries if retries is not None else self.MAX_RETRIES

        start = time.monotonic()
        last_error = None

        for attempt in range(max_retries + 1):
            try:
                result = await asyncio.wait_for(
                    self._dispatch(tool_name, arguments),
                    timeout=timeout / 1000,
                )
                latency = (time.monotonic() - start) * 1000
                await tool_reliability.record_success(tool_name, latency)
                return {"success": True, "result": result, "error": None, "latency_ms": latency}
            except ToolRequiresConfirmation:
                raise
            except asyncio.TimeoutError:
                last_error = f"Timeout after {timeout}ms"
                logger.warning("Tool %s timed out (attempt %d)", tool_name, attempt + 1)
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                logger.warning("Tool %s failed (attempt %d): %s", tool_name, attempt + 1, e)

            if attempt < max_retries:
                await asyncio.sleep(self.RETRY_DELAY_MS / 1000)

        latency = (time.monotonic() - start) * 1000
        await tool_reliability.record_failure(tool_name, latency, type(last_error).__name__)
        return {"success": False, "result": None, "error": last_error, "latency_ms": latency}

    async def execute_parallel(
        self,
        calls: list[dict[str, Any]],
        timeout_ms: int | None = None,
    ) -> list[dict[str, Any]]:
        """Execute multiple independent tool calls in parallel.

        Args:
            calls: [{"tool_name": str, "arguments": dict}, ...]
            timeout_ms: Per-tool timeout override.

        Returns:
            List of results in the same order as calls.
        """
        tasks = [
            self.execute(c["tool_name"], c.get("arguments", {}), timeout_ms)
            for c in calls
        ]
        return await asyncio.gather(*tasks, return_exceptions=False)

    async def _dispatch(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Dispatch a tool call to the right handler."""
        # MCP tool
        if tool_name.startswith("mcp_"):
            return await self._dispatch_mcp(tool_name, arguments)

        # Built-in tool
        return await self._dispatch_builtin(tool_name, arguments)

    async def _dispatch_mcp(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Dispatch to an MCP server with health monitoring."""
        # Parse tool name: mcp_{server_name}_{tool_name}
        parts = tool_name.split("_", 2)
        if len(parts) < 3:
            raise ValueError(f"Invalid MCP tool name: {tool_name}")
        server_name = parts[1]
        original_name = "_".join(parts[2:])

        from app.services.mcp.server_manager import server_manager
        server = await server_manager.get_server_by_name(server_name)
        if not server:
            raise ValueError(f"MCP server '{server_name}' not found")

        server_id = server["server_id"]
        start = time.monotonic()
        try:
            result = await connection_manager.call_tool(
                server_id, original_name, arguments
            )
            latency_ms = (time.monotonic() - start) * 1000
            if result["success"]:
                await health_monitor.record_success(server_id, latency_ms)
            else:
                await health_monitor.record_failure(server_id, result.get("error", "unknown"))
            if not result["success"]:
                raise RuntimeError(result["error"] or "MCP tool call failed")
            return result["result"]
        except Exception:
            latency_ms = (time.monotonic() - start) * 1000
            await health_monitor.record_failure(server_id, "exception")
            raise

    async def _dispatch_builtin(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Dispatch to a built-in tool via chat_tools.execute_tool."""
        from app.services.chat_tools import ToolRequiresConfirmation, execute_tool
        try:
            result = await execute_tool(tool_name, arguments)
            return result
        except ToolRequiresConfirmation:
            # Write tools need user confirmation — skip in agent loop
            raise RuntimeError(f"Tool '{tool_name}' requires user confirmation (write tool)")


tool_executor = ToolExecutor()
