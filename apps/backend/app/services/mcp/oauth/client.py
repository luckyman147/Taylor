"""OAuth client — token exchange and auto-refresh.

Handles the OAuth 2.0 Authorization Code + PKCE flow:
1. Exchange authorization code for tokens
2. Store encrypted tokens
3. Auto-refresh expired tokens before connecting
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.crypto import encrypt, decrypt
from app.database import db
from app.services.mcp.errors import MCPOAuthError

logger = logging.getLogger(__name__)


class OAuthTokenClient:
    """Handles OAuth token exchange and refresh."""

    async def exchange_code(
        self,
        token_url: str,
        code: str,
        code_verifier: str,
        client_id: str,
        client_secret: str | None = None,
        redirect_uri: str | None = None,
    ) -> dict[str, Any]:
        """Exchange an authorization code for tokens.

        Returns:
            {
                "access_token": str,
                "refresh_token": str | None,
                "token_type": str,
                "expires_in": int | None,
                "scope": str | None,
            }

        Raises:
            MCPOAuthError if the exchange fails.
        """
        data: dict[str, str | None] = {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": code_verifier,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
        }
        if client_secret:
            data["client_secret"] = client_secret

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    token_url,
                    data={k: v for k, v in data.items() if v is not None},
                    headers={"Accept": "application/json"},
                )

                if response.status_code >= 400:
                    error_detail = response.text
                    try:
                        error_json = response.json()
                        error_detail = error_json.get("error_description", error_json.get("error", error_detail))
                    except Exception:
                        pass
                    raise MCPOAuthError(
                        f"Token exchange failed: {response.status_code} - {error_detail}",
                        code="TOKEN_EXCHANGE_FAILED",
                    )

                result = response.json()
                if "error" in result:
                    raise MCPOAuthError(
                        f"Token exchange error: {result.get('error_description', result['error'])}",
                        code="TOKEN_EXCHANGE_ERROR",
                    )

                return {
                    "access_token": result.get("access_token", ""),
                    "refresh_token": result.get("refresh_token"),
                    "token_type": result.get("token_type", "Bearer"),
                    "expires_in": result.get("expires_in"),
                    "scope": result.get("scope"),
                }

        except httpx.TimeoutException:
            raise MCPOAuthError("Token exchange timed out", code="TIMEOUT")
        except httpx.ConnectError as e:
            raise MCPOAuthError(f"Token exchange connection failed: {e}", code="CONNECT_ERROR")
        except MCPOAuthError:
            raise
        except Exception as e:
            raise MCPOAuthError(f"Token exchange failed: {e}", code="UNKNOWN_ERROR")

    async def refresh_token(
        self,
        token_url: str,
        refresh_token: str,
        client_id: str,
        client_secret: str | None = None,
    ) -> dict[str, Any]:
        """Refresh an expired access token.

        Returns:
            Same format as exchange_code.

        Raises:
            MCPOAuthError if the refresh fails.
        """
        data: dict[str, str | None] = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
        }
        if client_secret:
            data["client_secret"] = client_secret

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    token_url,
                    data={k: v for k, v in data.items() if v is not None},
                    headers={"Accept": "application/json"},
                )

                if response.status_code >= 400:
                    error_detail = response.text
                    try:
                        error_json = response.json()
                        error_detail = error_json.get("error_description", error_json.get("error", error_detail))
                    except Exception:
                        pass
                    raise MCPOAuthError(
                        f"Token refresh failed: {response.status_code} - {error_detail}",
                        code="REFRESH_FAILED",
                    )

                result = response.json()
                if "error" in result:
                    raise MCPOAuthError(
                        f"Token refresh error: {result.get('error_description', result['error'])}",
                        code="REFRESH_ERROR",
                    )

                return {
                    "access_token": result.get("access_token", ""),
                    "refresh_token": result.get("refresh_token", refresh_token),
                    "token_type": result.get("token_type", "Bearer"),
                    "expires_in": result.get("expires_in"),
                    "scope": result.get("scope"),
                }

        except httpx.TimeoutException:
            raise MCPOAuthError("Token refresh timed out", code="TIMEOUT")
        except httpx.ConnectError as e:
            raise MCPOAuthError(f"Token refresh connection failed: {e}", code="CONNECT_ERROR")
        except MCPOAuthError:
            raise
        except Exception as e:
            raise MCPOAuthError(f"Token refresh failed: {e}", code="UNKNOWN_ERROR")

    async def store_tokens(
        self,
        credential_id: str,
        tokens: dict[str, Any],
    ) -> None:
        """Store encrypted tokens in the MCPCredential table.

        Also computes and stores the token_expiry from expires_in.
        """
        # Compute expiry
        expires_in = tokens.get("expires_in")
        token_expiry = None
        if expires_in:
            expiry_dt = datetime.now(timezone.utc).timestamp() + expires_in
            token_expiry = datetime.fromtimestamp(expiry_dt, tz=timezone.utc).isoformat()

        # Encrypt tokens
        encrypted_access = encrypt(tokens.get("access_token", "")) if tokens.get("access_token") else None
        encrypted_refresh = encrypt(tokens.get("refresh_token", "")) if tokens.get("refresh_token") else None

        # Update the credential
        from app.models import MCPCredential
        from sqlalchemy import select

        async with db._session() as session:
            result = await session.execute(
                select(MCPCredential).where(MCPCredential.credential_id == credential_id)
            )
            row = result.scalar_one_or_none()
            if row:
                if encrypted_access:
                    row.encrypted_access_token = encrypted_access
                if encrypted_refresh:
                    row.encrypted_refresh_token = encrypted_refresh
                if token_expiry:
                    row.token_expiry = token_expiry
                row.updated_at = datetime.now(timezone.utc).isoformat()
                await session.commit()
                logger.info("Stored OAuth tokens for credential %s", credential_id)

    async def is_token_expired(self, credential_id: str) -> bool:
        """Check if a credential's OAuth token is expired."""
        row = await db.get_mcp_credential(credential_id)
        if not row:
            return True

        expiry_str = row.get("token_expiry")
        if not expiry_str:
            return False  # No expiry stored, assume not expired

        try:
            expiry_dt = datetime.fromisoformat(expiry_str)
            if expiry_dt.tzinfo is None:
                expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
            return datetime.now(timezone.utc) > expiry_dt
        except (ValueError, TypeError):
            return False

    async def auto_refresh_if_needed(self, server_id: str) -> bool:
        """Auto-refresh tokens for a server if expired.

        Returns True if tokens were refreshed, False if not needed.
        """
        from app.models import MCPCredential
        from sqlalchemy import select

        async with db._session() as session:
            result = await session.execute(
                select(MCPCredential).where(
                    MCPCredential.server_id == server_id,
                    MCPCredential.auth_type == "oauth",
                ).limit(1)
            )
            row = result.scalar_one_or_none()
            if not row:
                return False

            # Check expiry
            expiry_str = row.token_expiry
            if expiry_str:
                try:
                    expiry_dt = datetime.fromisoformat(expiry_str)
                    if expiry_dt.tzinfo is None:
                        expiry_dt = expiry_dt.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) <= expiry_dt:
                        return False  # Not expired
                except (ValueError, TypeError):
                    return False

            # Token expired, need refresh
            refresh_token = decrypt(row.encrypted_refresh_token)
            if not refresh_token:
                logger.warning("No refresh token for server %s, cannot auto-refresh", server_id)
                return False

            token_url = row.oauth_token_url
            client_id = row.oauth_client_id
            client_secret = decrypt(row.encrypted_client_secret)

            if not token_url or not client_id:
                logger.warning("Missing token_url or client_id for server %s", server_id)
                return False

            try:
                tokens = await self.refresh_token(
                    token_url=token_url,
                    refresh_token=refresh_token,
                    client_id=client_id,
                    client_secret=client_secret,
                )
                await self.store_tokens(row.credential_id, tokens)
                logger.info("Auto-refreshed OAuth tokens for server %s", server_id)
                return True
            except Exception as e:
                logger.error("Auto-refresh failed for server %s: %s", server_id, e)
                return False


oauth_client = OAuthTokenClient()
