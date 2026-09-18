"""
Aggregated analytics on **open** numeric fields only.
The server never touches ciphertext.
Days are account-local (IANA), not UTC date_trunc.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Entry, User
from app.services.calendar_days import DEFAULT_TIMEZONE, entry_calendar_day

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

PERIOD_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}

TREND_METRICS: dict[str, Any] = {
    "mood_score": Entry.mood_score,
    "energy_score": Entry.energy_score,
    "anxiety_score": Entry.anxiety_score,
    "focus_score": Entry.focus_score,
    "social_battery_score": Entry.social_battery_score,
    "stress_score": Entry.stress_score,
    "sleep_hours": Entry.sleep_hours,
    "sleep_quality": Entry.sleep_quality,
    "weight_kg": Entry.weight_kg,
    "body_fat_pct": Entry.body_fat_pct,
    "session_duration_min": Entry.session_duration_min,
    "habit_value": Entry.habit_value,
    "resentment_score": Entry.resentment_score,
    "guilt_score": Entry.guilt_score,
    "shame_score": Entry.shame_score,
    "fear_score": Entry.fear_score,
}


class TrendPoint(BaseModel):
    day: str = Field(description="Account-local calendar day YYYY-MM-DD")
    value: float


class CorrelationPoint(BaseModel):
    day: str
    x: float
    y: float


def _since_utc(period: str) -> datetime:
    days = PERIOD_DAYS.get(period, 30)
    return datetime.now(UTC) - timedelta(days=days)


def _account_tz(user: User) -> str:
    return getattr(user, "timezone", None) or DEFAULT_TIMEZONE


def _day_of(row: Entry, tz: str) -> str:
    return entry_calendar_day(
        timestamp=row.timestamp,
        entry_type=str(row.entry_type),
        sleep_hours=row.sleep_hours,
        time_zone=row.event_timezone or tz,
    )


@router.get("/trends", response_model=list[TrendPoint])
async def get_trends(
    metric: Annotated[str, Query(description="Open metric column name")],
    period: Annotated[str, Query(pattern="^(7d|30d|90d|1y)$")] = "30d",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TrendPoint]:
    if metric not in TREND_METRICS:
        raise HTTPException(status_code=400, detail=f"Unknown metric: {metric}")
    col = TREND_METRICS[metric]
    since = _since_utc(period)
    tz = _account_tz(current_user)
    stmt = select(Entry).where(
        Entry.user_id == current_user.id,
        Entry.deleted_at.is_(None),
        Entry.timestamp >= since,
        col.isnot(None),
    )
    rows = (await db.execute(stmt)).scalars().all()
    buckets: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        value = getattr(row, metric)
        if value is None:
            continue
        buckets[_day_of(row, tz)].append(float(value))
    return [
        TrendPoint(day=day, value=sum(vals) / len(vals))
        for day, vals in sorted(buckets.items())
        if vals
    ]


@router.get("/correlations", response_model=list[CorrelationPoint])
async def get_correlations(
    x: Annotated[str, Query(description="First metric (same names as /trends)")],
    y: Annotated[str, Query(description="Second metric")],
    period: Annotated[str, Query(pattern="^(7d|30d|90d|1y)$")] = "30d",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CorrelationPoint]:
    if x not in TREND_METRICS or y not in TREND_METRICS:
        raise HTTPException(status_code=400, detail="Unknown metric in x or y")
    if x == y:
        raise HTTPException(status_code=400, detail="x and y must differ")

    since = _since_utc(period)
    tz = _account_tz(current_user)
    stmt = select(Entry).where(
        Entry.user_id == current_user.id,
        Entry.deleted_at.is_(None),
        Entry.timestamp >= since,
    )
    rows = (await db.execute(stmt)).scalars().all()
    xs: dict[str, list[float]] = defaultdict(list)
    ys: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        day = _day_of(row, tz)
        xv = getattr(row, x)
        yv = getattr(row, y)
        if xv is not None:
            xs[day].append(float(xv))
        if yv is not None:
            ys[day].append(float(yv))
    joint = sorted(set(xs) & set(ys))
    return [
        CorrelationPoint(day=day, x=sum(xs[day]) / len(xs[day]), y=sum(ys[day]) / len(ys[day]))
        for day in joint
    ]
