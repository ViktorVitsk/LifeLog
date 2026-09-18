"""Range checks shared by API, UI, and Alembic. Never clamp existing values."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

SCORE_COLUMNS: tuple[str, ...] = (
    "mood_score",
    "energy_score",
    "anxiety_score",
    "focus_score",
    "social_battery_score",
    "stress_score",
    "sleep_quality",
    "resentment_score",
    "guilt_score",
    "shame_score",
    "fear_score",
)

RANGES: dict[str, tuple[float, float]] = {
    **{name: (1, 10) for name in SCORE_COLUMNS},
    "sleep_hours": (0, 24),
    "weight_kg": (0, 500),
    "body_fat_pct": (0, 100),
    "session_duration_min": (0, 24 * 60),
}


def incompatible_where_sql() -> str:
    clauses = [
        f"({column} IS NOT NULL AND ({column} < {lo} OR {column} > {hi}))"
        for column, (lo, hi) in RANGES.items()
    ]
    return " OR ".join(clauses)


def check_constraints() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for column, (lo, hi) in RANGES.items():
        out.append(
            (
                f"ck_entries_{column}",
                f"{column} IS NULL OR ({column} >= {lo} AND {column} <= {hi})",
            )
        )
    return out


def classify_value(column: str, value: Any) -> str | None:
    if value is None:
        return None
    bounds = RANGES.get(column)
    if bounds is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "out_of_range"
    lo, hi = bounds
    if value < lo or value > hi:
        return "out_of_range"
    return None


def precheck_rows(rows: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Describe incompatible rows. Does not rewrite them."""
    report: list[dict[str, Any]] = []
    for row in rows:
        fields = [
            column
            for column in RANGES
            if classify_value(column, row.get(column)) == "out_of_range"
        ]
        if fields:
            report.append({"id": row.get("id"), "fields": fields})
    return report
