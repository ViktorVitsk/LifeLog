from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums import EntryType


class EntryBase(BaseModel):
    """Shared fields between create/read. Only open (never-encrypted) data here."""

    id: UUID
    timestamp: datetime
    entry_type: EntryType

    skill_id: UUID | None = None
    habit_id: UUID | None = None
    context_id: UUID | None = None
    goal_id: UUID | None = None

    tags: list[str] = Field(default_factory=list)

    # open numeric metrics (all optional, only set when applicable to entry_type)
    mood_score: int | None = Field(default=None, ge=1, le=10)
    energy_score: int | None = Field(default=None, ge=1, le=10)
    anxiety_score: int | None = Field(default=None, ge=1, le=10)
    focus_score: int | None = Field(default=None, ge=1, le=10)
    social_battery_score: int | None = Field(default=None, ge=1, le=10)
    stress_score: int | None = Field(default=None, ge=1, le=10)
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    sleep_quality: int | None = Field(default=None, ge=1, le=10)
    weight_kg: float | None = Field(default=None, ge=0, le=500)
    body_fat_pct: float | None = Field(default=None, ge=0, le=100)
    session_duration_min: int | None = Field(default=None, ge=0)
    habit_completed: bool | None = None
    habit_value: float | None = None
    resentment_score: int | None = Field(default=None, ge=1, le=10)
    guilt_score: int | None = Field(default=None, ge=1, le=10)
    shame_score: int | None = Field(default=None, ge=1, le=10)
    fear_score: int | None = Field(default=None, ge=1, le=10)


class EntryCreate(EntryBase):
    """Payload sent from the client when syncing a new entry."""

    encrypted_dek: str
    encrypted_content: str


class EntrySyncItem(BaseModel):
    """Permissive sync item. Range/enum/FK checks happen per row, not as HTTP 422."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    timestamp: datetime
    entry_type: str
    skill_id: UUID | None = None
    habit_id: UUID | None = None
    context_id: UUID | None = None
    goal_id: UUID | None = None
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
    encrypted_dek: str = ""
    encrypted_content: str = ""
    version: int | None = None
    deleted: bool = False
    recorded_at: datetime | None = None
    event_timezone: str | None = None


class EntrySyncRequest(BaseModel):
    entries: list[EntrySyncItem]


class SyncItemResult(BaseModel):
    id: UUID
    status: Literal["created", "duplicate", "conflict", "rejected", "deleted"]
    reason: str | None = None


class EntrySyncResponse(BaseModel):
    results: list[SyncItemResult] = Field(default_factory=list)
    saved: list[UUID] = Field(default_factory=list)
    errors: list[dict[str, Any]] = Field(default_factory=list)


class EntryRead(EntryBase):
    """Returned to the client. Contains ciphertext; client decrypts locally."""

    model_config = ConfigDict(from_attributes=True)

    encrypted_dek: str
    encrypted_content: str
    created_at: datetime
    synced_from_offline: bool
    version: int = 1
    recorded_at: datetime | None = None
    event_timezone: str | None = None
