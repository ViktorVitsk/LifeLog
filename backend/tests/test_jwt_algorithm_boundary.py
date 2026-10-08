"""Dependency-advisory boundary: token headers cannot widen the JWT allowlist."""

from uuid import uuid4

import pytest
from jose import JWTError, jwt

from app.core import security


def test_token_algorithm_header_cannot_override_configured_algorithm():
    # With the documented symmetric secret setup, the request's alg field
    # cannot select a different JWT algorithm even using the correct secret.
    alternate = "HS384" if security.settings.jwt_algorithm != "HS384" else "HS512"
    forged = jwt.encode(
        {"sub": str(uuid4()), "type": "access"},
        security.settings.jwt_secret,
        algorithm=alternate,
    )
    with pytest.raises(JWTError):
        security.decode_access_token(forged)
    assert security.decode_access_token(security.create_access_token(uuid4()))["type"] == "access"
