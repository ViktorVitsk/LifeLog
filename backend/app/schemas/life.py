from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LifeSyncResult(BaseModel):
    id: UUID
    status: Literal["created", "updated", "duplicate", "conflict", "rejected", "deleted"]
    reason: str | None = None
    version: int | None = None


class LifeSyncResponse(BaseModel):
    results: list[LifeSyncResult] = Field(default_factory=list)
    saved: list[UUID] = Field(default_factory=list)


class GoalSyncItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    state: str = "draft"
    review_at: datetime | None = None
    habit_ids: list[UUID] = Field(default_factory=list)
    skill_ids: list[UUID] = Field(default_factory=list)
    entry_ids: list[UUID] = Field(default_factory=list)
    encrypted_dek: str = ""
    encrypted_content: str = ""
    version: int | None = None
    deleted: bool = False


class GoalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    state: str
    version: int
    review_at: datetime | None
    encrypted_dek: str
    encrypted_content: str
    created_at: datetime
    updated_at: datetime
    habit_ids: list[UUID] = Field(default_factory=list)
    skill_ids: list[UUID] = Field(default_factory=list)
    entry_ids: list[UUID] = Field(default_factory=list)


class MemorySyncItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    kind: str
    state: str = "proposed"
    origin: str = "user"
    reviewed_at: datetime | None = None
    entry_ids: list[UUID] = Field(default_factory=list)
    encrypted_dek: str = ""
    encrypted_content: str = ""
    version: int | None = None
    deleted: bool = False


class MemoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    state: str
    origin: str
    version: int
    reviewed_at: datetime | None
    encrypted_dek: str
    encrypted_content: str
    created_at: datetime
    updated_at: datetime
    entry_ids: list[UUID] = Field(default_factory=list)


class ActionSyncItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    goal_id: UUID
    state: str = "proposed"
    result_metric: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    review_at: datetime | None = None
    encrypted_dek: str = ""
    encrypted_content: str = ""
    version: int | None = None
    deleted: bool = False


class ActionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    goal_id: UUID
    state: str
    result_metric: str | None
    period_start: datetime | None
    period_end: datetime | None
    review_at: datetime | None
    version: int
    encrypted_dek: str
    encrypted_content: str
    created_at: datetime
    updated_at: datetime


class FeedbackSyncItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    action_id: UUID
    outcome_kind: str
    encrypted_dek: str = ""
    encrypted_content: str = ""
    version: int | None = None
    deleted: bool = False


class FeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    action_id: UUID
    outcome_kind: str
    version: int
    encrypted_dek: str
    encrypted_content: str
    created_at: datetime
    updated_at: datetime


class GoalSyncRequest(BaseModel):
    items: list[GoalSyncItem]


class MemorySyncRequest(BaseModel):
    items: list[MemorySyncItem]


class ActionSyncRequest(BaseModel):
    items: list[ActionSyncItem]


class FeedbackSyncRequest(BaseModel):
    items: list[FeedbackSyncItem]


class LifeBundle(BaseModel):
    goals: list[GoalRead]
    memory: list[MemoryRead]
    actions: list[ActionRead]
    feedback: list[FeedbackRead]
    due_action_ids: list[UUID] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)
