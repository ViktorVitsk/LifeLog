"""add optional open weight / body fat for analytics

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-23

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "entries",
        sa.Column("weight_kg", sa.Float(), nullable=True),
    )
    op.add_column(
        "entries",
        sa.Column("body_fat_pct", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("entries", "body_fat_pct")
    op.drop_column("entries", "weight_kg")
