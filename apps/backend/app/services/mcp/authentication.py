"""MCP authentication — credential resolution and injection.

Resolves per-type encrypted credentials into HTTP headers.
Connection layer only receives ResolvedMCPCredentials — it does not care
whether the token came from an API key, OAuth, or an encrypted database field.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.crypto import decrypt, encrypt

logger = logging.getLogger(__name__)


@dataclass
class ResolvedMCPCredentials:
    """Resolved credentials ready for the transport layer.

    The connection manager only uses this — it never touches the database
    or encryption layer directly.
    """

    auth_type: str
    headers: dict[str, str] = field(default_factory=dict)
    query_params: dict[str, str] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.headers and not self.query_params


def _encrypt(value: str) -> str:
    """Encrypt a string value using Fernet."""
    return encrypt(value)


def _decrypt(value: str | None) -> str | None:
    """Decrypt a string value using Fernet. Returns None on failure."""
    if not value:
        return None
    return decrypt(value)


def _encrypt_dict(data: dict[str, Any]) -> str:
    """Encrypt a dict as JSON."""
    return encrypt(json.dumps(data))


def _decrypt_dict(encrypted: str | None) -> dict[str, Any] | None:
    """Decrypt a JSON dict. Returns None on failure."""
    if not encrypted:
        return None
    decrypted = decrypt(encrypted)
    if not decrypted:
        return None
    try:
        return json.loads(decrypted)
    except (json.JSONDecodeError, TypeError):
        return None


class MCPAuthenticationService:
    """Manages MCP server credentials with per-type encrypted storage.

    Stores credentials in per-type columns on MCPCredential.
    Also writes to auth_config during the migration bridge period.
    """

    async def store_credential(
        self,
        credential_id: str,
        server_id: str,
        auth_type: str,
        payload: dict[str, Any],
    ) -> None:
        """Store a credential from a validated CredentialPayload.

        Writes to both per-type columns AND auth_config (migration bridge).
        """
        # Encrypt per-type fields
        per_type = self._encrypt_per_type(auth_type, payload)
        # Also encrypt the whole payload for auth_config (migration bridge)
        encrypted_auth_config = _encrypt_dict(payload)

        await db.upsert_mcp_credential(
            credential_id=credential_id,
            server_id=server_id,
            auth_type=auth_type,
            auth_config_encrypted=encrypted_auth_config,
            **per_type,
        )
        logger.info("Stored credential %s for server %s (type=%s)", credential_id, server_id, auth_type)

    def _encrypt_per_type(self, auth_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Encrypt fields based on auth_type."""
        result: dict[str, Any] = {}

        if auth_type == "api_key":
            result["api_key_header_name"] = payload.get("header_name", "X-API-Key")
            result["encrypted_api_key"] = _encrypt(payload.get("api_key", ""))

        elif auth_type == "bearer":
            result["encrypted_access_token"] = _encrypt(payload.get("access_token", ""))

        elif auth_type == "basic":
            result["encrypted_username"] = _encrypt(payload.get("username", ""))
            result["encrypted_password"] = _encrypt(payload.get("password", ""))

        elif auth_type == "custom_headers":
            headers = payload.get("headers", {})
            result["encrypted_custom_headers"] = _encrypt_dict(headers)

        elif auth_type == "oauth":
            result["oauth_authorization_url"] = payload.get("authorization_url")
            result["oauth_token_url"] = payload.get("token_url")
            result["oauth_client_id"] = payload.get("client_id")
            if payload.get("client_secret"):
                result["encrypted_client_secret"] = _encrypt(payload["client_secret"])
            result["oauth_scope"] = json.dumps(payload.get("scopes", []))
            # If we have tokens from a previous exchange, store them
            if payload.get("access_token"):
                result["encrypted_access_token"] = _encrypt(payload["access_token"])
            if payload.get("refresh_token"):
                result["encrypted_refresh_token"] = _encrypt(payload["refresh_token"])
            if payload.get("token_expiry"):
                result["token_expiry"] = payload["token_expiry"]

        return result

    async def resolve_credentials(self, server_id: str) -> ResolvedMCPCredentials:
        """Resolve stored credentials into HTTP headers for the transport layer.

        Returns ResolvedMCPCredentials with ready-to-use headers.
        """
        row = await db.get_mcp_credential_for_server(server_id)
        if not row:
            return ResolvedMCPCredentials(auth_type="none")

        auth_type = row["auth_type"]

        if auth_type == "none":
            return ResolvedMCPCredentials(auth_type="none")

        if auth_type == "api_key":
            header_name = row.get("api_key_header_name", "X-API-Key")
            api_key = _decrypt(row.get("encrypted_api_key"))
            if api_key:
                return ResolvedMCPCredentials(
                    auth_type="api_key",
                    headers={header_name: api_key},
                )
            # Fallback to auth_config during migration
            config = _decrypt_dict(row.get("auth_config"))
            if config:
                header_name = config.get("header_name", "X-API-Key")
                api_key = config.get("key", "")
                if api_key:
                    return ResolvedMCPCredentials(
                        auth_type="api_key",
                        headers={header_name: api_key},
                    )
            return ResolvedMCPCredentials(auth_type="api_key")

        if auth_type == "bearer":
            token = _decrypt(row.get("encrypted_access_token"))
            if token:
                return ResolvedMCPCredentials(
                    auth_type="bearer",
                    headers={"Authorization": f"Bearer {token}"},
                )
            # Fallback to auth_config
            config = _decrypt_dict(row.get("auth_config"))
            if config and config.get("token"):
                return ResolvedMCPCredentials(
                    auth_type="bearer",
                    headers={"Authorization": f"Bearer {config['token']}"},
                )
            return ResolvedMCPCredentials(auth_type="bearer")

        if auth_type == "basic":
            username = _decrypt(row.get("encrypted_username"))
            password = _decrypt(row.get("encrypted_password"))
            if username is not None:
                import base64
                credentials = base64.b64encode(f"{username}:{password or ''}".encode()).decode()
                return ResolvedMCPCredentials(
                    auth_type="basic",
                    headers={"Authorization": f"Basic {credentials}"},
                )
            # Fallback to auth_config
            config = _decrypt_dict(row.get("auth_config"))
            if config and config.get("username") is not None:
                import base64
                credentials = base64.b64encode(
                    f"{config['username']}:{config.get('password', '')}".encode()
                ).decode()
                return ResolvedMCPCredentials(
                    auth_type="basic",
                    headers={"Authorization": f"Basic {credentials}"},
                )
            return ResolvedMCPCredentials(auth_type="basic")

        if auth_type == "custom_headers":
            headers = _decrypt_dict(row.get("encrypted_custom_headers"))
            if headers:
                return ResolvedMCPCredentials(
                    auth_type="custom_headers",
                    headers=headers,
                )
            # Fallback to auth_config
            config = _decrypt_dict(row.get("auth_config"))
            if config and config.get("headers"):
                return ResolvedMCPCredentials(
                    auth_type="custom_headers",
                    headers=config["headers"],
                )
            return ResolvedMCPCredentials(auth_type="custom_headers")

        if auth_type == "oauth":
            # For OAuth, we need to check token expiry and potentially refresh
            token = _decrypt(row.get("encrypted_access_token"))
            if token:
                # Check if token is expired
                expiry = row.get("token_expiry")
                if expiry:
                    from datetime import datetime, timezone
                    try:
                        expiry_dt = datetime.fromisoformat(expiry)
                        if expiry_dt.tzinfo is None:
                            expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
                        if datetime.now(timezone.utc) > expiry_dt:
                            # Token expired — need refresh (will be handled by connection layer)
                            refresh_token = _decrypt(row.get("encrypted_refresh_token"))
                            if refresh_token:
                                logger.info("OAuth token expired for server %s, refresh available", server_id)
                            else:
                                logger.warning("OAuth token expired for server %s, no refresh token", server_id)
                    except (ValueError, TypeError):
                        pass
                return ResolvedMCPCredentials(
                    auth_type="oauth",
                    headers={"Authorization": f"Bearer {token}"},
                )
            # Fallback to auth_config
            config = _decrypt_dict(row.get("auth_config"))
            if config and config.get("token"):
                return ResolvedMCPCredentials(
                    auth_type="oauth",
                    headers={"Authorization": f"Bearer {config['token']}"},
                )
            return ResolvedMCPCredentials(auth_type="oauth")

        # Unknown auth type
        logger.warning("Unknown auth type %s for server %s", auth_type, server_id)
        return ResolvedMCPCredentials(auth_type=auth_type)

    async def delete_credential(self, credential_id: str) -> bool:
        """Delete a credential."""
        return await db.delete_mcp_credential(credential_id)

    async def get_credential_metadata(self, credential_id: str) -> dict[str, Any] | None:
        """Get credential metadata (no secrets)."""
        row = await db.get_mcp_credential(credential_id)
        if not row:
            return None
        return {
            "credential_id": row["credential_id"],
            "server_id": row["server_id"],
            "auth_type": row["auth_type"],
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }


# Lazy import to avoid circular dependency
db = None


def _get_db():
    global db
    if db is None:
        from app.database import db as _db
        db = _db
    return db


class _DBProxy:
    """Proxy that delegates to the actual db singleton."""

    def __getattr__(self, name: str):
        return getattr(_get_db(), name)


db = _DBProxy()


# Legacy alias for backward compatibility
credential_manager = MCPAuthenticationService()
