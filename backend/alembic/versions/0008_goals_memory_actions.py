"""goals, memory items, planned actions, feedback

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encrypted_dek", sa.Text(), nullable=False),
        sa.Column("encrypted_content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_goals_user_id", "goals", ["user_id"])

    op.add_column(
        "entries",
        sa.Column("goal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("goals.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_entries_goal_id", "entries", ["goal_id"])

    op.create_table(
        "goal_habit_links",
        sa.Column("goal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("habit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("habits.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_table(
        "goal_skill_links",
        sa.Column("goal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_table(
        "goal_entry_links",
        sa.Column("goal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_table(
        "memory_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("state", sa.String(32), nullable=False, server_default="proposed"),
        sa.Column("origin", sa.String(16), nullable=False, server_default="user"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encrypted_dek", sa.Text(), nullable=False),
        sa.Column("encrypted_content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_memory_items_user_id", "memory_items", ["user_id"])
    op.create_table(
        "memory_entry_links",
        sa.Column("memory_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("memory_items.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_table(
        "planned_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("goal_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("goals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", sa.String(32), nullable=False, server_default="proposed"),
        sa.Column("result_metric", sa.String(64), nullable=True),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("encrypted_dek", sa.Text(), nullable=False),
        sa.Column("encrypted_content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_planned_actions_user_id", "planned_actions", ["user_id"])
    op.create_index("ix_planned_actions_goal_id", "planned_actions", ["goal_id"])
    op.create_index("ix_planned_actions_user_review", "planned_actions", ["user_id", "review_at"])
    op.create_table(
        "action_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("planned_actions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("outcome_kind", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("encrypted_dek", sa.Text(), nullable=False),
        sa.Column("encrypted_content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_action_feedback_user_id", "action_feedback", ["user_id"])
    op.create_index("ix_action_feedback_action_id", "action_feedback", ["action_id"])


def downgrade() -> None:
    op.drop_table("action_feedback")
    op.drop_table("planned_actions")
    op.drop_table("memory_entry_links")
    op.drop_table("memory_items")
    op.drop_table("goal_entry_links")
    op.drop_table("goal_skill_links")
    op.drop_table("goal_habit_links")
    op.drop_index("ix_entries_goal_id", table_name="entries")
    op.drop_column("entries", "goal_id")
    op.drop_table("goals")
