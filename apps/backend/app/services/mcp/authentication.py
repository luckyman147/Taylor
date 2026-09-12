"""MCP Credential Manager — encrypted storage and injection.

Handles CRUD for MCP server credentials (API keys, bearer tokens, OAuth tokens, etc.).
Credentials are encrypted via Fernet (same as LLM API keys) and never exposed to the LLM.
"""

import json
import logging
from typing import Any
from uuid import uuid4

from app.crypto import decrypt, encrypt
from app.database import db

logger = logging.getLogger(__name__)


class MCPCredentialManager:
    """Encrypted credential storage for MCP servers.

    Credentials are stored as encrypted JSON in the mcp_credentials table.
    They are injected at the HTTP transport layer only — the LLM never sees them.
    """

    async def store_credential(
        self,
        server_id: str,
        auth_type: str,
        auth_config: dict[str, Any],
    ) -> str:
        """Store an encrypted credential for an MCP server.

        Args:
            server_id: The MCP server ID.
            auth_type: One of: api_key, bearer, oauth, env_vars, custom_headers.
            auth_config: The credential data (will be encrypted).

        Returns:
            The credential ID.
        """
        credential_id = f"cred_{uuid4().hex[:12]}"
        encrypted = encrypt(json.dumps(auth_config))
        await db.create_mcp_credential(
            credential_id=credential_id,
            server_id=server_id,
            auth_type=auth_type,
            auth_config_encrypted=encrypted,
        )
        logger.info("Stored credential %s for server %s (type=%s)", credential_id, server_id, auth_type)
        return credential_id

    async def get_credential(self, credential_id: str) -> dict[str, Any] | None:
        """Retrieve and decrypt a credential."""
        row = await db.get_mcp_credential(credential_id)
        if not row:
            return None
        decrypted = decrypt(row["auth_config"])
        if not decrypted:
            logger.warning("Failed to decrypt credential %s", credential_id)
            return None
        return {
            "credential_id": row["credential_id"],
            "server_id": row["server_id"],
            "auth_type": row["auth_type"],
            "auth_config": json.loads(decrypted),
        }

    async def get_credentials_for_server(self, server_id: str) -> list[dict[str, Any]]:
        """Get all decrypted credentials for a server."""
        rows = await db.get_mcp_credentials_for_server(server_id)
        results = []
        for row in rows:
            decrypted = decrypt(row["auth_config"])
            if decrypted:
                results.append({
                    "credential_id": row["credential_id"],
                    "server_id": row["server_id"],
                    "auth_type": row["auth_type"],
                    "auth_config": json.loads(decrypted),
                })
        return results

    async def delete_credential(self, credential_id: str) -> bool:
        """Delete a credential."""
        return await db.delete_mcp_credential(credential_id)

    async def get_auth_headers(self, server_id: str) -> dict[str, str]:
        """Build HTTP headers from stored credentials for a server.

        Returns empty dict if no credentials found.
        Headers are ready to pass to httpx/aiohttp.
        """
        credentials = await self.get_credentials_for_server(server_id)
        headers: dict[str, str] = {}
        for cred in credentials:
            auth_type = cred["auth_type"]
            config = cred["auth_config"]
            if auth_type == "api_key":
                header_name = config.get("header_name", "X-API-Key")
                headers[header_name] = config.get("key", "")
            elif auth_type == "bearer":
                headers["Authorization"] = f"Bearer {config.get('token', '')}"
            elif auth_type == "custom_headers":
                for k, v in config.get("headers", {}).items():
                    headers[k] = v
        return headers


credential_manager = MCPCredentialManager()
