"""MCP OAuth package — OAuth 2.0 + PKCE support for MCP servers.

Provides:
- PKCE code_verifier/code_challenge generation
- OAuth state management (CSRF prevention, expiry, ownership)
- Token exchange and auto-refresh
"""

from app.services.mcp.oauth.pkce import generate_code_verifier, generate_code_challenge, generate_pkce_pair
from app.services.mcp.oauth.state import generate_oauth_state, validate_oauth_state, mark_state_used, OAuthState
from app.services.mcp.oauth.client import OAuthTokenClient, oauth_client

__all__ = [
    "generate_code_verifier",
    "generate_code_challenge",
    "generate_pkce_pair",
    "generate_oauth_state",
    "validate_oauth_state",
    "mark_state_used",
    "OAuthState",
    "OAuthTokenClient",
    "oauth_client",
]
