"""MCP Connection Manager — handles MCP protocol connections.

Uses the transport factory to create appropriate transports.
Manages connection lifecycle, tool listing, and tool invocation.
Credentials are resolved via MCPAuthenticationService — the connection
layer only receives ResolvedMCPCredentials.
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.mcp.authentication import MCPAuthenticationService
from app.services.mcp.server_manager import server_manager
from app.services.mcp.transports.base import TransportFactory, TransportResult

logger = logging.getLogger(__name__)


class MCPConnectionManager:
    """Manages MCP protocol connections to servers."""

    def __init__(self) -> None:
        self._sessions: dict[str, Any] = {}  # server_id -> session
        self._auth_service = MCPAuthenticationService()

    async def connect(self, server_id: str) -> bool:
        """Connect to an MCP server using its transport.

        Returns True if connected successfully, False otherwise.
        """
        server = await server_manager.get_server(server_id)
        if not server:
            logger.error("Server %s not found", server_id)
            return False

        url = server.get("url")
        transport_type = server.get("transport", "streamable-http")

        if not url:
            await server_manager.set_error(server_id, "No URL configured")
            return False

        # Already connected
        if server_id in self._sessions:
            return True

        # Resolve credentials
        credentials = await self._auth_service.resolve_credentials(server_id)

        # Create transport
        try:
            transport = TransportFactory.create(transport_type)
        except ValueError as e:
            await server_manager.set_error(server_id, str(e))
            return False

        # Connect
        result = await transport.connect(url, credentials)

        if result.success:
            self._sessions[server_id] = result.session
            await server_manager.update_server(
                server_id,
                status="connected",
                error_message=None,
                last_error_code=None,
            )
            logger.info(
                "Connected to MCP server %s at %s (%dms)",
                server_id, url, result.latency_ms,
            )
            return True
        else:
            await server_manager.set_error(
                server_id,
                result.error or "Connection failed",
            )
            if result.error_code:
                await server_manager.update_server(
                    server_id,
                    last_error_code=result.error_code,
                )
            logger.error(
                "Failed to connect to MCP server %s: %s",
                server_id, result.error,
            )
            return False

    async def disconnect(self, server_id: str) -> None:
        """Disconnect from an MCP server."""
        session = self._sessions.pop(server_id, None)
        if session:
            server = await server_manager.get_server(server_id)
            if server:
                transport_type = server.get("transport", "streamable-http")
                try:
                    transport = TransportFactory.create(transport_type)
                    await transport.disconnect(session)
                except Exception:
                    pass
        logger.info("Disconnected from MCP server %s", server_id)

    async def list_tools(self, server_id: str) -> list[dict[str, Any]]:
        """List tools from an MCP server.

        Returns list of tool definitions.
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

        transport_type = server.get("transport", "streamable-http")
        try:
            transport = TransportFactory.create(transport_type)
            tools = await transport.list_tools(session)
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

        transport_type = server.get("transport", "streamable-http")
        try:
            transport = TransportFactory.create(transport_type)
            return await transport.call_tool(session, tool_name, arguments)
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

        # Resolve credentials for the health check
        credentials = await self._auth_service.resolve_credentials(server_id)

        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url, headers=credentials.headers)
                return {"healthy": resp.status_code < 400, "status_code": resp.status_code}
        except Exception as e:
            return {"healthy": False, "error": str(e)}


connection_manager = MCPConnectionManager()
