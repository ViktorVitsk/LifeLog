"""Per-item sync decisions. No I/O, no ciphertext logging."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.enums import EntryType

SYNC_CREATED = "created"
SYNC_DUPLICATE = "duplicate"
SYNC_CONFLICT = "conflict"
SYNC_REJECTED = "rejected"
SYNC_DELETED = "deleted"


class SyncStatus(StrEnum):
    CREATED = SYNC_CREATED
    DUPLICATE = SYNC_DUPLICATE
    CONFLICT = SYNC_CONFLICT
    REJECTED = SYNC_REJECTED
    DELETED = SYNC_DELETED


INT_1_10 = frozenset(
    {
        "mood_score",
        "energy_score",
        "anxiety_score",
        "focus_score",
        "social_battery_score",
        "stress_score",
        "sleep_quality",
        "resentment_score",
        "guilt_score",
        "shame_score",
        "fear_score",
    }
)

def _as_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    return UUID(str(value))


def _entry_type_value(value: Any) -> str:
    if hasattr(value, "value"):
        return str(value.value)
    return str(value)


def _timestamp_key(value: Any) -> int | None:
    if not isinstance(value, datetime) or value.tzinfo is None:
        return None
    return int(value.astimezone(timezone.utc).timestamp() * 1_000_000)


def _tags_key(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        return tuple(str(item) for item in value)
    return (str(value),)


def entry_fingerprint(data: Mapping[str, Any]) -> tuple[Any, ...]:
    """Stable comparison of open fields + ciphertext. Never logged."""
    return (
        _timestamp_key(data.get("timestamp")),
        _entry_type_value(data.get("entry_type")),
        str(data["skill_id"]) if data.get("skill_id") is not None else None,
        str(data["habit_id"]) if data.get("habit_id") is not None else None,
        str(data["context_id"]) if data.get("context_id") is not None else None,
        _tags_key(data.get("tags")),
        data.get("mood_score"),
        data.get("energy_score"),
        data.get("anxiety_score"),
        data.get("focus_score"),
        data.get("social_battery_score"),
        data.get("stress_score"),
        data.get("sleep_hours"),
        data.get("sleep_quality"),
        data.get("weight_kg"),
        data.get("body_fat_pct"),
        data.get("session_duration_min"),
        data.get("habit_completed"),
        data.get("habit_value"),
        data.get("resentment_score"),
        data.get("guilt_score"),
        data.get("shame_score"),
        data.get("fear_score"),
        data.get("encrypted_dek"),
        data.get("encrypted_content"),
    )


def validate_incoming(data: Mapping[str, Any]) -> str | None:
    dek = data.get("encrypted_dek")
    content = data.get("encrypted_content")
    if not isinstance(dek, str) or not dek.strip() or not isinstance(content, str) or not content.strip():
        return "missing_ciphertext"

    ts = data.get("timestamp")
    if not isinstance(ts, datetime):
        return "invalid_timestamp"
    if ts.tzinfo is None:
        return "naive_timestamp"

    entry_type = _entry_type_value(data.get("entry_type"))
    if entry_type not in {item.value for item in EntryType}:
        return "invalid_entry_type"

    for field in INT_1_10:
        value = data.get(field)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 10:
            return "out_of_range"

    sleep_hours = data.get("sleep_hours")
    if sleep_hours is not None:
        if isinstance(sleep_hours, bool) or not isinstance(sleep_hours, (int, float)) or sleep_hours < 0 or sleep_hours > 24:
            return "out_of_range"

    weight_kg = data.get("weight_kg")
    if weight_kg is not None:
        if isinstance(weight_kg, bool) or not isinstance(weight_kg, (int, float)) or weight_kg < 0 or weight_kg > 500:
            return "out_of_range"

    body_fat = data.get("body_fat_pct")
    if body_fat is not None:
        if isinstance(body_fat, bool) or not isinstance(body_fat, (int, float)) or body_fat < 0 or body_fat > 100:
            return "out_of_range"

    duration = data.get("session_duration_min")
    if duration is not None:
        if isinstance(duration, bool) or not isinstance(duration, int) or duration < 0:
            return "out_of_range"

    habit_completed = data.get("habit_completed")
    if habit_completed is not None and not isinstance(habit_completed, bool):
        return "invalid_habit_completed"

    habit_value = data.get("habit_value")
    if habit_value is not None and (isinstance(habit_value, bool) or not isinstance(habit_value, (int, float))):
        return "out_of_range"

    return None


def validate_refs(
    data: Mapping[str, Any],
    *,
    owned_skill_ids: set[UUID],
    owned_habit_ids: set[UUID],
    owned_context_ids: set[UUID],
) -> str | None:
    skill_id = data.get("skill_id")
    if skill_id is not None:
        try:
            if _as_uuid(skill_id) not in owned_skill_ids:
                return "unknown_skill"
        except (TypeError, ValueError):
            return "unknown_skill"

    habit_id = data.get("habit_id")
    if habit_id is not None:
        try:
            if _as_uuid(habit_id) not in owned_habit_ids:
                return "unknown_habit"
        except (TypeError, ValueError):
            return "unknown_habit"

    context_id = data.get("context_id")
    if context_id is not None:
        try:
            if _as_uuid(context_id) not in owned_context_ids:
                return "unknown_context"
        except (TypeError, ValueError):
            return "unknown_context"

    return None


def _is_deleted(data: Mapping[str, Any]) -> bool:
    if data.get("deleted") is True:
        return True
    return data.get("deleted_at") is not None


def _version_of(data: Mapping[str, Any]) -> int:
    value = data.get("version")
    if value is None:
        return 1
    return int(value)


def versions_conflict(incoming: Mapping[str, Any], existing: Mapping[str, Any]) -> bool:
    value = incoming.get("version")
    if value is None:
        return False
    return int(value) != _version_of(existing)


def decide_sync_item(
    incoming: Mapping[str, Any],
    *,
    user_id: UUID,
    existing: Mapping[str, Any] | None,
    owned_skill_ids: set[UUID],
    owned_habit_ids: set[UUID],
    owned_context_ids: set[UUID],
) -> tuple[str, str | None]:
    """
    Return (status, reason).
    created = caller should insert; deleted = caller should soft-delete if live.
    """
    incoming_deleted = bool(incoming.get("deleted"))

    if existing is not None:
        existing_owner = existing.get("user_id")
        if existing_owner is not None and existing_owner != user_id:
            return SyncStatus.REJECTED, "id_unavailable"
        if incoming_deleted:
            if _is_deleted(existing):
                return SyncStatus.DELETED, None
            if versions_conflict(incoming, existing):
                return SyncStatus.CONFLICT, "version_mismatch"
            return SyncStatus.DELETED, None
        if _is_deleted(existing):
            return SyncStatus.REJECTED, "already_deleted"
        if entry_fingerprint(incoming) == entry_fingerprint(existing):
            return SyncStatus.DUPLICATE, None
        if versions_conflict(incoming, existing):
            return SyncStatus.CONFLICT, "version_mismatch"
        return SyncStatus.CONFLICT, "content_mismatch"

    if incoming_deleted:
        return SyncStatus.DELETED, None

    reason = validate_incoming(incoming)
    if reason:
        return SyncStatus.REJECTED, reason
    reason = validate_refs(
        incoming,
        owned_skill_ids=owned_skill_ids,
        owned_habit_ids=owned_habit_ids,
        owned_context_ids=owned_context_ids,
    )
    if reason:
        return SyncStatus.REJECTED, reason
    return SyncStatus.CREATED, None
