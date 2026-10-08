from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.services.sync_contract import decide_sync_item, entry_fingerprint, validate_incoming

USER = uuid4()
SKILL = uuid4()
HABIT = uuid4()
OTHER = uuid4()
NOW = datetime(2026, 9, 19, 10, 0, tzinfo=UTC)


def _incoming(**overrides):
    base = {
        "id": uuid4(),
        "timestamp": NOW,
        "entry_type": "THOUGHT",
        "skill_id": None,
        "habit_id": None,
        "context_id": None,
        "tags": ["a"],
        "mood_score": 7,
        "encrypted_dek": "dek",
        "encrypted_content": "ct",
    }
    base.update(overrides)
    return base


def test_new_valid_entry_is_created():
    status, reason = decide_sync_item(
        _incoming(),
        user_id=USER,
        existing=None,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "created"
    assert reason is None


def test_identical_retry_is_duplicate():
    incoming = _incoming()
    existing = {**incoming, "user_id": USER}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "duplicate"
    assert reason is None


def test_same_id_different_ciphertext_matching_version_is_updated():
    incoming = _incoming(encrypted_content="new", version=1)
    existing = {**incoming, "encrypted_content": "old", "user_id": USER, "version": 1}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "updated"
    assert reason is None


def test_same_id_different_ciphertext_without_version_is_conflict():
    incoming = _incoming(encrypted_content="new")
    existing = {**incoming, "encrypted_content": "old", "user_id": USER, "version": 1}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "conflict"
    assert reason == "version_required"


def test_stale_version_update_is_conflict():
    incoming = _incoming(encrypted_content="new", version=1)
    existing = {**incoming, "encrypted_content": "old", "user_id": USER, "version": 2}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "conflict"
    assert reason == "version_mismatch"


def test_id_owned_by_other_user_is_rejected_without_leak():
    incoming = _incoming()
    existing = {**incoming, "user_id": OTHER}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "rejected"
    assert reason == "id_unavailable"


def test_foreign_skill_is_rejected():
    status, reason = decide_sync_item(
        _incoming(skill_id=SKILL),
        user_id=USER,
        existing=None,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "rejected"
    assert reason == "unknown_skill"


def test_owned_skill_is_accepted():
    status, reason = decide_sync_item(
        _incoming(skill_id=SKILL, entry_type="SKILL_SESSION"),
        user_id=USER,
        existing=None,
        owned_skill_ids={SKILL},
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "created"


def test_foreign_habit_is_rejected():
    status, reason = decide_sync_item(
        _incoming(habit_id=HABIT, entry_type="HABIT_LOG"),
        user_id=USER,
        existing=None,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "rejected"
    assert reason == "unknown_habit"


def test_out_of_range_score_is_rejected():
    status, reason = decide_sync_item(
        _incoming(mood_score=99),
        user_id=USER,
        existing=None,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "rejected"
    assert reason == "out_of_range"


def test_naive_timestamp_is_rejected():
    status, reason = decide_sync_item(
        _incoming(timestamp=datetime(2026, 9, 19, 10, 0)),
        user_id=USER,
        existing=None,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "rejected"
    assert reason == "naive_timestamp"


def test_missing_ciphertext_is_rejected():
    assert validate_incoming(_incoming(encrypted_content="")) == "missing_ciphertext"


def test_fingerprint_ignores_user_and_created_at():
    a = _incoming()
    b = {**a, "user_id": USER, "created_at": NOW}
    assert entry_fingerprint(a) == entry_fingerprint(b)


def test_delete_of_live_row_is_deleted():
    incoming = _incoming(deleted=True, version=1)
    existing = {**_incoming(), "user_id": USER, "version": 1}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "deleted"
    assert reason is None


def test_delete_retry_of_already_deleted_ignores_stale_version():
    incoming = _incoming(deleted=True, version=1)
    existing = {**_incoming(), "user_id": USER, "version": 2, "deleted_at": NOW}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "deleted"
    assert reason is None


def test_delete_retry_of_missing_row_is_deleted():
    status, reason = decide_sync_item(
        _incoming(deleted=True),
        user_id=USER,
        existing=None,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "deleted"


def test_stale_delete_version_is_conflict():
    incoming = _incoming(deleted=True, version=1)
    existing = {**_incoming(), "user_id": USER, "version": 3}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "conflict"
    assert reason == "version_mismatch"


def test_upsert_of_soft_deleted_row_is_rejected():
    incoming = _incoming()
    existing = {**incoming, "user_id": USER, "deleted_at": NOW}
    status, reason = decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    )
    assert status == "rejected"
    assert reason == "already_deleted"


def test_fingerprint_treats_equivalent_timezones_as_same():
    utc = datetime(2026, 9, 19, 10, 0, tzinfo=UTC)
    offset = datetime(2026, 9, 19, 13, 0, tzinfo=timezone(timedelta(hours=3)))
    assert entry_fingerprint(_incoming(timestamp=utc)) == entry_fingerprint(
        _incoming(timestamp=offset)
    )


@pytest.mark.parametrize(
    "patch,reason",
    [
        ({"skill_id": SKILL}, "unknown_skill"),
        ({"habit_id": HABIT}, "unknown_habit"),
        ({"context_id": OTHER}, "unknown_context"),
        ({"goal_id": OTHER}, "unknown_goal"),
        ({"mood_score": 99}, "out_of_range"),
        ({"session_duration_min": 1441}, "out_of_range"),
        ({"sleep_hours": float("nan")}, "out_of_range"),
        ({"habit_value": float("inf")}, "out_of_range"),
        ({"timestamp": NOW.replace(tzinfo=None)}, "naive_timestamp"),
        ({"encrypted_content": ""}, "missing_ciphertext"),
        ({"entry_type": "invented"}, "invalid_entry_type"),
    ],
)
def test_update_validates_content_and_account_owned_references(patch, reason):
    existing = {**_incoming(), "user_id": USER, "version": 1}
    incoming = {**existing, "encrypted_content": "changed", **patch}
    assert decide_sync_item(
        incoming,
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
        owned_goal_ids=set(),
    ) == ("rejected", reason)


def test_goal_only_change_is_an_update_and_idempotent_retry_is_duplicate():
    existing = {**_incoming(), "user_id": USER, "version": 1, "goal_id": None}
    incoming = {**existing, "goal_id": OTHER}
    args = dict(
        user_id=USER,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
        owned_goal_ids={OTHER},
    )
    assert decide_sync_item(incoming, existing=existing, **args) == ("updated", None)
    assert decide_sync_item(incoming, existing={**incoming, "version": 2}, **args) == (
        "duplicate",
        None,
    )


def test_delete_of_live_entry_requires_version():
    existing = {**_incoming(), "user_id": USER, "version": 1}
    assert decide_sync_item(
        {**existing, "version": None, "deleted": True},
        user_id=USER,
        existing=existing,
        owned_skill_ids=set(),
        owned_habit_ids=set(),
        owned_context_ids=set(),
    ) == ("conflict", "version_required")
