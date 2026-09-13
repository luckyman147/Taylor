"""OAuth PKCE — code_verifier and code_challenge generation.

Implements RFC 7636 (Proof Key for Code Exchange) for OAuth 2.0.
"""

from __future__ import annotations

import hashlib
import base64
import secrets
import string


def generate_code_verifier(length: int = 64) -> str:
    """Generate a cryptographically random code_verifier.

    The verifier is a high-entropy cryptographic random string using the
    unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
    with a length between 43 and 128 characters.
    """
    chars = string.ascii_letters + string.digits + "-._~"
    return "".join(secrets.choice(chars) for _ in range(length))


def generate_code_challenge(verifier: str) -> str:
    """Generate a code_challenge from a code_verifier using SHA-256.

    The challenge is the base64url encoding of the SHA-256 hash of the verifier.
    """
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def generate_pkce_pair() -> tuple[str, str]:
    """Generate a code_verifier and its corresponding code_challenge.

    Returns:
        (code_verifier, code_challenge)
    """
    verifier = generate_code_verifier()
    challenge = generate_code_challenge(verifier)
    return verifier, challenge
