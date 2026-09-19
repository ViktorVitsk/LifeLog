from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.security import (
    JWTError,
    create_access_token,
    decode_access_token,
    validate_refresh_session,
)


def test_refresh_keeps_original_session_start():
    started = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
    token = create_access_token(
        uuid4(),
        expires_delta=timedelta(hours=1),
        session_started_at=started,
    )

    payload = decode_access_token(token)

    assert datetime.fromtimestamp(payload["iat"], UTC) == started


def test_refresh_rejects_session_at_absolute_ceiling():
    now = datetime(2026, 9, 19, 12, 0, tzinfo=UTC)
    payload = {"iat": int((now - timedelta(days=30)).timestamp())}

    with pytest.raises(JWTError, match="absolute session lifetime"):
        validate_refresh_session(
            payload,
            max_age=timedelta(days=30),
            now=now,
        )
