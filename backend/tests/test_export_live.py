"""Live export paging. Skip unless LIFELOG_LIVE_API=1."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1",
    reason="set LIFELOG_LIVE_API=1 against a running stack",
)

BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def test_live_export_walks_pages():
    username = f"qa_b5_{uuid.uuid4().hex[:8]}"
    password = "qa_b5_pass"
    now = datetime.now(UTC)
    with httpx.Client(timeout=10) as client:
        assert (
            client.post(
                f"{BASE}/api/auth/register",
                json={"username": username, "password": password},
            ).status_code
            == 201
        )
        token = client.post(
            f"{BASE}/api/auth/login",
            json={"username": username, "password": password},
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        ids = [str(uuid.uuid4()) for _ in range(3)]
        sync = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers,
            json={
                "entries": [
                    {
                        "id": entry_id,
                        "timestamp": (now - timedelta(minutes=i)).isoformat(),
                        "entry_type": "THOUGHT",
                        "tags": [],
                        "encrypted_dek": "dek",
                        "encrypted_content": f"ct-{i}",
                    }
                    for i, entry_id in enumerate(ids)
                ]
            },
        )
        assert sync.status_code == 200, sync.text
        assert {row["status"] for row in sync.json()["results"]} == {"created"}

        first = client.get(
            f"{BASE}/api/export/metadata",
            headers=headers,
            params={"limit": 2, "offset": 0},
        )
        assert first.status_code == 200, first.text
        page = first.json()
        assert page["total"] >= 3
        assert len(page["items"]) == 2
        assert page["next_offset"] == 2
        assert "encrypted_content" not in page["items"][0]

        second = client.get(
            f"{BASE}/api/export/metadata",
            headers=headers,
            params={"limit": 2, "offset": page["next_offset"]},
        )
        assert second.status_code == 200
        assert second.json()["next_offset"] is None
        seen = {row["id"] for row in page["items"] + second.json()["items"]}
        assert set(ids) <= seen
