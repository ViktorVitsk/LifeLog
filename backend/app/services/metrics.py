"""Open-metric catalog: scale, unit, range, aggregation, filters, missing."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Agg = Literal["avg", "sum", "rate"]

PERIOD_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
MIN_JOINT_DAYS = 3
MAX_LAG_DAYS = 7


@dataclass(frozen=True)
class MetricSpec:
    key: str
    unit: str
    scale_min: float | None
    scale_max: float | None
    aggregation: Agg
    required_filters: tuple[str, ...] = ()
    missing: str = "skip"
    description: str = ""


def _score(key: str, description: str) -> MetricSpec:
    return MetricSpec(
        key=key,
        unit="score",
        scale_min=1,
        scale_max=10,
        aggregation="avg",
        description=description,
    )


METRICS: dict[str, MetricSpec] = {
    "mood_score": _score("mood_score", "Daily mood; missing stays missing"),
    "energy_score": _score("energy_score", "Daily energy"),
    "anxiety_score": _score("anxiety_score", "Daily anxiety"),
    "focus_score": _score("focus_score", "Daily focus"),
    "social_battery_score": _score("social_battery_score", "Social battery"),
    "stress_score": _score("stress_score", "Daily stress"),
    "sleep_quality": _score("sleep_quality", "Sleep quality on the wake day"),
    "resentment_score": _score("resentment_score", "Gap-model resentment"),
    "guilt_score": _score("guilt_score", "Gap-model guilt"),
    "shame_score": _score("shame_score", "Gap-model shame"),
    "fear_score": _score("fear_score", "Gap-model fear"),
    "sleep_hours": MetricSpec(
        key="sleep_hours",
        unit="hour",
        scale_min=0,
        scale_max=24,
        aggregation="avg",
        description="Hours slept; one night, not summed with other nights",
    ),
    "weight_kg": MetricSpec(
        key="weight_kg",
        unit="kg",
        scale_min=0,
        scale_max=500,
        aggregation="avg",
        description="Body weight",
    ),
    "body_fat_pct": MetricSpec(
        key="body_fat_pct",
        unit="percent",
        scale_min=0,
        scale_max=100,
        aggregation="avg",
        description="Body fat percent",
    ),
    "session_duration_min": MetricSpec(
        key="session_duration_min",
        unit="min",
        scale_min=0,
        scale_max=24 * 60,
        aggregation="sum",
        description="Practice minutes; sessions on the same day are summed",
    ),
    "habit_value": MetricSpec(
        key="habit_value",
        unit="habit_unit",
        scale_min=None,
        scale_max=None,
        aggregation="avg",
        required_filters=("habit_id",),
        description="Habit numeric value; never mix habits",
    ),
    "habit_completed": MetricSpec(
        key="habit_completed",
        unit="rate",
        scale_min=0,
        scale_max=1,
        aggregation="rate",
        required_filters=("habit_id",),
        description="Completion rate for one habit",
    ),
}


def get_metric(key: str) -> MetricSpec | None:
    return METRICS.get(key)


def period_length(period: str) -> int:
    return PERIOD_DAYS.get(period, 30)


def reduce_values(values: list[float], aggregation: Agg) -> float:
    if not values:
        raise ValueError("empty")
    if aggregation == "sum":
        return float(sum(values))
    return float(sum(values) / len(values))


def shift_civil_day(day: str, delta: int) -> str:
    year, month, day_n = (int(part) for part in day.split("-"))
    return (date(year, month, day_n) + timedelta(days=delta)).isoformat()


def coverage(days_with_data: int, period_days: int) -> float:
    if period_days <= 0:
        return 0.0
    return days_with_data / period_days


def normalize_sample(value: object, spec: MetricSpec) -> float | None:
    """Skip missing. Do not clamp out-of-range values here — persist already rejected them."""
    if value is None:
        return None
    if spec.aggregation == "rate":
        if isinstance(value, bool):
            return 1.0 if value else 0.0
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None
