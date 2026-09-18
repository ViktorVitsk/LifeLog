"""Live checks against a running API. Skip unless LIFELOG_LIVE_API=1."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1",
    reason="set LIFELOG_LIVE_API=1 against a running stack",
)

BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def _entry(entry_id: str, **overrides: object) -> dict:
    payload = {
        "id": entry_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entry_type": "THOUGHT",
        "tags": [],
        "encrypted_dek": "dek-test",
        "encrypted_content": "ct-test",
    }
    payload.update(overrides)
    return payload


def _register_login(client: httpx.Client, username: str) -> str:
    password = "qa_b1_pass"
    reg = client.post(f"{BASE}/api/auth/register", json={"username": username, "password": password})
    assert reg.status_code in (201, 409)
    login = client.post(f"{BASE}/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200
    return login.json()["access_token"]


def test_live_sync_contract_mixed_batch():
    with httpx.Client(timeout=10) as client:
        token_a = _register_login(client, "qa_b1_a")
        token_b = _register_login(client, "qa_b1_b")
        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}

        skill = client.post(f"{BASE}/api/skills", headers=headers_a, json={"name": "qa-skill"})
        assert skill.status_code == 201
        skill_id = skill.json()["id"]

        created_id = str(uuid.uuid4())
        foreign_id = str(uuid.uuid4())
        bad_score_id = str(uuid.uuid4())
        created_payload = _entry(created_id)

        first = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers_b,
            json={
                "entries": [
                    created_payload,
                    _entry(foreign_id, skill_id=skill_id, entry_type="SKILL_SESSION"),
                    _entry(bad_score_id, mood_score=99),
                ]
            },
        )
        assert first.status_code == 200, first.text
        by_id = {row["id"]: row for row in first.json()["results"]}
        assert by_id[created_id]["status"] == "created"
        assert by_id[foreign_id]["status"] == "rejected"
        assert by_id[foreign_id]["reason"] == "unknown_skill"
        assert by_id[bad_score_id]["status"] == "rejected"
        assert by_id[bad_score_id]["reason"] == "out_of_range"
        assert created_id in [str(x) for x in first.json()["saved"]]
        assert foreign_id not in [str(x) for x in first.json()["saved"]]

        retry = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers_b,
            json={"entries": [created_payload]},
        )
        assert retry.status_code == 200
        assert retry.json()["results"][0]["status"] == "duplicate"

        conflict = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers_b,
            json={"entries": [_entry(created_id, encrypted_content="other")]},
        )
        assert conflict.status_code == 200
        assert conflict.json()["results"][0]["status"] == "conflict"

        gone = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers_b,
            json={"entries": [{**created_payload, "deleted": True, "version": 1}]},
        )
        assert gone.status_code == 200
        assert gone.json()["results"][0]["status"] == "deleted"

        listed = client.get(f"{BASE}/api/entries", headers=headers_b, params={"limit": 1000})
        assert listed.status_code == 200
        assert created_id not in [row["id"] for row in listed.json()]

        again = client.post(
            f"{BASE}/api/entries/sync",
            headers=headers_b,
            json={"entries": [{**created_payload, "deleted": True, "version": 1}]},
        )
        assert again.status_code == 200
        assert again.json()["results"][0]["status"] == "deleted"
