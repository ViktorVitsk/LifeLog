"""Sync decisions for mutable encrypted life entities (goals, memory, actions)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

SYNC_CREATED = "created"
SYNC_UPDATED = "updated"
SYNC_DUPLICATE = "duplicate"
SYNC_CONFLICT = "conflict"
SYNC_REJECTED = "rejected"
SYNC_DELETED = "deleted"


def iso_key(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def id_tuple(values: Any) -> tuple[str, ...]:
    if not values:
        return ()
    return tuple(sorted(str(item) for item in values))


def blob_fingerprint(data: Mapping[str, Any], extra: tuple[Any, ...] = ()) -> tuple[Any, ...]:
    return (
        data.get("encrypted_dek"),
        data.get("encrypted_content"),
        data.get("state"),
        *extra,
    )


def decide_life_item(
    incoming: Mapping[str, Any],
    existing: Mapping[str, Any] | None,
    extra_incoming: tuple[Any, ...] = (),
    extra_existing: tuple[Any, ...] = (),
) -> tuple[str, str | None]:
    dek = incoming.get("encrypted_dek")
    content = incoming.get("encrypted_content")
    deleted = bool(incoming.get("deleted"))

    if existing is not None and existing.get("deleted_at") is not None:
        if deleted:
            return SYNC_DELETED, None
        return SYNC_REJECTED, "already_deleted"

    if deleted:
        if existing is None:
            return SYNC_DELETED, None
        incoming_v = incoming.get("version")
        if incoming_v is None:
            return SYNC_CONFLICT, "version_required"
        if int(incoming_v) != int(existing.get("version") or 1):
            return SYNC_CONFLICT, "version_mismatch"
        return SYNC_DELETED, None

    if not isinstance(dek, str) or not dek.strip() or not isinstance(content, str) or not content.strip():
        return SYNC_REJECTED, "missing_ciphertext"

    if existing is None:
        return SYNC_CREATED, None

    if blob_fingerprint(incoming, extra_incoming) == blob_fingerprint(existing, extra_existing):
        return SYNC_DUPLICATE, None

    incoming_v = incoming.get("version")
    if incoming_v is None:
        return SYNC_CONFLICT, "version_required"
    existing_v = int(existing.get("version") or 1)
    if int(incoming_v) != existing_v:
        return SYNC_CONFLICT, "version_mismatch"
    return SYNC_UPDATED, None
