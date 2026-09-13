"""Tests for MCP OAuth (PKCE, state management)."""

import time
import pytest
from app.services.mcp.oauth.pkce import (
    generate_code_verifier,
    generate_code_challenge,
    generate_pkce_pair,
)
from app.services.mcp.oauth.state import (
    generate_oauth_state,
    validate_oauth_state,
    STATE_EXPIRY_SECONDS,
)
from app.services.mcp.errors import MCPOAuthError


class TestPKCE:
    """Test PKCE code_verifier and code_challenge generation."""

    def test_verifier_length(self):
        verifier = generate_code_verifier()
        assert 43 <= len(verifier) <= 128

    def test_verifier_custom_length(self):
        verifier = generate_code_verifier(length=64)
        assert len(verifier) == 64

    def test_verifier_characters(self):
        import string
        verifier = generate_code_verifier()
        valid_chars = set(string.ascii_letters + string.digits + "-._~")
        assert all(c in valid_chars for c in verifier)

    def test_challenge_length(self):
        _, challenge = generate_pkce_pair()
        # Base64url encoded SHA-256 is always 43 characters
        assert len(challenge) == 43

    def test_challenge_is_base64url(self):
        _, challenge = generate_pkce_pair()
        import base64
        # Should not raise
        decoded = base64.urlsafe_b64decode(challenge + "==")
        assert len(decoded) == 32  # SHA-256 is 32 bytes

    def test_pair_is_deterministic(self):
        verifier1, challenge1 = generate_pkce_pair()
        verifier2, challenge2 = generate_pkce_pair()
        # Different verifiers should produce different challenges
        assert verifier1 != verifier2
        assert challenge1 != challenge2

    def test_challenge_from_verifier(self):
        verifier = generate_code_verifier()
        challenge = generate_code_challenge(verifier)
        # Verify it's the correct SHA-256 hash
        import hashlib
        import base64
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        assert challenge == expected


class TestOAuthState:
    """Test OAuth state generation and validation."""

    def test_generate_and_validate(self):
        state = generate_oauth_state(
            user_id="user1",
            server_id="mcp_server1",
            code_verifier="test_verifier_123",
            redirect_uri="http://localhost:3000/callback",
        )
        result = validate_oauth_state(state, "user1", "mcp_server1")
        assert result.state_id is not None
        assert result.user_id == "user1"
        assert result.server_id == "mcp_server1"
        assert result.code_verifier == "test_verifier_123"
        assert result.redirect_uri == "http://localhost:3000/callback"

    def test_wrong_user_rejected(self):
        state = generate_oauth_state(
            user_id="user1",
            server_id="mcp_server1",
            code_verifier="verifier",
            redirect_uri="http://localhost:3000/callback",
        )
        result = validate_oauth_state(state, "wrong_user", "mcp_server1")
        assert isinstance(result, str)
        assert "different user" in result

    def test_wrong_server_rejected(self):
        state = generate_oauth_state(
            user_id="user1",
            server_id="mcp_server1",
            code_verifier="verifier",
            redirect_uri="http://localhost:3000/callback",
        )
        result = validate_oauth_state(state, "user1", "wrong_server")
        assert isinstance(result, str)
        assert "different server" in result

    def test_expired_state_rejected(self):
        # Generate state with old timestamp
        from app.crypto import encrypt
        import json
        import base64
        import secrets

        old_data = {
            "state_id": secrets.token_hex(16),
            "user_id": "user1",
            "server_id": "mcp_server1",
            "code_verifier": "verifier",
            "redirect_uri": "http://localhost:3000/callback",
            "created_at": time.time() - STATE_EXPIRY_SECONDS - 1,  # Expired
        }
        encrypted = encrypt(json.dumps(old_data))
        state = base64.urlsafe_b64encode(encrypted.encode()).decode()

        result = validate_oauth_state(state, "user1", "mcp_server1")
        assert isinstance(result, str)
        assert "expired" in result

    def test_invalid_state_format(self):
        result = validate_oauth_state("invalid_state", "user1", "mcp_server1")
        assert isinstance(result, str)
        assert "Invalid" in result or "decrypt" in result

    def test_state_is_unique(self):
        state1 = generate_oauth_state("user1", "mcp1", "v1", "http://localhost/cb")
        state2 = generate_oauth_state("user1", "mcp1", "v1", "http://localhost/cb")
        assert state1 != state2

    def test_state_preserves_all_data(self):
        verifier = "my_custom_verifier_12345"
        redirect = "https://example.com/callback"
        state = generate_oauth_state("user1", "mcp1", verifier, redirect)
        result = validate_oauth_state(state, "user1", "mcp1")
        assert result.code_verifier == verifier
        assert result.redirect_uri == redirect
