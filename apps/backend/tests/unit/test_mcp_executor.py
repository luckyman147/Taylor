"""Tests for tool executor (schema validation, error classification, truncation)."""

import json
import pytest
from app.tools.executor import tool_executor


class TestSchemaValidation:
    """Test tool argument schema validation."""

    def test_valid_schema(self):
        result = tool_executor._validate_schema(
            {"q": "test"},
            json.dumps({"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]}),
        )
        assert result is None  # Valid

    def test_missing_required_field(self):
        result = tool_executor._validate_schema(
            {},
            json.dumps({"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]}),
        )
        assert result is not None
        assert "Missing required field" in result

    def test_wrong_type_string(self):
        result = tool_executor._validate_schema(
            {"q": 123},
            json.dumps({"type": "object", "properties": {"q": {"type": "string"}}}),
        )
        assert result is not None
        assert "should be a string" in result

    def test_wrong_type_integer(self):
        result = tool_executor._validate_schema(
            {"count": "not_a_number"},
            json.dumps({"type": "object", "properties": {"count": {"type": "integer"}}}),
        )
        assert result is not None
        assert "should be an integer" in result

    def test_wrong_type_number(self):
        result = tool_executor._validate_schema(
            {"val": "not_a_number"},
            json.dumps({"type": "object", "properties": {"val": {"type": "number"}}}),
        )
        assert result is not None
        assert "should be a number" in result

    def test_wrong_type_boolean(self):
        result = tool_executor._validate_schema(
            {"flag": "yes"},
            json.dumps({"type": "object", "properties": {"flag": {"type": "boolean"}}}),
        )
        assert result is not None
        assert "should be a boolean" in result

    def test_invalid_json_schema(self):
        result = tool_executor._validate_schema({"q": "test"}, "not json")
        assert result is None  # Can't validate, assume valid

    def test_empty_schema(self):
        result = tool_executor._validate_schema({"q": "test"}, "{}")
        assert result is None  # No constraints


class TestErrorClassification:
    """Test error message classification."""

    def test_timeout(self):
        code = tool_executor._classify_error("Connection timed out")
        assert code == "TIMEOUT"

    def test_connection_failed(self):
        code = tool_executor._classify_error("Connection failed: refused")
        assert code == "CONNECT_ERROR"

    def test_authentication(self):
        code = tool_executor._classify_error("Authentication failed")
        assert code == "AUTHENTICATION_ERROR"

    def test_unauthorized(self):
        code = tool_executor._classify_error("Request unauthorized")
        assert code == "AUTHENTICATION_ERROR"

    def test_forbidden(self):
        code = tool_executor._classify_error("Forbidden: insufficient permissions")
        assert code == "AUTHORIZATION_ERROR"

    def test_permission_denied(self):
        code = tool_executor._classify_error("Permission denied")
        assert code == "AUTHORIZATION_ERROR"

    def test_not_found(self):
        code = tool_executor._classify_error("Resource not found")
        assert code == "NOT_FOUND"

    def test_rate_limit(self):
        code = tool_executor._classify_error("Rate limit exceeded")
        assert code == "RATE_LIMITED"

    def test_unknown(self):
        code = tool_executor._classify_error("Something weird happened")
        assert code == "UNKNOWN_ERROR"


class TestOutputTruncation:
    """Test output truncation for large responses."""

    def test_no_truncation_small(self):
        output = "small output"
        result = tool_executor._truncate_output(output, 8192, 1048576)
        assert result == output

    def test_no_truncation_none(self):
        result = tool_executor._truncate_output(None, 8192, 1048576)
        assert result is None

    def test_truncation_bytes(self):
        long_output = "x" * 2000000  # 2MB
        result = tool_executor._truncate_output(long_output, 8192, 1048576)
        assert len(result) < len(long_output)
        assert "truncated" in result

    def test_truncation_dict(self):
        long_dict = {"key": "x" * 2000000}
        result = tool_executor._truncate_output(long_dict, 8192, 1048576)
        # Result should be smaller
        assert len(str(result)) < len(str(long_dict))

    def test_truncation_preserves_structure(self):
        output = "x" * 200 + "y" * 200
        result = tool_executor._truncate_output(output, 8192, 300)
        assert "x" in result
        assert "y" in result
        assert "truncated" in result
