import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.enums import EntryType


class Entry(Base):
    """
    CORE TABLE.

    The server only sees:
      - metadata (timestamp, entry_type, skill_id, habit_id, context_id, tags)
      - open numeric metrics (mood, energy, anxiety, sleep, psychological scores)
      - opaque ciphertext blobs (encrypted_content, encrypted_dek)

    It NEVER sees plaintext diary content.
    """

    __tablename__ = "entries"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    entry_type: Mapped[EntryType] = mapped_column(
        # Stored as VARCHAR in Postgres — avoids Alembic ENUM migration pain
        # while still constrained by the Python StrEnum at the app layer.
        Text,
        nullable=False,
        index=True,
    )

    skill_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    habit_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("habits.id", ondelete="SET NULL"),
        nullable=True,
    )
    context_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("context_tags.id", ondelete="SET NULL"),
        nullable=True,
    )

    tags: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)

    # ── Open numeric metrics (never encrypted) ───────────────────────────
    mood_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    energy_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    anxiety_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    focus_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    social_battery_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    stress_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    sleep_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_quality: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    session_duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)

    habit_completed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    habit_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    resentment_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    guilt_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    shame_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    fear_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    # ── Encrypted blobs ──────────────────────────────────────────────────
    encrypted_dek: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted_content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    synced_from_offline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_entries_user_timestamp", "user_id", "timestamp"),
        Index("ix_entries_tags_gin", "tags", postgresql_using="gin"),
    )
