"""Real HTTP/database regressions; run only against a disposable live stack."""

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("LIFELOG_LIVE_API") != "1", reason="requires a disposable running API/Postgres"
)
BASE = os.environ.get("LIFELOG_API", "http://127.0.0.1:8001")


def account(client):
    name = f"fictional_update_test_{uuid4().hex[:12]}"
    password = "Fictional_regression_only!"
    assert (
        client.post(
            f"{BASE}/api/auth/register", json={"username": name, "password": password}
        ).status_code
        == 201
    )
    r = client.post(f"{BASE}/api/auth/login", json={"username": name, "password": password})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def entry(**patch):
    return {
        "id": str(uuid4()),
        "timestamp": datetime.now(UTC).isoformat(),
        "entry_type": "THOUGHT",
        "encrypted_dek": "fictional-dek",
        "encrypted_content": "fictional-ct",
        "tags": ["fictional-test"],
        **patch,
    }


def sync(client, headers, rows):
    r = client.post(f"{BASE}/api/entries/sync", headers=headers, json={"entries": rows})
    assert r.status_code == 200, r.text
    return r.json()["results"]


def test_existing_entries_reject_foreign_links_and_bad_updates_without_losing_siblings():
    with httpx.Client(timeout=10) as c:
        a, b = account(c), account(c)
        foreign_skill = c.post(
            f"{BASE}/api/skills", headers=a, json={"name": "Fictional foreign skill"}
        ).json()["id"]
        foreign_habit = c.post(
            f"{BASE}/api/habits", headers=a, json={"name": "Fictional foreign habit"}
        ).json()["id"]
        foreign_goal = str(uuid4())
        assert (
            c.post(
                f"{BASE}/api/life/goals/sync",
                headers=a,
                json={
                    "items": [
                        {
                            "id": foreign_goal,
                            "state": "active",
                            "encrypted_dek": "fictional",
                            "encrypted_content": "fictional",
                        }
                    ]
                },
            ).json()["results"][0]["status"]
            == "created"
        )
        patches = [
            ({"skill_id": foreign_skill}, "unknown_skill"),
            ({"habit_id": foreign_habit}, "unknown_habit"),
            ({"goal_id": foreign_goal}, "unknown_goal"),
            ({"mood_score": 99}, "out_of_range"),
            ({"session_duration_min": 1441}, "out_of_range"),
            ({"encrypted_content": ""}, "missing_ciphertext"),
            ({"timestamp": "2026-10-09T12:00:00"}, "naive_timestamp"),
        ]
        bad_rows = [entry() for _ in patches]
        good_update, occupied = entry(), entry()
        assert all(r["status"] == "created" for r in sync(c, b, [*bad_rows, good_update]))
        assert sync(c, a, [occupied])[0]["status"] == "created"
        good_create = entry()
        rows = [
            {**r, "version": 1, "encrypted_content": "fictional-new", **patch}
            for r, (patch, _) in zip(bad_rows, patches, strict=True)
        ]
        result = sync(
            c,
            b,
            [
                rows[0],
                good_create,
                *rows[1:],
                {**good_update, "version": 1, "encrypted_content": "fictional-good-new"},
                {**occupied, "version": 1, "encrypted_content": "foreign-write"},
            ],
        )
        by_id = {r["id"]: r for r in result}
        for row, (_, reason) in zip(bad_rows, patches, strict=True):
            assert by_id[row["id"]]["status"] == "rejected"
            assert by_id[row["id"]]["reason"] == reason
        assert by_id[good_create["id"]]["status"] == "created"
        assert by_id[good_update["id"]]["version"] == 2
        assert by_id[occupied["id"]]["reason"] == "id_unavailable"
        stored = {
            r["id"]: r
            for r in c.get(f"{BASE}/api/entries", headers=b, params={"limit": 1000}).json()
        }
        for row in bad_rows:
            assert stored[row["id"]]["version"] == 1
            assert stored[row["id"]]["encrypted_content"] == "fictional-ct"
        assert stored[good_update["id"]]["encrypted_content"] == "fictional-good-new"
        assert occupied["id"] not in stored
        owner_rows = c.get(f"{BASE}/api/entries", headers=a).json()
        assert (
            next(r for r in owner_rows if r["id"] == occupied["id"])["encrypted_content"]
            == "fictional-ct"
        )


def test_goal_only_update_duplicate_retry_and_versioned_delete():
    with httpx.Client(timeout=10) as c:
        headers = account(c)
        goal = str(uuid4())
        assert (
            c.post(
                f"{BASE}/api/life/goals/sync",
                headers=headers,
                json={
                    "items": [
                        {
                            "id": goal,
                            "state": "active",
                            "encrypted_dek": "fictional",
                            "encrypted_content": "fictional",
                        }
                    ]
                },
            ).json()["results"][0]["status"]
            == "created"
        )
        row = entry()
        assert sync(c, headers, [row])[0]["version"] == 1
        linked = {**row, "goal_id": goal, "version": 1}
        assert sync(c, headers, [linked])[0]["version"] == 2
        retry = sync(c, headers, [linked])[0]
        assert retry["status"] == "duplicate" and retry["version"] == 2
        stored = c.get(f"{BASE}/api/entries", headers=headers).json()[0]
        assert stored["goal_id"] == goal
        assert sync(c, headers, [{**linked, "deleted": True}])[0]["status"] == "conflict"
        assert sync(c, headers, [{**row, "deleted": True}])[0]["reason"] == "version_required"
        deleted = sync(c, headers, [{**linked, "version": 2, "deleted": True}])[0]
        assert deleted["status"] == "deleted" and deleted["version"] == 3
        assert sync(c, headers, [{**linked, "deleted": True}])[0]["status"] == "deleted"
        assert sync(c, headers, [{**linked, "version": 3}])[0]["reason"] == "already_deleted"
        assert c.get(f"{BASE}/api/entries", headers=headers).json() == []
        assert c.get(f"{BASE}/api/export/metadata", headers=headers).json()["items"] == []
