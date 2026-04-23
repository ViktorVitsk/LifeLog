import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.enums import EntryType
from app.models import Entry, User
from app.schemas.entry import EntryRead, EntrySyncRequest, EntrySyncResponse

router = APIRouter(prefix="/api/entries", tags=["entries"])
logger = logging.getLogger(__name__)


@router.post("/sync", response_model=EntrySyncResponse)
async def sync_entries(
    payload: EntrySyncRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EntrySyncResponse:
    """
    Accept an array of encrypted entries from the client.
    Idempotent on `id` (ON CONFLICT DO NOTHING) — safe to retry from the
    offline queue.

    SECURITY: the server does NOT and MUST NOT attempt to decrypt
    `encrypted_content` / `encrypted_dek`. We only log the entry ids and types.
    """
    if not payload.entries:
        return EntrySyncResponse(saved=[], errors=[])

    rows = [
        {
            "id": e.id,
            "user_id": current_user.id,
            "timestamp": e.timestamp,
            "entry_type": e.entry_type.value,
            "skill_id": e.skill_id,
            "habit_id": e.habit_id,
            "context_id": e.context_id,
            "tags": e.tags,
            "mood_score": e.mood_score,
            "energy_score": e.energy_score,
            "anxiety_score": e.anxiety_score,
            "focus_score": e.focus_score,
            "social_battery_score": e.social_battery_score,
            "stress_score": e.stress_score,
            "sleep_hours": e.sleep_hours,
            "sleep_quality": e.sleep_quality,
            "session_duration_min": e.session_duration_min,
            "habit_completed": e.habit_completed,
            "habit_value": e.habit_value,
            "resentment_score": e.resentment_score,
            "guilt_score": e.guilt_score,
            "shame_score": e.shame_score,
            "fear_score": e.fear_score,
            "encrypted_dek": e.encrypted_dek,
            "encrypted_content": e.encrypted_content,
            "synced_from_offline": False,
        }
        for e in payload.entries
    ]

    stmt = pg_insert(Entry).values(rows).on_conflict_do_nothing(index_elements=["id"])
    stmt = stmt.returning(Entry.id)
    try:
        result = await db.execute(stmt)
        saved_ids = [row[0] for row in result.fetchall()]
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("sync failed user=%s count=%d", current_user.id, len(rows))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to persist entries: {exc.__class__.__name__}",
        ) from exc

    logger.info(
        "sync ok user=%s received=%d saved=%d",
        current_user.id,
        len(rows),
        len(saved_ids),
    )
    return EntrySyncResponse(saved=saved_ids, errors=[])


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
    stmt = select(Entry).where(Entry.user_id == current_user.id)
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


@router.get("/{entry_id}", response_model=EntryRead)
async def get_entry(
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Entry:
    result = await db.execute(
        select(Entry).where(Entry.id == entry_id, Entry.user_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry
