from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str | None = Field(default=None, max_length=16)
    icon: str | None = Field(default=None, max_length=64)
    metric_schema: dict[str, Any] = Field(default_factory=dict)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color: str | None = None
    icon: str | None = None
    metric_schema: dict[str, Any] | None = None
    is_active: bool | None = None


class SkillRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    color: str | None
    icon: str | None
    metric_schema: dict[str, Any]
    is_active: bool
    created_at: datetime
