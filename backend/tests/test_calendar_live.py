"""Live timezone / calendar-day checks. Skip unless LIFELOG_LIVE_API=1."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1",
    reason="set LIFELOG_LIVE_API=1 against a running stack",
)

BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def test_live_timezone_and_local_calendar_day():
    username = f"qa_b3_{uuid.uuid4().hex[:8]}"
    password = "qa_b3_pass"
    with httpx.Client(timeout=10) as client:
        bad = client.post(
            f"{BASE}/api/auth/register",
            json={"username": username, "password": password, "timezone": "Not/AZone"},
        )
        assert bad.status_code == 400

        reg = client.post(
            f"{BASE}/api/auth/register",
            json={"username": username, "password": password, "timezone": "Europe/Moscow"},
        )
        assert reg.status_code == 201

        login = client.post(
            f"{BASE}/api/auth/login",
            json={"username": username, "password": password},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        me = client.get(f"{BASE}/api/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["timezone"] == "Europe/Moscow"

        put = client.put(
            f"{BASE}/api/auth/timezone",
            headers=headers,
            json={"timezone": "UTC"},
        )
        assert put.status_code == 200
        assert put.json()["timezone"] == "UTC"
        back = client.put(
            f"{BASE}/api/auth/timezone",
            headers=headers,
            json={"timezone": "Europe/Moscow"},
        )
        assert back.json()["timezone"] == "Europe/Moscow"

        entry_id = str(uuid.uuid4())
        # Use a recent local day so this remains inside the rolling 7d window.
        # 01:00 local belongs to a different date from its UTC instant.
        local_event = (datetime.now(ZoneInfo("Europe/Moscow")) - timedelta(days=1)).replace(
            hour=1, minute=0, second=0, microsecond=0
        )
        utc_event = local_event.astimezone(UTC)
        first = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers,
            json={
                "entries": [
                    {
                        "id": entry_id,
                        "timestamp": utc_event.isoformat(),
                        "entry_type": "THOUGHT",
                        "tags": [],
                        "mood_score": 6,
                        "encrypted_dek": "dek-test",
                        "encrypted_content": "ct-test",
                        "event_timezone": "Europe/Moscow",
                    }
                ]
            },
        )
        assert first.status_code == 200, first.text
        assert first.json()["results"][0]["status"] == "created"

        listed = client.get(f"{BASE}/api/entries", headers=headers)
        assert listed.status_code == 200
        row = next(item for item in listed.json() if item["id"] == entry_id)
        assert row["event_timezone"] == "Europe/Moscow"
        assert row["recorded_at"]

        trends = client.get(
            f"{BASE}/api/analytics/trends",
            headers=headers,
            params={"metric": "mood_score", "period": "7d"},
        )
        assert trends.status_code == 200, trends.text
        body = trends.json()
        points = body["points"] if isinstance(body, dict) else body
        by_day = {point["day"]: point["value"] for point in points}
        assert by_day[local_event.date().isoformat()] == 6
        assert utc_event.date().isoformat() not in by_day
