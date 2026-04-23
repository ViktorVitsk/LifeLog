from datetime import datetime
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

    tags: list[str] = Field(default_factory=list)

    # open numeric metrics (all optional, only set when applicable to entry_type)
    mood_score: int | None = Field(default=None, ge=1, le=10)
    energy_score: int | None = Field(default=None, ge=1, le=10)
    anxiety_score: int | None = Field(default=None, ge=1, le=10)
    sleep_hours: float | None = Field(default=None, ge=0, le=24)
    sleep_quality: int | None = Field(default=None, ge=1, le=10)
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


class EntrySyncRequest(BaseModel):
    entries: list[EntryCreate]


class EntrySyncResponse(BaseModel):
    saved: list[UUID]
    errors: list[dict] = Field(default_factory=list)


class EntryRead(EntryBase):
    """Returned to the client. Contains ciphertext; client decrypts locally."""

    model_config = ConfigDict(from_attributes=True)

    encrypted_dek: str
    encrypted_content: str
    created_at: datetime
    synced_from_offline: bool
