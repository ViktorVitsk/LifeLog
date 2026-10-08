"""UTF-8 boundaries and authentication compatibility with pre-bcrypt-5 users."""

import bcrypt
import httpx
import pytest
from pydantic import ValidationError

from app.core.security import hash_password, verify_password
from app.main import app
from app.schemas.auth import LoginRequest, RegisterRequest


def test_registration_uses_bytes_not_characters():
    assert RegisterRequest(username="boundary", password="я" * 36).password == "я" * 36
    for password in ("a" * 73, "я" * 37, "😀" * 19):
        with pytest.raises(ValidationError, match="password_too_long_utf8"):
            RegisterRequest(username="boundary", password=password)
        with pytest.raises(ValueError, match="password_too_long_utf8"):
            hash_password(password)


def test_existing_long_password_keeps_legacy_bcrypt_semantics():
    original = "я" * 40
    legacy_hash = bcrypt.hashpw(original.encode("utf-8")[:72], bcrypt.gensalt(rounds=4)).decode()
    assert LoginRequest(username="legacy", password=original).password == original
    assert verify_password(original, legacy_hash)
    assert not verify_password("different" * 10, legacy_hash)
    # bcrypt never distinguished suffixes beyond byte 72. Do not pretend the
    # compatibility path provides a stronger guarantee than those old hashes.
    assert verify_password("я" * 36 + "different suffix", legacy_hash)


def test_existing_normal_hashes_remain_usable():
    password = "compatible_password"
    hashed = hash_password(password)
    assert verify_password(password, hashed)
    assert not verify_password("wrong_password", hashed)


@pytest.mark.asyncio
async def test_register_http_rejects_long_unicode_password_before_database_access():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/auth/register", json={"username": "long_password", "password": "я" * 40}
        )
    assert response.status_code == 422
    assert "password_too_long_utf8" in response.text


@pytest.mark.asyncio
async def test_legacy_long_password_can_login_over_http():
    from types import SimpleNamespace
    from uuid import uuid4

    from app.core.database import get_db

    password = "я" * 40
    legacy_hash = bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=4)).decode()
    user = SimpleNamespace(
        id=uuid4(), password_hash=legacy_hash, password_salt="ab" * 32, kdf_version=1
    )

    class Result:
        def scalar_one_or_none(self):
            return user

    class Session:
        async def execute(self, statement):
            return Result()

    async def fake_db():
        yield Session()

    app.dependency_overrides[get_db] = fake_db
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/auth/login",
                json={"username": f"fictional_legacy_{user.id.hex[:12]}", "password": password},
            )
        assert response.status_code == 200
        assert response.json()["salt"] == user.password_salt
        assert response.json()["kdf_version"] == 1
    finally:
        app.dependency_overrides.clear()
