"""
Aggregated analytics on **open** numeric fields only.
The server never touches ciphertext.
Days are account-local (IANA), not UTC date_trunc.
Each metric has a catalogued scale, unit, aggregation, and required filters.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Entry, User
from app.services.calendar_days import DEFAULT_TIMEZONE, entry_calendar_day
from app.services.metrics import (
    MAX_LAG_DAYS,
    METRICS,
    MIN_JOINT_DAYS,
    MetricSpec,
    coverage,
    get_metric,
    normalize_sample,
    period_length,
    reduce_values,
    shift_civil_day,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class MetricInfo(BaseModel):
    key: str
    unit: str
    scale_min: float | None
    scale_max: float | None
    aggregation: str
    required_filters: list[str]
    missing: str
    description: str


class TrendPoint(BaseModel):
    day: str = Field(description="Account-local calendar day YYYY-MM-DD")
    value: float
    n: int = 1


class TrendSeries(BaseModel):
    period: str
    period_days: int
    metric: str
    aggregation: str
    unit: str
    scale_min: float | None = None
    scale_max: float | None = None
    habit_id: UUID | None = None
    skill_id: UUID | None = None
    observations: int
    days_with_data: int
    coverage: float
    insufficient: bool = False
    points: list[TrendPoint]


class CorrelationPoint(BaseModel):
    day: str
    x: float
    y: float
    n_x: int = 1
    n_y: int = 1


class CorrelationSeries(BaseModel):
    period: str
    period_days: int
    x: str
    y: str
    lag_days: int
    x_aggregation: str
    y_aggregation: str
    observations: int
    days_with_data: int
    coverage: float
    insufficient: bool
    points: list[CorrelationPoint]


def _since_utc(period: str) -> datetime:
    return datetime.now(UTC) - timedelta(days=period_length(period))


def _account_tz(user: User) -> str:
    return getattr(user, "timezone", None) or DEFAULT_TIMEZONE


def _day_of(row: Entry, tz: str) -> str:
    return entry_calendar_day(
        timestamp=row.timestamp,
        entry_type=str(row.entry_type),
        sleep_hours=row.sleep_hours,
        time_zone=row.event_timezone or tz,
    )


def _require_metric(key: str) -> MetricSpec:
    spec = get_metric(key)
    if spec is None:
        raise HTTPException(status_code=400, detail=f"Unknown metric: {key}")
    return spec


def _require_filters(spec: MetricSpec, habit_id: UUID | None) -> None:
    if "habit_id" in spec.required_filters and habit_id is None:
        raise HTTPException(status_code=400, detail="missing_filter:habit_id")


async def _load_rows(
    db: AsyncSession,
    user: User,
    since: datetime,
    *,
    habit_id: UUID | None = None,
    skill_id: UUID | None = None,
) -> list[Entry]:
    stmt = select(Entry).where(
        Entry.user_id == user.id,
        Entry.deleted_at.is_(None),
        Entry.timestamp >= since,
    )
    if habit_id is not None:
        stmt = stmt.where(Entry.habit_id == habit_id)
    if skill_id is not None:
        stmt = stmt.where(Entry.skill_id == skill_id)
    return list((await db.execute(stmt)).scalars().all())


def _bucket(
    rows: list[Entry],
    spec: MetricSpec,
    tz: str,
) -> dict[str, list[float]]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        sample = normalize_sample(getattr(row, spec.key, None), spec)
        if sample is None:
            continue
        buckets[_day_of(row, tz)].append(sample)
    return buckets


def _points(buckets: dict[str, list[float]], spec: MetricSpec) -> list[TrendPoint]:
    points: list[TrendPoint] = []
    for day, values in sorted(buckets.items()):
        if not values:
            continue
        points.append(TrendPoint(day=day, value=reduce_values(values, spec.aggregation), n=len(values)))
    return points


@router.get("/metrics", response_model=list[MetricInfo])
async def list_metrics() -> list[MetricInfo]:
    return [
        MetricInfo(
            key=spec.key,
            unit=spec.unit,
            scale_min=spec.scale_min,
            scale_max=spec.scale_max,
            aggregation=spec.aggregation,
            required_filters=list(spec.required_filters),
            missing=spec.missing,
            description=spec.description,
        )
        for spec in METRICS.values()
    ]


@router.get("/trends", response_model=TrendSeries)
async def get_trends(
    metric: Annotated[str, Query(description="Open metric column name")],
    period: Annotated[str, Query(pattern="^(7d|30d|90d|1y)$")] = "30d",
    habit_id: UUID | None = None,
    skill_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TrendSeries:
    spec = _require_metric(metric)
    _require_filters(spec, habit_id)
    days = period_length(period)
    tz = _account_tz(current_user)
    rows = await _load_rows(
        db,
        current_user,
        _since_utc(period),
        habit_id=habit_id,
        skill_id=skill_id,
    )
    points = _points(_bucket(rows, spec, tz), spec)
    observations = sum(point.n for point in points)
    return TrendSeries(
        period=period,
        period_days=days,
        metric=metric,
        aggregation=spec.aggregation,
        unit=spec.unit,
        scale_min=spec.scale_min,
        scale_max=spec.scale_max,
        habit_id=habit_id,
        skill_id=skill_id,
        observations=observations,
        days_with_data=len(points),
        coverage=coverage(len(points), days),
        insufficient=observations == 0,
        points=points,
    )


@router.get("/correlations", response_model=CorrelationSeries)
async def get_correlations(
    x: Annotated[str, Query(description="First metric (same names as /trends)")],
    y: Annotated[str, Query(description="Second metric")],
    period: Annotated[str, Query(pattern="^(7d|30d|90d|1y)$")] = "30d",
    lag_days: Annotated[int, Query(ge=0, le=MAX_LAG_DAYS)] = 0,
    habit_id: UUID | None = None,
    skill_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CorrelationSeries:
    x_spec = _require_metric(x)
    y_spec = _require_metric(y)
    if x == y and lag_days == 0:
        raise HTTPException(status_code=400, detail="x and y must differ")
    _require_filters(x_spec, habit_id)
    _require_filters(y_spec, habit_id)

    days = period_length(period)
    tz = _account_tz(current_user)
    rows = await _load_rows(
        db,
        current_user,
        _since_utc(period),
        habit_id=habit_id,
        skill_id=skill_id,
    )
    xs = _points(_bucket(rows, x_spec, tz), x_spec)
    ys = _points(_bucket(rows, y_spec, tz), y_spec)
    y_by_day = {point.day: point for point in ys}
    paired: list[CorrelationPoint] = []
    for xp in xs:
        yp = y_by_day.get(shift_civil_day(xp.day, lag_days))
        if yp is None:
            continue
        paired.append(
            CorrelationPoint(day=xp.day, x=xp.value, y=yp.value, n_x=xp.n, n_y=yp.n)
        )
    insufficient = len(paired) < MIN_JOINT_DAYS
    return CorrelationSeries(
        period=period,
        period_days=days,
        x=x,
        y=y,
        lag_days=lag_days,
        x_aggregation=x_spec.aggregation,
        y_aggregation=y_spec.aggregation,
        observations=len(paired),
        days_with_data=len(paired),
        coverage=coverage(len(paired), days),
        insufficient=insufficient,
        points=[] if insufficient else paired,
    )
