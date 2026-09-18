"""
Export of **metadata** (open fields) without ciphertext blobs.
Full decrypted JSON export is performed client-side with the KEK.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
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


@router.get("/metadata", response_model=list[ExportMetadataRow])
async def export_metadata(
    limit: int = Query(default=1000, ge=1, le=10000),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ExportMetadataRow]:
    stmt = (
        select(Entry)
        .where(Entry.user_id == current_user.id)
        .order_by(Entry.timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [ExportMetadataRow.model_validate(r) for r in rows]
