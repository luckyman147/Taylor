"""MCP status and configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.job_scraper import (
    MCPConfigureRequest,
    MCPStatusResponse,
)
from app.services.job_scraper import get_mcp_manager

router = APIRouter(prefix="/mcp", tags=["MCP"])


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
