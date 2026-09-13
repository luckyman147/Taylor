"""MCP status, configuration, and custom server management endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.schemas.job_scraper import (
    MCPConfigureRequest,
    MCPStatusResponse,
)
from app.services.job_scraper import get_mcp_manager

router = APIRouter(prefix="/mcp", tags=["MCP"])


# ── Custom MCP Server Management ────────────────────────────────────

class MCPServerCreateRequest(BaseModel):
    """Request to register a new MCP server."""
    name: str
    url: str | None = None
    transport: str = "streamable-http"
    display_name: str | None = None


class MCPServerUpdateRequest(BaseModel):
    """Request to update an MCP server."""
    url: str | None = None
    transport: str | None = None
    display_name: str | None = None
    enabled: bool | None = None


class MCPCredentialCreateRequest(BaseModel):
    """Request to store an MCP credential."""
    auth_type: str  # api_key | bearer | oauth | custom_headers
    auth_config: dict[str, Any]


@router.get("/status", response_model=MCPStatusResponse)
async def get_mcp_status() -> MCPStatusResponse:
    """Get the status of all registered MCP servers."""
    manager = get_mcp_manager()
    statuses = await manager.detect_all()
    return MCPStatusResponse(mcp_servers=statuses)


@router.post("/configure")
async def configure_mcp(request: MCPConfigureRequest) -> dict:
    """Enable or disable an MCP server."""
    manager = get_mcp_manager()
    manager.set_enabled(request.mcp_name, request.enabled)
    return {
        "mcp_name": request.mcp_name,
        "enabled": request.enabled,
        "message": f"MCP '{request.mcp_name}' {'enabled' if request.enabled else 'disabled'}",
    }


@router.post("/restart")
async def restart_mcps() -> dict:
    """Reset all MCP circuit breakers and re-detect availability."""
    import app.services.job_scraper as js_mod

    # Reset circuit breakers
    manager = get_mcp_manager()
    for circuit in manager.circuits.values():
        circuit.reset()

    # Force re-creation of the MCP manager
    js_mod._mcp_manager = None
    new_manager = get_mcp_manager()

    # Detect fresh status
    statuses = await new_manager.detect_all()
    available = sum(1 for s in statuses.values() if s.available)
    return {
        "message": "MCPs restarted",
        "available": available,
        "total": len(statuses),
    }


# ── Custom MCP Server CRUD ──────────────────────────────────────────

@router.get("/servers")
async def list_mcp_servers() -> list[dict[str, Any]]:
    """List all registered MCP servers (built-in + custom)."""
    from app.services.mcp.server_manager import server_manager
    return await server_manager.list_servers()


@router.post("/servers")
async def create_mcp_server(request: MCPServerCreateRequest) -> dict[str, Any]:
    """Register a new custom MCP server."""
    from app.services.mcp.server_manager import server_manager
    server = await server_manager.register_server(
        name=request.name,
        url=request.url,
        transport=request.transport,
        server_kind="remote",
        display_name=request.display_name,
    )
    return server


@router.get("/servers/{server_id}")
async def get_mcp_server(server_id: str) -> dict[str, Any]:
    """Get a single MCP server by ID."""
    from app.services.mcp.server_manager import server_manager
    server = await server_manager.get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.patch("/servers/{server_id}")
async def update_mcp_server(server_id: str, request: MCPServerUpdateRequest) -> dict[str, Any]:
    """Update an MCP server."""
    from app.services.mcp.server_manager import server_manager
    updated = await server_manager.update_server(
        server_id,
        url=request.url,
        transport=request.transport,
        display_name=request.display_name,
        enabled=request.enabled,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Server not found")
    server = await server_manager.get_server(server_id)
    return server or {}


@router.delete("/servers/{server_id}")
async def delete_mcp_server(server_id: str) -> dict[str, str]:
    """Delete an MCP server and its credentials."""
    from app.services.mcp.server_manager import server_manager
    deleted = await server_manager.delete_server(server_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Server not found")
    return {"message": "Server deleted"}


@router.post("/servers/{server_id}/connect")
async def connect_mcp_server(server_id: str) -> dict[str, Any]:
    """Connect to an MCP server and discover its tools."""
    from app.services.mcp.connection import connection_manager
    from app.services.mcp.discovery import tool_discovery
    from app.services.mcp.server_manager import server_manager

    server = await server_manager.get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    connected = await connection_manager.connect(server_id)
    if not connected:
        raise HTTPException(status_code=502, detail="Failed to connect to server")

    tools = await tool_discovery.discover_tools(server_id)
    return {"connected": True, "tools": tools}


@router.post("/servers/{server_id}/disconnect")
async def disconnect_mcp_server(server_id: str) -> dict[str, str]:
    """Disconnect from an MCP server."""
    from app.services.mcp.connection import connection_manager
    await connection_manager.disconnect(server_id)
    return {"message": "Disconnected"}


@router.get("/servers/{server_id}/health")
async def get_mcp_server_health(server_id: str) -> dict[str, Any]:
    """Get health status for an MCP server."""
    from app.services.mcp.health import health_monitor
    from app.services.mcp.server_manager import server_manager

    server = await server_manager.get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    score = await health_monitor.get_health_score(server_id)
    return {
        "server_id": server_id,
        "health_score": score,
        "healthy": score >= 0.3,
        "consecutive_failures": server["health_consecutive_failures"],
    }


@router.post("/servers/{server_id}/reset-health")
async def reset_mcp_server_health(server_id: str) -> dict[str, str]:
    """Reset health stats for an MCP server."""
    from app.services.mcp.health import health_monitor
    await health_monitor.reset_health(server_id)
    return {"message": "Health stats reset"}


# ── MCP Credentials ─────────────────────────────────────────────────

@router.get("/servers/{server_id}/credentials")
async def list_mcp_credentials(server_id: str) -> list[dict[str, Any]]:
    """List credentials for an MCP server (metadata only, not decrypted)."""
    from app.services.mcp.authentication import credential_manager
    creds = await credential_manager.get_credentials_for_server(server_id)
    # Return metadata only (not auth_config)
    return [{"credential_id": c["credential_id"], "auth_type": c["auth_type"]} for c in creds]


@router.post("/servers/{server_id}/credentials")
async def create_mcp_credential(server_id: str, request: MCPCredentialCreateRequest) -> dict[str, str]:
    """Store an encrypted credential for an MCP server."""
    from app.services.mcp.authentication import credential_manager
    from app.services.mcp.server_manager import server_manager

    server = await server_manager.get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    cred_id = await credential_manager.store_credential(
        server_id=server_id,
        auth_type=request.auth_type,
        auth_config=request.auth_config,
    )
    return {"credential_id": cred_id, "message": "Credential stored"}


@router.delete("/credentials/{credential_id}")
async def delete_mcp_credential(credential_id: str) -> dict[str, str]:
    """Delete an MCP credential."""
    from app.services.mcp.authentication import credential_manager
    deleted = await credential_manager.delete_credential(credential_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"message": "Credential deleted"}


# ── New Credential Endpoints (Milestone 1) ──────────────────────────

@router.put("/servers/{server_id}/credentials")
async def upsert_mcp_credential(server_id: str, request: MCPCredentialCreateRequest) -> dict[str, Any]:
    """Store or update an MCP credential with per-type encrypted fields.

    Replaces the previous credential for this server if one exists.
    """
    from uuid import uuid4

    from app.database import db
    from app.services.mcp.authentication import MCPAuthenticationService
    from app.services.mcp.validation import validate_credential_payload, CredentialPayload

    # Validate the server exists
    server = await db.get_mcp_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Validate the credential payload
    try:
        validated = validate_credential_payload(request.auth_config)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Check if a credential already exists for this server
    existing = await db.get_mcp_credential_for_server(server_id)
    credential_id = existing["credential_id"] if existing else f"cred_{uuid4().hex[:12]}"

    # Store using the new authentication service
    auth_service = MCPAuthenticationService()
    await auth_service.store_credential(
        credential_id=credential_id,
        server_id=server_id,
        auth_type=validated.auth_type,
        payload=request.auth_config,
    )

    return {"credential_id": credential_id, "message": "Credential stored"}


@router.get("/servers/{server_id}/credentials/metadata")
async def get_mcp_credential_metadata(server_id: str) -> dict[str, Any] | None:
    """Get credential metadata (no secrets) for a server."""
    from app.database import db
    from app.services.mcp.authentication import MCPAuthenticationService

    existing = await db.get_mcp_credential_for_server(server_id)
    if not existing:
        return None

    auth_service = MCPAuthenticationService()
    return await auth_service.get_credential_metadata(existing["credential_id"])


# ── Server Test Endpoint (Milestone 1) ──────────────────────────────

@router.post("/servers/{server_id}/test")
async def test_mcp_server(server_id: str) -> dict[str, Any]:
    """Test connection to an MCP server.

    Validates the URL, resolves DNS, and attempts a basic handshake.
    Does NOT store any credentials or tools.
    """
    import time

    from app.database import db
    from app.services.mcp.authentication import MCPAuthenticationService
    from app.services.mcp.validation import validate_mcp_url
    from app.services.mcp.errors import MCPError

    server = await db.get_mcp_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    url = server.get("url")
    if not url:
        raise HTTPException(status_code=422, detail="Server has no URL configured")

    # Validate URL (SSRF protection)
    try:
        validate_mcp_url(url)
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_code": "SSRF_BLOCKED",
            "latency_ms": 0,
        }

    # Resolve credentials
    auth_service = MCPAuthenticationService()
    resolved = await auth_service.resolve_credentials(server_id)

    # Attempt connection
    start = time.monotonic()
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                url,
                headers=resolved.headers,
                params=resolved.query_params,
            )
            latency_ms = int((time.monotonic() - start) * 1000)

            if response.status_code < 400:
                return {
                    "success": True,
                    "latency_ms": latency_ms,
                    "status_code": response.status_code,
                }
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}",
                    "error_code": "HTTP_ERROR",
                    "latency_ms": latency_ms,
                }
    except httpx.TimeoutException:
        latency_ms = int((time.monotonic() - start) * 1000)
        return {
            "success": False,
            "error": "Connection timed out",
            "error_code": "TIMEOUT",
            "latency_ms": latency_ms,
        }
    except httpx.ConnectError as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        return {
            "success": False,
            "error": f"Connection failed: {e}",
            "error_code": "CONNECT_ERROR",
            "latency_ms": latency_ms,
        }
    except Exception as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        return {
            "success": False,
            "error": f"Test failed: {e}",
            "error_code": "UNKNOWN_ERROR",
            "latency_ms": latency_ms,
        }


# ── Tool Discovery & Registry ───────────────────────────────────────

@router.get("/tools")
async def list_mcp_tools() -> list[dict[str, Any]]:
    """List all tools from all enabled MCP servers."""
    from app.services.mcp.server_manager import server_manager
    return await server_manager.get_all_tools()


@router.post("/discover")
async def discover_all_tools() -> dict[str, Any]:
    """Trigger tool discovery from all enabled MCP servers."""
    from app.services.mcp.discovery import tool_discovery
    result = await tool_discovery.discover_all()
    total = sum(len(tools) for tools in result.values())
    return {"servers": len(result), "total_tools": total, "tools_by_server": {k: len(v) for k, v in result.items()}}


# ── Tool Usage Stats ────────────────────────────────────────────────

@router.get("/stats")
async def get_tool_stats() -> dict[str, Any]:
    """Get tool usage statistics."""
    from app.observability.metrics import agent_metrics
    return await agent_metrics.get_summary()


@router.get("/stats/tools")
async def get_tool_stats_detail() -> list[dict[str, Any]]:
    """Get detailed tool usage statistics."""
    from app.observability.metrics import agent_metrics
    return await agent_metrics.get_tool_metrics()
