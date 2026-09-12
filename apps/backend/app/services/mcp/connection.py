"""MCP Connection Manager — handles MCP protocol connections.

Uses the mcp Python SDK for Streamable HTTP and SSE transports.
Manages connection lifecycle, tool listing, and tool invocation.
"""

import logging
from typing import Any

from app.services.mcp.authentication import credential_manager
from app.services.mcp.server_manager import server_manager

logger = logging.getLogger(__name__)

_MCP_SDK_AVAILABLE = False
try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    _MCP_SDK_AVAILABLE = True
except ImportError:
    logger.debug("mcp SDK not installed; custom MCP connections will use httpx fallback")


class MCPConnectionManager:
    """Manages MCP protocol connections to servers."""

    def __init__(self) -> None:
        self._sessions: dict[str, Any] = {}  # server_id -> ClientSession

    async def connect(self, server_id: str) -> bool:
        """Connect to an MCP server using its transport.

        Returns True if connected successfully, False otherwise.
        """
        server = await server_manager.get_server(server_id)
        if not server:
            logger.error("Server %s not found", server_id)
            return False

        url = server.get("url")
        transport = server.get("transport", "streamable-http")

        if not url:
            await server_manager.set_error(server_id, "No URL configured")
            return False

        # Already connected
        if server_id in self._sessions:
            return True

        if not _MCP_SDK_AVAILABLE:
            # Fallback: HTTP health check to verify reachability
            try:
                import httpx
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(url)
                    if resp.status_code < 400:
                        await server_manager.update_server(server_id, status="connected", error_message=None)
                        logger.info("Connected to MCP server %s at %s (httpx fallback)", server_id, url)
                        return True
                    else:
                        await server_manager.set_error(server_id, f"HTTP {resp.status_code}")
                        return False
            except Exception as e:
                await server_manager.set_error(server_id, f"Connection failed: {e}")
                return False

        try:
            headers = await credential_manager.get_auth_headers(server_id)
            read_stream, write_stream = await streamablehttp_client(url, headers=headers)
            session = ClientSession(read_stream, write_stream)
            await session.initialize()
            self._sessions[server_id] = session
            await server_manager.update_server(server_id, status="connected", error_message=None)
            logger.info("Connected to MCP server %s at %s", server_id, url)
            return True
        except Exception as e:
            error_msg = f"Connection failed: {type(e).__name__}: {e}"
            await server_manager.set_error(server_id, error_msg)
            logger.error("Failed to connect to MCP server %s: %s", server_id, e)
            return False

    async def disconnect(self, server_id: str) -> None:
        """Disconnect from an MCP server."""
        session = self._sessions.pop(server_id, None)
        if session:
            try:
                await session.close()
            except Exception:
                pass
        logger.info("Disconnected from MCP server %s", server_id)

    async def list_tools(self, server_id: str) -> list[dict[str, Any]]:
        """List tools from an MCP server.

        Returns list of tool definitions in OpenAI-compatible format.
        """
        server = await server_manager.get_server(server_id)
        if not server:
            return []

        # Return cached tools if available
        cached = await server_manager.get_tools(server_id)
        if cached:
            return cached

        # Try to connect and discover
        connected = await self.connect(server_id)
        if not connected:
            return []

        session = self._sessions.get(server_id)
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
            if tools:
                await server_manager.update_tools(server_id, tools)
            return tools
        except Exception as e:
            logger.error("Failed to list tools from %s: %s", server_id, e)
            return []

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Call a tool on an MCP server.

        Returns:
            {"success": bool, "result": Any, "error": str | None}
        """
        server = await server_manager.get_server(server_id)
        if not server:
            return {"success": False, "result": None, "error": f"Server {server_id} not found"}

        # Ensure connected
        connected = await self.connect(server_id)
        if not connected:
            return {"success": False, "result": None, "error": "Not connected"}

        session = self._sessions.get(server_id)
        if not session:
            return {"success": False, "result": None, "error": "No session available"}

        try:
            result = await session.call_tool(tool_name, arguments)
            # Extract content from result
            content = result.content if hasattr(result, "content") else result
            return {"success": True, "result": content, "error": None}
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            logger.error("Tool call failed on %s/%s: %s", server_id, tool_name, error_msg)
            return {"success": False, "result": None, "error": error_msg}

    async def health_check(self, server_id: str) -> dict[str, Any]:
        """Check if an MCP server is reachable."""
        server = await server_manager.get_server(server_id)
        if not server:
            return {"healthy": False, "error": "Server not found"}

        url = server.get("url")
        if not url:
            return {"healthy": False, "error": "No URL configured"}

        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
                return {"healthy": resp.status_code < 400, "status_code": resp.status_code}
        except Exception as e:
            return {"healthy": False, "error": str(e)}


connection_manager = MCPConnectionManager()
