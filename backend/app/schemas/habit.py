from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.enums import HabitFrequency


class HabitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    frequency: HabitFrequency = HabitFrequency.DAILY
    target_value: float | None = None
    unit: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=16)


class HabitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    frequency: HabitFrequency | None = None
    target_value: float | None = None
    unit: str | None = None
    color: str | None = None
    is_active: bool | None = None


class HabitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    frequency: HabitFrequency
    target_value: float | None
    unit: str | None
    color: str | None
    is_active: bool
    created_at: datetime
