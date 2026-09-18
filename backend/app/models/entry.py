import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, SmallInteger, String, Text, func, text
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
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
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
    goal_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("goals.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
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
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_entries_user_timestamp", "user_id", "timestamp"),
        Index("ix_entries_tags_gin", "tags", postgresql_using="gin"),
        Index(
            "ix_entries_user_habit_timestamp",
            "user_id",
            "habit_id",
            "timestamp",
            postgresql_where=text("habit_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "ix_entries_user_skill_timestamp",
            "user_id",
            "skill_id",
            "timestamp",
            postgresql_where=text("skill_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        CheckConstraint("mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 10)", name="ck_entries_mood_score"),
        CheckConstraint("energy_score IS NULL OR (energy_score >= 1 AND energy_score <= 10)", name="ck_entries_energy_score"),
        CheckConstraint("anxiety_score IS NULL OR (anxiety_score >= 1 AND anxiety_score <= 10)", name="ck_entries_anxiety_score"),
        CheckConstraint("focus_score IS NULL OR (focus_score >= 1 AND focus_score <= 10)", name="ck_entries_focus_score"),
        CheckConstraint(
            "social_battery_score IS NULL OR (social_battery_score >= 1 AND social_battery_score <= 10)",
            name="ck_entries_social_battery_score",
        ),
        CheckConstraint("stress_score IS NULL OR (stress_score >= 1 AND stress_score <= 10)", name="ck_entries_stress_score"),
        CheckConstraint("sleep_quality IS NULL OR (sleep_quality >= 1 AND sleep_quality <= 10)", name="ck_entries_sleep_quality"),
        CheckConstraint(
            "resentment_score IS NULL OR (resentment_score >= 1 AND resentment_score <= 10)",
            name="ck_entries_resentment_score",
        ),
        CheckConstraint("guilt_score IS NULL OR (guilt_score >= 1 AND guilt_score <= 10)", name="ck_entries_guilt_score"),
        CheckConstraint("shame_score IS NULL OR (shame_score >= 1 AND shame_score <= 10)", name="ck_entries_shame_score"),
        CheckConstraint("fear_score IS NULL OR (fear_score >= 1 AND fear_score <= 10)", name="ck_entries_fear_score"),
        CheckConstraint("sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24)", name="ck_entries_sleep_hours"),
        CheckConstraint("weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 500)", name="ck_entries_weight_kg"),
        CheckConstraint("body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100)", name="ck_entries_body_fat_pct"),
        CheckConstraint(
            "session_duration_min IS NULL OR (session_duration_min >= 0 AND session_duration_min <= 1440)",
            name="ck_entries_session_duration_min",
        ),
    )
