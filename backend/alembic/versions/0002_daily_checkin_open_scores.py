"""add open focus/social/stress scores for daily check-in analytics

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-23

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "entries",
        sa.Column("focus_score", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "entries",
        sa.Column("social_battery_score", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "entries",
        sa.Column("stress_score", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("entries", "stress_score")
    op.drop_column("entries", "social_battery_score")
    op.drop_column("entries", "focus_score")
