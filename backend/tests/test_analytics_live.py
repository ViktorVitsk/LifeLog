"""Live aggregation checks. Skip unless LIFELOG_LIVE_API=1."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1",
    reason="set LIFELOG_LIVE_API=1 against a running stack",
)

BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def _auth(client: httpx.Client) -> dict[str, str]:
    username = f"qa_b4_{uuid.uuid4().hex[:8]}"
    password = "qa_b4_pass"
    reg = client.post(
        f"{BASE}/api/auth/register",
        json={"username": username, "password": password, "timezone": "UTC"},
    )
    assert reg.status_code == 201
    login = client.post(f"{BASE}/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _sync(client: httpx.Client, headers: dict[str, str], entries: list[dict]) -> None:
    res = client.post(f"{BASE}/api/entries/sync", headers=headers, json={"entries": entries})
    assert res.status_code == 200, res.text
    for row in res.json()["results"]:
        assert row["status"] == "created", row


def test_live_aggregation_rules():
    now = datetime.now(timezone.utc)
    day = now.replace(hour=12, minute=0, second=0, microsecond=0)
    earlier = day - timedelta(days=1)
    with httpx.Client(timeout=10) as client:
        headers = _auth(client)
        catalog = client.get(f"{BASE}/api/analytics/metrics", headers=headers)
        assert catalog.status_code == 200
        by_key = {row["key"]: row for row in catalog.json()}
        assert by_key["session_duration_min"]["aggregation"] == "sum"
        assert by_key["mood_score"]["aggregation"] == "avg"
        assert "habit_id" in by_key["habit_value"]["required_filters"]

        missing = client.get(
            f"{BASE}/api/analytics/trends",
            headers=headers,
            params={"metric": "habit_value", "period": "7d"},
        )
        assert missing.status_code == 400
        assert "habit_id" in missing.json()["detail"]

        habit = client.post(f"{BASE}/api/habits", headers=headers, json={"name": "qa-run"})
        assert habit.status_code == 201
        habit_id = habit.json()["id"]

        _sync(
            client,
            headers,
            [
                {
                    "id": str(uuid.uuid4()),
                    "timestamp": day.isoformat(),
                    "entry_type": "DAILY_CHECKIN",
                    "tags": [],
                    "mood_score": 6,
                    "encrypted_dek": "dek",
                    "encrypted_content": "ct-a",
                },
                {
                    "id": str(uuid.uuid4()),
                    "timestamp": (day + timedelta(hours=2)).isoformat(),
                    "entry_type": "DAILY_CHECKIN",
                    "tags": [],
                    "mood_score": 8,
                    "encrypted_dek": "dek",
                    "encrypted_content": "ct-b",
                },
                {
                    "id": str(uuid.uuid4()),
                    "timestamp": day.isoformat(),
                    "entry_type": "SKILL_SESSION",
                    "tags": [],
                    "session_duration_min": 20,
                    "encrypted_dek": "dek",
                    "encrypted_content": "ct-c",
                },
                {
                    "id": str(uuid.uuid4()),
                    "timestamp": (day + timedelta(hours=1)).isoformat(),
                    "entry_type": "SKILL_SESSION",
                    "tags": [],
                    "session_duration_min": 10,
                    "encrypted_dek": "dek",
                    "encrypted_content": "ct-d",
                },
                {
                    "id": str(uuid.uuid4()),
                    "timestamp": earlier.isoformat(),
                    "entry_type": "SLEEP",
                    "tags": [],
                    "sleep_quality": 4,
                    "sleep_hours": 7,
                    "encrypted_dek": "dek",
                    "encrypted_content": "ct-e",
                },
                {
                    "id": str(uuid.uuid4()),
                    "timestamp": day.isoformat(),
                    "entry_type": "HABIT_LOG",
                    "tags": [],
                    "habit_id": habit_id,
                    "habit_value": 3,
                    "habit_completed": True,
                    "encrypted_dek": "dek",
                    "encrypted_content": "ct-f",
                },
            ],
        )

        mood = client.get(
            f"{BASE}/api/analytics/trends",
            headers=headers,
            params={"metric": "mood_score", "period": "7d"},
        )
        assert mood.status_code == 200
        mood_body = mood.json()
        assert mood_body["aggregation"] == "avg"
        assert mood_body["observations"] == 2
        assert mood_body["period_days"] == 7
        assert mood_body["days_with_data"] >= 1
        assert 0 <= mood_body["coverage"] <= 1
        assert mood_body["points"][0]["value"] == 7
        assert mood_body["points"][0]["n"] == 2

        minutes = client.get(
            f"{BASE}/api/analytics/trends",
            headers=headers,
            params={"metric": "session_duration_min", "period": "7d"},
        )
        assert minutes.status_code == 200
        assert minutes.json()["aggregation"] == "sum"
        assert minutes.json()["points"][0]["value"] == 30

        habit_trend = client.get(
            f"{BASE}/api/analytics/trends",
            headers=headers,
            params={"metric": "habit_value", "period": "7d", "habit_id": habit_id},
        )
        assert habit_trend.status_code == 200
        assert habit_trend.json()["points"][0]["value"] == 3

        thin = client.get(
            f"{BASE}/api/analytics/correlations",
            headers=headers,
            params={"x": "sleep_quality", "y": "mood_score", "period": "7d", "lag_days": 1},
        )
        assert thin.status_code == 200
        thin_body = thin.json()
        assert thin_body["lag_days"] == 1
        assert thin_body["insufficient"] is True
        assert thin_body["points"] == []
        assert thin_body["observations"] < 3
