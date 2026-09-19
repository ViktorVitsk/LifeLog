import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.enums import EntryType
from app.models import ContextTag, Entry, Goal, Habit, Skill, User
from app.schemas.entry import (
    EntryRead,
    EntrySyncItem,
    EntrySyncRequest,
    EntrySyncResponse,
    SyncItemResult,
)
from app.services.calendar_days import DEFAULT_TIMEZONE, validate_timezone
from app.services.sync_contract import decide_sync_item

router = APIRouter(prefix="/api/entries", tags=["entries"])
logger = logging.getLogger(__name__)


def _entry_as_dict(row: Entry) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "timestamp": row.timestamp,
        "entry_type": row.entry_type,
        "skill_id": row.skill_id,
        "habit_id": row.habit_id,
        "context_id": row.context_id,
        "goal_id": row.goal_id,
        "tags": row.tags,
        "mood_score": row.mood_score,
        "energy_score": row.energy_score,
        "anxiety_score": row.anxiety_score,
        "focus_score": row.focus_score,
        "social_battery_score": row.social_battery_score,
        "stress_score": row.stress_score,
        "sleep_hours": row.sleep_hours,
        "sleep_quality": row.sleep_quality,
        "weight_kg": row.weight_kg,
        "body_fat_pct": row.body_fat_pct,
        "session_duration_min": row.session_duration_min,
        "habit_completed": row.habit_completed,
        "habit_value": row.habit_value,
        "resentment_score": row.resentment_score,
        "guilt_score": row.guilt_score,
        "shame_score": row.shame_score,
        "fear_score": row.fear_score,
        "encrypted_dek": row.encrypted_dek,
        "encrypted_content": row.encrypted_content,
        "version": row.version,
        "deleted_at": row.deleted_at,
        "deleted": row.deleted_at is not None,
        "recorded_at": row.recorded_at,
        "event_timezone": row.event_timezone,
    }


def _row_values(item: EntrySyncItem, user_id: UUID, account_tz: str) -> dict:
    return {
        "id": item.id,
        "user_id": user_id,
        "timestamp": item.timestamp,
        "entry_type": item.entry_type,
        "skill_id": item.skill_id,
        "habit_id": item.habit_id,
        "context_id": item.context_id,
        "goal_id": item.goal_id,
        "tags": item.tags,
        "mood_score": item.mood_score,
        "energy_score": item.energy_score,
        "anxiety_score": item.anxiety_score,
        "focus_score": item.focus_score,
        "social_battery_score": item.social_battery_score,
        "stress_score": item.stress_score,
        "sleep_hours": item.sleep_hours,
        "sleep_quality": item.sleep_quality,
        "weight_kg": item.weight_kg,
        "body_fat_pct": item.body_fat_pct,
        "session_duration_min": item.session_duration_min,
        "habit_completed": item.habit_completed,
        "habit_value": item.habit_value,
        "resentment_score": item.resentment_score,
        "guilt_score": item.guilt_score,
        "shame_score": item.shame_score,
        "fear_score": item.fear_score,
        "encrypted_dek": item.encrypted_dek,
        "encrypted_content": item.encrypted_content,
        "synced_from_offline": True,
        "version": 1,
        "deleted_at": None,
        "recorded_at": item.recorded_at or datetime.now(UTC),
        "event_timezone": item.event_timezone or account_tz,
    }


