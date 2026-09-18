"""
Export of **metadata** (open fields) without ciphertext blobs.
Full decrypted JSON export is performed client-side with the KEK.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.enums import EntryType
from app.models import Entry, User

router = APIRouter(prefix="/api/export", tags=["export"])


class ExportMetadataRow(BaseModel):
    """One row: everything the server may expose except ciphertext."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    timestamp: datetime
    recorded_at: datetime | None = None
    event_timezone: str | None = None
    entry_type: EntryType
    skill_id: UUID | None = None
    habit_id: UUID | None = None
    context_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    mood_score: int | None = None
    energy_score: int | None = None
    anxiety_score: int | None = None
    focus_score: int | None = None
    social_battery_score: int | None = None
    stress_score: int | None = None
    sleep_hours: float | None = None
    sleep_quality: int | None = None
    weight_kg: float | None = None
    body_fat_pct: float | None = None
    session_duration_min: int | None = None
    habit_completed: bool | None = None
    habit_value: float | None = None
    resentment_score: int | None = None
    guilt_score: int | None = None
    shame_score: int | None = None
    fear_score: int | None = None
    created_at: datetime
    synced_from_offline: bool
    version: int = 1


class ExportPage(BaseModel):
    items: list[ExportMetadataRow]
    offset: int
    limit: int
    total: int
    next_offset: int | None = None


@router.get("/metadata", response_model=ExportPage)
async def export_metadata(
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExportPage:
    filt = (Entry.user_id == current_user.id, Entry.deleted_at.is_(None))
    total = int(await db.scalar(select(func.count()).select_from(Entry).where(*filt)) or 0)
    stmt = (
        select(Entry)
        .where(*filt)
        .order_by(Entry.timestamp.desc(), Entry.id.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    next_offset = offset + limit if offset + len(rows) < total else None
    return ExportPage(
        items=[ExportMetadataRow.model_validate(row) for row in rows],
        offset=offset,
        limit=limit,
        total=total,
        next_offset=next_offset,
    )
