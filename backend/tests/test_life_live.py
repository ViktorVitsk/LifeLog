"""Live goals / memory / actions. Skip unless LIFELOG_LIVE_API=1."""

from __future__ import annotations

import os
import uuid

import pytest

httpx = pytest.importorskip("httpx")

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1",
    reason="set LIFELOG_LIVE_API=1 against a running stack",
)

BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def _user(client: httpx.Client, name: str) -> dict[str, str]:
    password = "qa_c_pass"
    client.post(f"{BASE}/api/auth/register", json={"username": name, "password": password})
    token = client.post(f"{BASE}/api/auth/login", json={"username": name, "password": password}).json()[
        "access_token"
    ]
    return {"Authorization": f"Bearer {token}"}


def test_live_goal_memory_action_cycle():
    with httpx.Client(timeout=10) as client:
        headers = _user(client, f"qa_c_{uuid.uuid4().hex[:8]}")
        other = _user(client, f"qa_c_o_{uuid.uuid4().hex[:8]}")

        habit = client.post(f"{BASE}/api/habits", headers=headers, json={"name": "qa-walk"})
        assert habit.status_code == 201
        foreign_habit = client.post(f"{BASE}/api/habits", headers=other, json={"name": "not-yours"})
        assert foreign_habit.status_code == 201

        goal_id = str(uuid.uuid4())
        bad = client.post(
            f"{BASE}/api/life/goals/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": goal_id,
                        "state": "active",
                        "habit_ids": [foreign_habit.json()["id"]],
                        "encrypted_dek": "dek",
                        "encrypted_content": "goal-ct",
                    }
                ]
            },
        )
        assert bad.status_code == 200
        assert bad.json()["results"][0]["status"] == "rejected"
        assert bad.json()["results"][0]["reason"] == "unknown_habit"

        created = client.post(
            f"{BASE}/api/life/goals/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": goal_id,
                        "state": "active",
                        "habit_ids": [habit.json()["id"]],
                        "encrypted_dek": "dek",
                        "encrypted_content": "goal-ct",
                    }
                ]
            },
        )
        assert created.json()["results"][0]["status"] == "created"

        memory_id = str(uuid.uuid4())
        mem = client.post(
            f"{BASE}/api/life/memory/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": memory_id,
                        "kind": "preference",
                        "state": "proposed",
                        "origin": "user",
                        "encrypted_dek": "dek",
                        "encrypted_content": "mem-ct",
                    }
                ]
            },
        )
        assert mem.json()["results"][0]["status"] == "created"
        accepted = client.post(
            f"{BASE}/api/life/memory/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": memory_id,
                        "kind": "preference",
                        "state": "accepted",
                        "origin": "user",
                        "encrypted_dek": "dek",
                        "encrypted_content": "mem-ct",
                        "version": 1,
                    }
                ]
            },
        )
        assert accepted.json()["results"][0]["status"] == "updated"

        action_id = str(uuid.uuid4())
        orphan = client.post(
            f"{BASE}/api/life/actions/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": action_id,
                        "goal_id": str(uuid.uuid4()),
                        "state": "proposed",
                        "encrypted_dek": "dek",
                        "encrypted_content": "act-ct",
                    }
                ]
            },
        )
        assert orphan.json()["results"][0]["reason"] == "unknown_goal"

        act = client.post(
            f"{BASE}/api/life/actions/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": action_id,
                        "goal_id": goal_id,
                        "state": "accepted",
                        "encrypted_dek": "dek",
                        "encrypted_content": "act-ct",
                    }
                ]
            },
        )
        assert act.json()["results"][0]["status"] == "created"

        fb = client.post(
            f"{BASE}/api/life/feedback/sync",
            headers=headers,
            json={
                "items": [
                    {
                        "id": str(uuid.uuid4()),
                        "action_id": action_id,
                        "outcome_kind": "tried_no_effect",
                        "encrypted_dek": "dek",
                        "encrypted_content": "fb-ct",
                    }
                ]
            },
        )
        assert fb.json()["results"][0]["status"] == "created"

        bundle = client.get(f"{BASE}/api/life", headers=headers)
        assert bundle.status_code == 200
        body = bundle.json()
        assert body["goals"][0]["id"] == goal_id
        assert body["goals"][0]["habit_ids"] == [habit.json()["id"]]
        assert body["memory"][0]["state"] == "accepted"
        assert body["actions"][0]["id"] == action_id
        assert body["feedback"][0]["outcome_kind"] == "tried_no_effect"
        other_view = client.get(f"{BASE}/api/life", headers=other)
        assert other_view.json()["goals"] == []
