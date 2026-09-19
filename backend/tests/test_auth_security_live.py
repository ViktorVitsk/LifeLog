"""Live auth security checks. Skip unless LIFELOG_LIVE_API=1."""

from __future__ import annotations

import os
import uuid

import pytest
from jose import jwt

httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1",
    reason="set LIFELOG_LIVE_API=1 against a running stack",
)

BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def test_login_throttle_and_refresh_session_start():
    username = f"qa_auth_{uuid.uuid4().hex[:10]}"
    password = "qa_auth_pass"
    with httpx.Client(timeout=10) as client:
        registered = client.post(
            f"{BASE}/api/auth/register",
            json={"username": username, "password": password},
        )
        assert registered.status_code == 201

        for _ in range(5):
            rejected = client.post(
                f"{BASE}/api/auth/login",
                json={"username": username, "password": "wrong-password"},
            )
            assert rejected.status_code == 401

        throttled = client.post(
            f"{BASE}/api/auth/login",
            json={"username": username, "password": password},
        )
        assert throttled.status_code == 429
        assert int(throttled.headers["Retry-After"]) > 0

        fresh_username = f"{username}_fresh"
        assert (
            client.post(
                f"{BASE}/api/auth/register",
                json={"username": fresh_username, "password": password},
            ).status_code
            == 201
        )
        logged_in = client.post(
            f"{BASE}/api/auth/login",
            json={"username": fresh_username, "password": password},
        )
        assert logged_in.status_code == 200
        token = logged_in.json()["access_token"]

        refreshed = client.post(
            f"{BASE}/api/auth/refresh",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert refreshed.status_code == 200
        assert jwt.get_unverified_claims(refreshed.json()["access_token"])["iat"] == (
            jwt.get_unverified_claims(token)["iat"]
        )
