"""MCP-specific exceptions.

All MCP errors inherit from MCPError so they can be caught uniformly.
"""

from __future__ import annotations


class MCPError(Exception):
    """Base class for all MCP errors."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


class MCPConnectionError(MCPError):
    """Failed to connect to the MCP server."""


class MCPAuthenticationError(MCPError):
    """Authentication failed (bad credentials, expired token, etc.)."""


class MCPAuthorizationError(MCPError):
    """Authorization failed (valid token, insufficient permissions)."""


class MCPTimeoutError(MCPError):
    """Connection or tool call timed out."""


class MCPToolError(MCPError):
    """Tool call failed (schema mismatch, runtime error, etc.)."""


class MCPSSRFError(MCPError):
    """URL targets a private/internal address."""


class MCPCredentialValidationError(MCPError):
    """Credential payload is invalid (CRLF injection, missing fields, etc.)."""


class MCPDiscoveryError(MCPError):
    """Tool discovery failed."""


class MCPOAuthError(MCPError):
    """OAuth flow error (bad state, token exchange failed, etc.)."""


class MCPRateLimitError(MCPError):
    """Rate limit exceeded."""
