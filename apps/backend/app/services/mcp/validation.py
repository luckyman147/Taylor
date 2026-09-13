"""SSRF protection and credential validation for MCP.

Resolves DNS and checks the resulting IP against private/internal ranges
before allowing a connection. Also validates credential payloads against
CRLF injection, missing fields, etc.
"""

from __future__ import annotations

import ipaddress
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.services.mcp.errors import MCPSSRFError, MCPCredentialValidationError

logger = logging.getLogger(__name__)

# RFC1918 + loopback + link-local + cloud metadata
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local + cloud metadata
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("::ffff:127.0.0.0/104"),
    ipaddress.ip_network("0.0.0.0/8"),
]

# Headers that must never appear in credentials
FORBIDDEN_HEADERS = frozenset({
    "host", "content-length", "connection", "transfer-encoding",
    "content-type", "authorization",  # authorization is set by the transport
})

# CRLF characters
_CRLF_RE = re.compile(r"[\r\n]")

# Allowed auth types
VALID_AUTH_TYPES = frozenset({"none", "api_key", "bearer", "basic", "custom_headers", "oauth"})


def _resolve_and_validate_ip(hostname: str) -> None:
    """Resolve DNS and reject private/internal targets."""
    import socket

    try:
        addrinfos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise MCPSSRFError(f"DNS resolution failed for {hostname}: {exc}") from exc

    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip = ipaddress.ip_address(sockaddr[0])
        for network in _BLOCKED_NETWORKS:
            if ip in network:
                raise MCPSSRFError(
                    f"URL resolves to private/internal address {ip} ({network}), "
                    f"which is not allowed for security reasons"
                )


def validate_mcp_url(url: str) -> None:
    """Validate an MCP server URL: must be HTTP(S), not targeting internal IPs."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise MCPSSRFError(f"Invalid scheme {parsed.scheme!r}, must be http or https")

    hostname = parsed.hostname
    if not hostname:
        raise MCPSSRFError("URL has no hostname")

    # Reject localhost by hostname
    if hostname in ("localhost", "0.0.0.0", "::1", "[::1]"):
        raise MCPSSRFError("URL targets localhost, which is not allowed")

    _resolve_and_validate_ip(hostname)


def validate_credential_headers(
    headers: dict[str, str],
    *,
    reject_auth: bool = True,
) -> None:
    """Validate credential headers against CRLF injection and forbidden names.

    When reject_auth=True (default), headers like 'authorization' and
    'content-type' are rejected because they are managed by the transport layer.
    Pass reject_auth=False for internally constructed headers (e.g. bearer).
    """
    for name, value in headers.items():
        if not name:
            raise MCPCredentialValidationError("Header name must not be empty")
        if _CRLF_RE.search(name):
            raise MCPCredentialValidationError(
                f"Header name {name!r} contains CR/LF characters (CRLF injection)"
            )
        if _CRLF_RE.search(value):
            raise MCPCredentialValidationError(
                f"Header value for {name!r} contains CR/LF characters (CRLF injection)"
            )
        if reject_auth and name.lower() in FORBIDDEN_HEADERS:
            raise MCPCredentialValidationError(
                f"Header {name!r} is reserved and cannot be set via credentials"
            )


def validate_auth_type(auth_type: str) -> None:
    """Validate that the auth type is supported."""
    if auth_type not in VALID_AUTH_TYPES:
        raise MCPCredentialValidationError(
            f"Unsupported auth type {auth_type!r}, must be one of: "
            f"{', '.join(sorted(VALID_AUTH_TYPES))}"
        )


@dataclass
class CredentialPayload:
    """Validated credential payload from the frontend."""

    auth_type: str
    api_key_header_name: str | None = None
    api_key: str | None = None
    access_token: str | None = None
    username: str | None = None
    password: str | None = None
    custom_headers: dict[str, str] | None = None
    # OAuth
    authorization_url: str | None = None
    token_url: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scopes: list[str] | None = None


def validate_credential_payload(payload: dict[str, Any]) -> CredentialPayload:
    """Parse and validate a credential payload from the frontend.

    Returns a validated CredentialPayload or raises MCPCredentialValidationError.
    """
    auth_type = payload.get("auth_type", "none")
    validate_auth_type(auth_type)

    if auth_type == "none":
        return CredentialPayload(auth_type="none")

    if auth_type == "api_key":
        api_key = payload.get("api_key", "")
        header_name = payload.get("header_name", "X-API-Key")
        if not api_key:
            raise MCPCredentialValidationError("API key is required")
        if not header_name:
            raise MCPCredentialValidationError("Header name is required")
        # Validate the header that will be injected
        validate_credential_headers({header_name: api_key})
        return CredentialPayload(
            auth_type="api_key",
            api_key_header_name=header_name,
            api_key=api_key,
        )

    if auth_type == "bearer":
        token = payload.get("access_token", "")
        if not token:
            raise MCPCredentialValidationError("Bearer token is required")
        # Only check for CRLF injection, don't reject Authorization header
        if _CRLF_RE.search(token):
            raise MCPCredentialValidationError(
                "Bearer token contains CR/LF characters (CRLF injection)"
            )
        return CredentialPayload(auth_type="bearer", access_token=token)

    if auth_type == "basic":
        username = payload.get("username", "")
        password = payload.get("password", "")
        if not username:
            raise MCPCredentialValidationError("Username is required")
        if _CRLF_RE.search(username) or _CRLF_RE.search(password):
            raise MCPCredentialValidationError(
                "Username or password contains CR/LF characters (CRLF injection)"
            )
        return CredentialPayload(
            auth_type="basic",
            username=username,
            password=password,
        )

    if auth_type == "custom_headers":
        headers = payload.get("headers", {})
        if not headers:
            raise MCPCredentialValidationError("At least one custom header is required")
        validate_credential_headers(headers)
        return CredentialPayload(auth_type="custom_headers", custom_headers=headers)

    if auth_type == "oauth":
        client_id = payload.get("client_id", "")
        if not client_id:
            raise MCPCredentialValidationError("OAuth client ID is required")
        token_url = payload.get("token_url", "")
        authorization_url = payload.get("authorization_url", "")
        if token_url:
            validate_mcp_url(token_url)
        if authorization_url:
            validate_mcp_url(authorization_url)
        return CredentialPayload(
            auth_type="oauth",
            authorization_url=authorization_url or None,
            token_url=token_url or None,
            client_id=client_id,
            client_secret=payload.get("client_secret") or None,
            scopes=payload.get("scopes") or None,
        )

    raise MCPCredentialValidationError(f"Unhandled auth type: {auth_type}")
