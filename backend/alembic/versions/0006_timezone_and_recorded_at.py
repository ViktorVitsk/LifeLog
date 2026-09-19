"""account IANA timezone; event vs input time

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-19

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
    )
    op.add_column(
        "entries",
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "entries",
        sa.Column("event_timezone", sa.String(length=64), nullable=True),
    )
    op.execute("UPDATE entries SET recorded_at = timestamp")
    op.execute(
        """
        UPDATE entries AS e
        SET event_timezone = u.timezone
        FROM users AS u
        WHERE u.id = e.user_id AND e.event_timezone IS NULL
        """
    )
    op.execute("UPDATE entries SET event_timezone = 'UTC' WHERE event_timezone IS NULL")
    op.alter_column("entries", "recorded_at", nullable=False)
    op.alter_column("entries", "event_timezone", nullable=False)


def downgrade() -> None:
    op.drop_column("entries", "event_timezone")
    op.drop_column("entries", "recorded_at")
    op.drop_column("users", "timezone")
