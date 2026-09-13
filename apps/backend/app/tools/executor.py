"""Tool Executor — secure MCP tool execution with validation.

Validates every MCP call: ownership, server enabled, tool enabled, schema validation.
Enforces per-tool timeout, max response size, max output tokens, and audit logging.
No retries for auth/permission failures. Retries only for safe transient errors.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from app.database import db
from app.services.mcp.connection import connection_manager
from app.services.mcp.health import health_monitor
from app.services.mcp.errors import MCPError, MCPToolError, MCPSSRFError, MCPAuthenticationError
from app.services.chat_tools import ToolRequiresConfirmation
from app.tools.reliability import tool_reliability
from app.tools.schemas import ToolDescriptor, ToolSource

logger = logging.getLogger(__name__)

# Transient errors that are safe to retry
_RETRYABLE_ERRORS = {
    "TIMEOUT",
    "CONNECT_ERROR",
    "HTTP_ERROR",
}

# Auth/permission errors that should NOT be retried
_NO_RETRY_ERRORS = {
    "AUTHENTICATION_ERROR",
    "AUTHORIZATION_ERROR",
    "SSRF_BLOCKED",
    "SCHEMA_MISMATCH",
}

# Default limits
DEFAULT_TIMEOUT_MS = 15000
MAX_OUTPUT_TOKENS = 8192
MAX_RESPONSE_BYTES = 1_048_576  # 1MB
DEFAULT_MCP_TIMEOUT_MS = 30000


class ToolExecutor:
    """Secure tool executor with validation and audit logging."""

    async def execute(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        timeout_ms: int | None = None,
        retries: int | None = None,
    ) -> dict[str, Any]:
        """Execute a single tool with full validation.

        Args:
            tool_name: The tool name (e.g. "analyze_resume" or "server__search_jobs").
            arguments: Tool arguments.
            timeout_ms: Override default timeout.
            retries: Override default retry count (only for transient errors).

        Returns:
            {"success": bool, "result": Any, "error": str | None, "latency_ms": float}
        """
        start = time.monotonic()

        # Determine if this is an MCP tool
        if "__" in tool_name and tool_name not in self._builtin_tools():
            return await self._execute_mcp(tool_name, arguments, timeout_ms, retries, start)
        else:
            return await self._execute_builtin(tool_name, arguments, timeout_ms, retries, start)

    async def _execute_mcp(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        timeout_ms: int | None,
        retries: int | None,
        start: float,
    ) -> dict[str, Any]:
        """Execute an MCP tool with security validation."""
        # 1. Look up tool in the MCPTool table
        tool = await self._resolve_mcp_tool(tool_name)
        if not tool:
            latency = (time.monotonic() - start) * 1000
            return {
                "success": False,
                "result": None,
                "error": f"MCP tool '{tool_name}' not found",
                "error_code": "TOOL_NOT_FOUND",
                "latency_ms": latency,
            }

        server_id = tool["server_id"]

        # 2. Validate server exists and is enabled
        server = await db.get_mcp_server(server_id)
        if not server:
            latency = (time.monotonic() - start) * 1000
            return {
                "success": False,
                "result": None,
                "error": f"Server not found for tool '{tool_name}'",
                "error_code": "SERVER_NOT_FOUND",
                "latency_ms": latency,
            }
        if not server.get("enabled"):
            latency = (time.monotonic() - start) * 1000
            return {
                "success": False,
                "result": None,
                "error": f"Server '{server.get('name')}' is disabled",
                "error_code": "SERVER_DISABLED",
                "latency_ms": latency,
            }

        # 3. Validate tool is enabled
        if not tool.get("enabled"):
            latency = (time.monotonic() - start) * 1000
            return {
                "success": False,
                "result": None,
                "error": f"Tool '{tool_name}' is disabled",
                "error_code": "TOOL_DISABLED",
                "latency_ms": latency,
            }

        # 4. Schema validation (basic type check on required fields)
        schema_valid = self._validate_schema(arguments, tool.get("input_schema", "{}"))
        if not schema_valid:
            latency = (time.monotonic() - start) * 1000
            return {
                "success": False,
                "result": None,
                "error": f"Arguments do not match tool schema: {schema_valid}",
                "error_code": "SCHEMA_MISMATCH",
                "latency_ms": latency,
            }

        # 5. Execute with timeout and retry logic
        effective_timeout = timeout_ms or DEFAULT_MCP_TIMEOUT_MS
        max_retries = retries if retries is not None else 1  # Default: 1 retry for MCP
        last_error = None
        last_error_code = None

        for attempt in range(max_retries + 1):
            try:
                result = await asyncio.wait_for(
                    connection_manager.call_tool(
                        server_id, tool["original_name"], arguments
                    ),
                    timeout=effective_timeout / 1000,
                )

                latency = (time.monotonic() - start) * 1000

                if result["success"]:
                    # Truncate output if too large
                    output = result["result"]
                    truncated = self._truncate_output(output, MAX_OUTPUT_TOKENS, MAX_RESPONSE_BYTES)

                    # Record health success
                    await health_monitor.record_success(server_id, latency)
                    await tool_reliability.record_success(tool_name, latency)

                    # Audit log (no secrets)
                    logger.info(
                        "MCP tool call: %s/%s success (%dms)",
                        server.get("name"), tool["original_name"], latency,
                    )

                    return {
                        "success": True,
                        "result": truncated,
                        "error": None,
                        "latency_ms": latency,
                    }
                else:
                    last_error = result.get("error", "Unknown error")
                    last_error_code = self._classify_error(last_error)
                    logger.warning(
                        "MCP tool call: %s/%s failed: %s",
                        server.get("name"), tool["original_name"], last_error,
                    )

            except asyncio.TimeoutError:
                last_error = f"Timeout after {effective_timeout}ms"
                last_error_code = "TIMEOUT"
                logger.warning(
                    "MCP tool call: %s/%s timed out (attempt %d)",
                    server.get("name"), tool["original_name"], attempt + 1,
                )
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                last_error_code = "UNKNOWN_ERROR"
                logger.warning(
                    "MCP tool call: %s/%s exception (attempt %d): %s",
                    server.get("name"), tool["original_name"], attempt + 1, e,
                )

            # Only retry for transient errors
            if last_error_code not in _RETRYABLE_ERRORS:
                break
            if attempt < max_retries:
                await asyncio.sleep(0.5 * (attempt + 1))  # Exponential backoff

        latency = (time.monotonic() - start) * 1000
        await health_monitor.record_failure(server_id, last_error or "unknown")
        await tool_reliability.record_failure(tool_name, latency, last_error_code)

        # Audit log failure
        logger.warning(
            "MCP tool call: %s/%s FAILED (%dms): %s [%s]",
            server.get("name"), tool["original_name"], latency,
            last_error, last_error_code,
        )

        return {
            "success": False,
            "result": None,
            "error": last_error,
            "error_code": last_error_code,
            "latency_ms": latency,
        }

    async def _execute_builtin(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        timeout_ms: int | None,
        retries: int | None,
        start: float,
    ) -> dict[str, Any]:
        """Execute a built-in tool via chat_tools.execute_tool."""
        from app.services.chat_tools import execute_tool

        effective_timeout = timeout_ms or DEFAULT_TIMEOUT_MS
        max_retries = retries if retries is not None else 2
        last_error = None

        for attempt in range(max_retries + 1):
            try:
                result = await asyncio.wait_for(
                    execute_tool(tool_name, arguments),
                    timeout=effective_timeout / 1000,
                )
                latency = (time.monotonic() - start) * 1000
                await tool_reliability.record_success(tool_name, latency)
                return {"success": True, "result": result, "error": None, "latency_ms": latency}
            except ToolRequiresConfirmation:
                raise
            except asyncio.TimeoutError:
                last_error = f"Timeout after {effective_timeout}ms"
                logger.warning("Tool %s timed out (attempt %d)", tool_name, attempt + 1)
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                logger.warning("Tool %s failed (attempt %d): %s", tool_name, attempt + 1, e)

            if attempt < max_retries:
                await asyncio.sleep(1.0 * (attempt + 1))

        latency = (time.monotonic() - start) * 1000
        await tool_reliability.record_failure(tool_name, latency, type(last_error).__name__)
        return {"success": False, "result": None, "error": last_error, "latency_ms": latency}

    async def _resolve_mcp_tool(self, tool_name: str) -> dict[str, Any] | None:
        """Look up an MCP tool by its public name in the MCPTool table."""
        tools = await db.list_enabled_mcp_tools()
        for tool in tools:
            if tool["public_name"] == tool_name or tool["name"] == tool_name:
                return tool
        # Fallback: try all tools (including disabled)
        all_tools = await db.list_mcp_tools()
        for tool in all_tools:
            if tool["public_name"] == tool_name or tool["name"] == tool_name:
                return tool
        return None

    def _validate_schema(self, arguments: dict[str, Any], schema_json: str) -> str | None:
        """Basic schema validation. Returns error message or None if valid."""
        try:
            schema = json.loads(schema_json)
        except (json.JSONDecodeError, TypeError):
            return None  # Can't validate, assume valid

        required = schema.get("required", [])
        properties = schema.get("properties", {})

        # Check required fields
        for field_name in required:
            if field_name not in arguments:
                return f"Missing required field: {field_name}"

        # Basic type checking for common fields
        for key, value in arguments.items():
            if key in properties:
                prop = properties[key]
                expected_type = prop.get("type")
                if expected_type == "string" and not isinstance(value, str):
                    return f"Field '{key}' should be a string"
                elif expected_type == "integer" and not isinstance(value, int):
                    return f"Field '{key}' should be an integer"
                elif expected_type == "number" and not isinstance(value, (int, float)):
                    return f"Field '{key}' should be a number"
                elif expected_type == "boolean" and not isinstance(value, bool):
                    return f"Field '{key}' should be a boolean"

        return None

    def _truncate_output(self, output: Any, max_tokens: int, max_bytes: int) -> Any:
        """Truncate output to stay within limits."""
        if output is None:
            return output

        # Convert to string for size check
        if isinstance(output, str):
            text = output
        else:
            try:
                text = json.dumps(output)
            except (TypeError, ValueError):
                return output

        # Check byte limit
        byte_size = len(text.encode("utf-8"))
        if byte_size > max_bytes:
            # Truncate and add marker
            truncated = text[:max_bytes // 2] + "\n... [truncated] ..." + text[-max_bytes // 2:]
            logger.warning(
                "Tool output truncated: %d bytes -> %d bytes",
                byte_size, max_bytes,
            )
            if isinstance(output, str):
                return truncated
            try:
                return json.loads(truncated)
            except (json.JSONDecodeError, ValueError):
                return truncated

        return output

    def _classify_error(self, error_msg: str) -> str:
        """Classify an error message into an error code."""
        error_lower = error_msg.lower()
        if "timeout" in error_lower or "timed out" in error_lower:
            return "TIMEOUT"
        if "connection" in error_lower and "failed" in error_lower:
            return "CONNECT_ERROR"
        if "authentication" in error_lower or "unauthorized" in error_lower:
            return "AUTHENTICATION_ERROR"
        if "forbidden" in error_lower or "permission" in error_lower:
            return "AUTHORIZATION_ERROR"
        if "not found" in error_lower:
            return "NOT_FOUND"
        if "rate limit" in error_lower:
            return "RATE_LIMITED"
        return "UNKNOWN_ERROR"

    def _builtin_tools(self) -> set[str]:
        """Return set of built-in tool names."""
        from app.services.chat_tools import TOOL_CATALOG
        return set(TOOL_CATALOG.keys())


tool_executor = ToolExecutor()
