import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()


def hash_password(password: str) -> str:
    """bcrypt password hash. Used for login verification only."""
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        raise ValueError("password_too_long_utf8")
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(encoded, salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    # bcrypt < 5 silently used the first 72 bytes. Preserve authentication
    # for those existing accounts, while registration rejects new long inputs.
    # The browser must still derive its KEK from the FULL original password.
    return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))


def generate_pbkdf2_salt() -> str:
    """
    Generate a 32-byte random salt for client-side PBKDF2 key derivation.
    Stored per user in `users.password_salt`. Returned to the client on login
    so the client can derive KEK = PBKDF2(master_password, salt).
    This salt is independent of bcrypt's internal salt.
    """
    return secrets.token_hex(32)


def create_access_token(
    subject: UUID | str,
    expires_delta: timedelta | None = None,
    *,
    session_started_at: datetime | None = None,
) -> str:
    now = datetime.now(UTC)
    started_at = session_started_at or now
    if started_at.tzinfo is None:
        raise ValueError("session_started_at must be timezone-aware")
    started_at = started_at.astimezone(UTC)
    rolling_expire = now + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    absolute_expire = started_at + timedelta(
        minutes=settings.session_absolute_expire_minutes,
    )
    payload = {
        "sub": str(subject),
        "exp": min(rolling_expire, absolute_expire),
        "iat": started_at,
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Returns the decoded payload or raises JWTError."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def validate_refresh_session(
    payload: dict,
    *,
    max_age: timedelta,
    now: datetime | None = None,
) -> datetime:
    raw_iat = payload.get("iat")
    if isinstance(raw_iat, bool) or not isinstance(raw_iat, (int, float)):
        raise JWTError("missing session start")
    try:
        started_at = datetime.fromtimestamp(raw_iat, UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise JWTError("invalid session start") from exc
    current = now or datetime.now(UTC)
    if started_at > current or current - started_at >= max_age:
        raise JWTError("absolute session lifetime exceeded")
    return started_at


__all__ = [
    "JWTError",
    "create_access_token",
    "decode_access_token",
    "generate_pbkdf2_salt",
    "hash_password",
    "validate_refresh_session",
    "verify_password",
]
