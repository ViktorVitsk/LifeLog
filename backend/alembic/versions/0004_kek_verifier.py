"""add encrypted KEK verifier on users (client-wrapped, server never decrypts)

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-19

Prepared in stage A3. Do not apply on the working personal database from the
agent session. Apply only after an explicit backup and permission.

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("encrypted_kek_verifier_content", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("encrypted_kek_verifier_dek", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "encrypted_kek_verifier_dek")
    op.drop_column("users", "encrypted_kek_verifier_content")
