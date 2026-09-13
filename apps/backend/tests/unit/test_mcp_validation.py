"""Tests for MCP validation (SSRF protection, credential validation)."""

import pytest
from app.services.mcp.validation import (
    validate_mcp_url,
    validate_credential_headers,
    validate_credential_payload,
    validate_auth_type,
    VALID_AUTH_TYPES,
    FORBIDDEN_HEADERS,
)
from app.services.mcp.errors import MCPSSRFError, MCPCredentialValidationError


class TestSSRFProtection:
    """Test SSRF protection for MCP URLs."""

    def test_blocks_localhost(self):
        with pytest.raises(MCPSSRFError, match="localhost"):
            validate_mcp_url("http://localhost:8080/mcp")

    def test_blocks_loopback(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://127.0.0.1:8080/mcp")

    def test_blocks_private_10(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://10.0.0.1/mcp")

    def test_blocks_private_172(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://172.16.0.1/mcp")

    def test_blocks_private_192(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://192.168.1.1/mcp")

    def test_blocks_link_local(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://169.254.169.254/mcp")

    def test_blocks_zero(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://0.0.0.0/mcp")

    def test_blocks_ipv6_loopback(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://[::1]/mcp")

    def test_rejects_non_http(self):
        with pytest.raises(MCPSSRFError, match="Invalid scheme"):
            validate_mcp_url("ftp://example.com/mcp")

    def test_rejects_missing_hostname(self):
        with pytest.raises(MCPSSRFError, match="no hostname"):
            validate_mcp_url("http:///mcp")


class TestCredentialHeaders:
    """Test credential header validation."""

    def test_blocks_authorization_header(self):
        with pytest.raises(MCPCredentialValidationError, match="reserved"):
            validate_credential_headers({"Authorization": "Bearer token"})

    def test_blocks_content_type_header(self):
        with pytest.raises(MCPCredentialValidationError, match="reserved"):
            validate_credential_headers({"Content-Type": "application/json"})

    def test_blocks_host_header(self):
        with pytest.raises(MCPSSRFError):
            validate_mcp_url("http://host:80/mcp")

    def test_allows_custom_headers(self):
        validate_credential_headers({"X-API-Key": "test-key", "X-Custom": "value"})

    def test_blocks_crlf_in_name(self):
        with pytest.raises(MCPCredentialValidationError, match="CR/LF"):
            validate_credential_headers({"X-Test\r\nEvil": "value"})

    def test_blocks_crlf_in_value(self):
        with pytest.raises(MCPCredentialValidationError, match="CR/LF"):
            validate_credential_headers({"X-Test": "value\r\nEvil"})

    def test_rejects_empty_name(self):
        with pytest.raises(MCPCredentialValidationError, match="empty"):
            validate_credential_headers({"": "value"})


class TestCredentialPayload:
    """Test credential payload validation."""

    def test_none_auth_type(self):
        payload = validate_credential_payload({"auth_type": "none"})
        assert payload.auth_type == "none"

    def test_api_key_valid(self):
        payload = validate_credential_payload({
            "auth_type": "api_key",
            "api_key": "sk-123",
            "header_name": "X-API-Key",
        })
        assert payload.auth_type == "api_key"
        assert payload.api_key == "sk-123"
        assert payload.api_key_header_name == "X-API-Key"

    def test_api_key_missing(self):
        with pytest.raises(MCPCredentialValidationError, match="required"):
            validate_credential_payload({"auth_type": "api_key"})

    def test_bearer_valid(self):
        payload = validate_credential_payload({
            "auth_type": "bearer",
            "access_token": "tok-123",
        })
        assert payload.auth_type == "bearer"
        assert payload.access_token == "tok-123"

    def test_bearer_missing(self):
        with pytest.raises(MCPCredentialValidationError, match="required"):
            validate_credential_payload({"auth_type": "bearer"})

    def test_bearer_crlf_rejected(self):
        with pytest.raises(MCPCredentialValidationError, match="CR/LF"):
            validate_credential_payload({
                "auth_type": "bearer",
                "access_token": "tok\r\n123",
            })

    def test_basic_valid(self):
        payload = validate_credential_payload({
            "auth_type": "basic",
            "username": "admin",
            "password": "pass",
        })
        assert payload.auth_type == "basic"
        assert payload.username == "admin"

    def test_basic_missing_username(self):
        with pytest.raises(MCPCredentialValidationError, match="required"):
            validate_credential_payload({"auth_type": "basic"})

    def test_basic_crlf_rejected(self):
        with pytest.raises(MCPCredentialValidationError, match="CR/LF"):
            validate_credential_payload({
                "auth_type": "basic",
                "username": "admin\r\n",
                "password": "pass",
            })

    def test_custom_headers_valid(self):
        payload = validate_credential_payload({
            "auth_type": "custom_headers",
            "headers": {"X-Custom": "value"},
        })
        assert payload.auth_type == "custom_headers"
        assert payload.custom_headers == {"X-Custom": "value"}

    def test_custom_headers_empty(self):
        with pytest.raises(MCPCredentialValidationError, match="required"):
            validate_credential_payload({"auth_type": "custom_headers", "headers": {}})

    def test_oauth_valid(self):
        payload = validate_credential_payload({
            "auth_type": "oauth",
            "client_id": "abc",
            "token_url": "https://example.com/token",
        })
        assert payload.auth_type == "oauth"
        assert payload.client_id == "abc"

    def test_oauth_missing_client_id(self):
        with pytest.raises(MCPCredentialValidationError, match="required"):
            validate_credential_payload({"auth_type": "oauth"})

    def test_invalid_auth_type(self):
        with pytest.raises(MCPCredentialValidationError, match="Unsupported"):
            validate_credential_payload({"auth_type": "invalid_type"})


class TestAuthTypes:
    """Test valid auth types."""

    def test_all_valid_types(self):
        assert VALID_AUTH_TYPES == frozenset({
            "none", "api_key", "bearer", "basic", "custom_headers", "oauth"
        })

    def test_validate_valid_type(self):
        validate_auth_type("api_key")  # Should not raise

    def test_validate_invalid_type(self):
        with pytest.raises(MCPCredentialValidationError):
            validate_auth_type("invalid")
