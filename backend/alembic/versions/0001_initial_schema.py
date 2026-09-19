"""initial schema: users, skills, habits, context_tags, entries

Revision ID: 0001
Revises:
Create Date: 2026-04-23

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # users
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("password_salt", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    # skills
    op.create_table(
        "skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column("icon", sa.String(length=64), nullable=True),
        sa.Column(
            "metric_schema",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_skills_user_id", "skills", ["user_id"])

    # habits
    op.create_table(
        "habits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column(
            "frequency",
            sa.String(length=16),
            nullable=False,
            server_default="daily",
        ),
        sa.Column("target_value", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_habits_user_id", "habits", ["user_id"])

    # context_tags (always unencrypted)
    op.create_table(
        "context_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("location", sa.String(length=64), nullable=True),
        sa.Column(
            "social_presence",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("weather", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_context_tags_user_id", "context_tags", ["user_id"])

    # entries (core)
    op.create_table(
        "entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry_type", sa.Text(), nullable=False),
        sa.Column(
            "skill_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("skills.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "habit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("habits.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "context_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("context_tags.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # open numeric metrics
        sa.Column("mood_score", sa.SmallInteger(), nullable=True),
        sa.Column("energy_score", sa.SmallInteger(), nullable=True),
        sa.Column("anxiety_score", sa.SmallInteger(), nullable=True),
        sa.Column("sleep_hours", sa.Float(), nullable=True),
        sa.Column("sleep_quality", sa.SmallInteger(), nullable=True),
        sa.Column("session_duration_min", sa.Integer(), nullable=True),
        sa.Column("habit_completed", sa.Boolean(), nullable=True),
        sa.Column("habit_value", sa.Float(), nullable=True),
        sa.Column("resentment_score", sa.SmallInteger(), nullable=True),
        sa.Column("guilt_score", sa.SmallInteger(), nullable=True),
        sa.Column("shame_score", sa.SmallInteger(), nullable=True),
        sa.Column("fear_score", sa.SmallInteger(), nullable=True),
        # encrypted blobs
        sa.Column("encrypted_dek", sa.Text(), nullable=False),
        sa.Column("encrypted_content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "synced_from_offline",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index("ix_entries_user_id", "entries", ["user_id"])
    op.create_index("ix_entries_timestamp", "entries", ["timestamp"])
    op.create_index("ix_entries_entry_type", "entries", ["entry_type"])
    op.create_index("ix_entries_skill_id", "entries", ["skill_id"])
    op.create_index("ix_entries_user_timestamp", "entries", ["user_id", "timestamp"])
    op.create_index(
        "ix_entries_tags_gin",
        "entries",
        ["tags"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_entries_tags_gin", table_name="entries")
    op.drop_index("ix_entries_user_timestamp", table_name="entries")
    op.drop_index("ix_entries_skill_id", table_name="entries")
    op.drop_index("ix_entries_entry_type", table_name="entries")
    op.drop_index("ix_entries_timestamp", table_name="entries")
    op.drop_index("ix_entries_user_id", table_name="entries")
    op.drop_table("entries")

    op.drop_index("ix_context_tags_user_id", table_name="context_tags")
    op.drop_table("context_tags")

    op.drop_index("ix_habits_user_id", table_name="habits")
    op.drop_table("habits")

    op.drop_index("ix_skills_user_id", table_name="skills")
    op.drop_table("skills")

    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