@router.post("/sync", response_model=EntrySyncResponse)
async def sync_entries(
    payload: EntrySyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EntrySyncResponse:
    """
    Accept encrypted entries. Each item gets its own result.
    The server never decrypts `encrypted_content` / `encrypted_dek`.
    Logs only counts and safe reason codes.
    """
    if not payload.entries:
        return EntrySyncResponse(results=[], saved=[], errors=[])

    user_id = current_user.id
    account_tz = getattr(current_user, "timezone", None) or DEFAULT_TIMEZONE
    try:
        validate_timezone(account_tz)
    except ValueError:
        account_tz = DEFAULT_TIMEZONE
    incoming_ids = [item.id for item in payload.entries]
    existing_rows = (
        await db.execute(select(Entry).where(Entry.id.in_(incoming_ids)))
    ).scalars().all()
    existing_by_id = {row.id: _entry_as_dict(row) for row in existing_rows}

    owned_skills = set(
        (await db.execute(select(Skill.id).where(Skill.user_id == user_id))).scalars().all()
    )
    owned_habits = set(
        (await db.execute(select(Habit.id).where(Habit.user_id == user_id))).scalars().all()
    )
    owned_contexts = set(
        (await db.execute(select(ContextTag.id).where(ContextTag.user_id == user_id))).scalars().all()
    )
    owned_goals = set(
        (
            await db.execute(select(Goal.id).where(Goal.user_id == user_id, Goal.deleted_at.is_(None)))
        ).scalars().all()
    )

    results: list[SyncItemResult] = []
    created = duplicate = conflict = rejected = deleted = updated = 0

    for item in payload.entries:
        incoming = item.model_dump()
        status_name, reason = decide_sync_item(
            incoming,
            user_id=user_id,
            existing=existing_by_id.get(item.id),
            owned_skill_ids=owned_skills,
            owned_habit_ids=owned_habits,
            owned_context_ids=owned_contexts,
            owned_goal_ids=owned_goals,
        )
        if status_name == "deleted":
            stored = existing_by_id.get(item.id)
            if stored and stored.get("deleted_at") is None and stored.get("user_id") == user_id:
                live = (
                    await db.execute(select(Entry).where(Entry.id == item.id, Entry.user_id == user_id))
                ).scalar_one_or_none()
                if live is not None and live.deleted_at is None:
                    live.deleted_at = datetime.now(UTC)
                    live.version = (live.version or 1) + 1
                    await db.flush()
                    existing_by_id[item.id] = _entry_as_dict(live)
            results.append(SyncItemResult(id=item.id, status="deleted"))
            deleted += 1
            continue

        if status_name == "updated":
            live = (
                await db.execute(select(Entry).where(Entry.id == item.id, Entry.user_id == user_id))
            ).scalar_one_or_none()
            expected = (live.version if live is not None else 1) or 1
            values = {
                k: v
                for k, v in _row_values(item, user_id, account_tz).items()
                if k not in {"id", "user_id", "version"}
            }
            stmt = (
                update(Entry)
                .where(Entry.id == item.id, Entry.user_id == user_id, Entry.version == expected)
                .values(**values, version=expected + 1)
            )
            cas = await db.execute(stmt)
            if (cas.rowcount or 0) != 1:
                results.append(SyncItemResult(id=item.id, status="conflict", reason="version_mismatch"))
                conflict += 1
                continue
            results.append(SyncItemResult(id=item.id, status="updated", version=expected + 1))
            existing_by_id[item.id] = {**incoming, "user_id": user_id, "version": expected + 1, "deleted_at": None}
            updated += 1
            continue

        if status_name != "created":
            results.append(SyncItemResult(id=item.id, status=status_name, reason=reason))
            if status_name == "duplicate":
                duplicate += 1
            elif status_name == "conflict":
                conflict += 1
            else:
                rejected += 1
            continue

        try:
            async with db.begin_nested():
                db.add(Entry(**_row_values(item, user_id, account_tz)))
                await db.flush()
            results.append(SyncItemResult(id=item.id, status="created"))
            existing_by_id[item.id] = {**incoming, "user_id": user_id, "version": 1, "deleted_at": None}
            created += 1
        except IntegrityError:
            again = (
                await db.execute(select(Entry).where(Entry.id == item.id))
            ).scalar_one_or_none()
            if again is None:
                results.append(
                    SyncItemResult(id=item.id, status="rejected", reason="persist_failed")
                )
                rejected += 1
                continue
            status_name, reason = decide_sync_item(
                incoming,
                user_id=user_id,
                existing=_entry_as_dict(again),
                owned_skill_ids=owned_skills,
                owned_habit_ids=owned_habits,
                owned_context_ids=owned_contexts,
                owned_goal_ids=owned_goals,
            )
            if status_name == "created":
                status_name, reason = "rejected", "persist_failed"
            results.append(SyncItemResult(id=item.id, status=status_name, reason=reason))
            if status_name == "duplicate":
                duplicate += 1
            elif status_name == "conflict":
                conflict += 1
            elif status_name == "deleted":
                deleted += 1
            else:
                rejected += 1

    await db.commit()

    saved = [row.id for row in results if row.status in ("created", "duplicate", "updated")]
    errors = [
        {"id": str(row.id), "reason": row.reason}
        for row in results
        if row.status in ("conflict", "rejected")
    ]
    logger.info(
        "sync ok user=%s received=%d created=%d duplicate=%d updated=%d conflict=%d rejected=%d deleted=%d",
        user_id,
        len(payload.entries),
        created,
        duplicate,
        updated,
        conflict,
        rejected,
        deleted,
    )
    return EntrySyncResponse(results=results, saved=saved, errors=errors)


@router.get("", response_model=list[EntryRead])
async def list_entries(
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    entry_type: EntryType | None = Query(default=None),
    skill_id: UUID | None = Query(default=None),
    habit_id: UUID | None = Query(default=None),
    tag: str | None = Query(default=None, description="Filter by single tag (JSONB contains)"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EntryRead]:
    stmt = select(Entry).where(Entry.user_id == current_user.id, Entry.deleted_at.is_(None))
    if start_date is not None:
        stmt = stmt.where(Entry.timestamp >= start_date)
    if end_date is not None:
        stmt = stmt.where(Entry.timestamp <= end_date)
    if entry_type is not None:
        stmt = stmt.where(Entry.entry_type == entry_type.value)
    if skill_id is not None:
        stmt = stmt.where(Entry.skill_id == skill_id)
    if habit_id is not None:
        stmt = stmt.where(Entry.habit_id == habit_id)
    if tag is not None:
        stmt = stmt.where(Entry.tags.contains([tag]))
    stmt = stmt.order_by(Entry.timestamp.desc()).limit(limit).offset(offset)

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/tombstones")
async def list_entry_tombstones(
    since: datetime | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Entry.id, Entry.deleted_at, Entry.version).where(
        Entry.user_id == current_user.id, Entry.deleted_at.is_not(None)
    )
    if since is not None:
        stmt = stmt.where(Entry.deleted_at >= since)
    rows = (await db.execute(stmt)).all()
    return {"items": [{"id": row[0], "deleted_at": row[1], "version": row[2]} for row in rows]}


@router.get("/{entry_id}", response_model=EntryRead)
async def get_entry(
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Entry:
    result = await db.execute(
        select(Entry).where(
            Entry.id == entry_id,
            Entry.user_id == current_user.id,
            Entry.deleted_at.is_(None),
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry
