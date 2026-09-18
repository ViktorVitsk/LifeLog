"""CHECK ranges, habit-history index. Do not rewrite out-of-range values.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RANGES: dict[str, tuple[float, float]] = {
    "mood_score": (1, 10),
    "energy_score": (1, 10),
    "anxiety_score": (1, 10),
    "focus_score": (1, 10),
    "social_battery_score": (1, 10),
    "stress_score": (1, 10),
    "sleep_quality": (1, 10),
    "resentment_score": (1, 10),
    "guilt_score": (1, 10),
    "shame_score": (1, 10),
    "fear_score": (1, 10),
    "sleep_hours": (0, 24),
    "weight_kg": (0, 500),
    "body_fat_pct": (0, 100),
    "session_duration_min": (0, 24 * 60),
}


def _incompatible_where() -> str:
    return " OR ".join(
        f"({column} IS NOT NULL AND ({column} < {lo} OR {column} > {hi}))"
        for column, (lo, hi) in RANGES.items()
    )


def upgrade() -> None:
    bind = op.get_bind()
    count = bind.execute(sa.text(f"SELECT COUNT(*) FROM entries WHERE {_incompatible_where()}")).scalar()
    if count:
        raise RuntimeError(
            f"compat_precheck_failed: {count} rows are outside the 1-10 / documented ranges. "
            "Values were not rewritten. Inspect and migrate them explicitly."
        )

    for column, (lo, hi) in RANGES.items():
        op.create_check_constraint(
            f"ck_entries_{column}",
            "entries",
            f"{column} IS NULL OR ({column} >= {lo} AND {column} <= {hi})",
        )

    op.create_index(
        "ix_entries_user_habit_timestamp",
        "entries",
        ["user_id", "habit_id", "timestamp"],
        postgresql_where=sa.text("habit_id IS NOT NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        "ix_entries_user_skill_timestamp",
        "entries",
        ["user_id", "skill_id", "timestamp"],
        postgresql_where=sa.text("skill_id IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_entries_user_skill_timestamp", table_name="entries")
    op.drop_index("ix_entries_user_habit_timestamp", table_name="entries")
    for column in RANGES:
        op.drop_constraint(f"ck_entries_{column}", "entries", type_="check")
