"""
Aggregated analytics on **open** numeric fields only.
The server never touches ciphertext.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Entry, User

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

PERIOD_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}

TREND_METRICS: dict[str, object] = {
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
    day: str = Field(description="UTC calendar day (YYYY-MM-DD) from date_trunc")
    value: float


class CorrelationPoint(BaseModel):
    day: str
    x: float
    y: float


def _since_utc(period: str) -> datetime:
    days = PERIOD_DAYS.get(period, 30)
    return datetime.now(UTC) - timedelta(days=days)


def _bucket_day(row_ts: datetime) -> str:
    """Normalize SQLAlchemy / asyncpg timestamp to YYYY-MM-DD (UTC)."""
    if row_ts.tzinfo is None:
        row_ts = row_ts.replace(tzinfo=UTC)
    return row_ts.astimezone(UTC).date().isoformat()


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
    bucket = func.date_trunc("day", Entry.timestamp).label("bucket")

    stmt = (
        select(bucket, func.avg(col).label("avg_val"))
        .where(
            Entry.user_id == current_user.id,
            Entry.deleted_at.is_(None),
            Entry.timestamp >= since,
            col.isnot(None),
        )
        .group_by(bucket)
        .order_by(bucket)
    )
    result = await db.execute(stmt)
    out: list[TrendPoint] = []
    for b, avg_val in result.all():
        if b is None or avg_val is None:
            continue
        out.append(TrendPoint(day=_bucket_day(b), value=float(avg_val)))
    return out


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

    xcol = TREND_METRICS[x]
    ycol = TREND_METRICS[y]
    since = _since_utc(period)

    bx = func.date_trunc("day", Entry.timestamp).label("d")
    sub_x = (
        select(bx, func.avg(xcol).label("xv"))
        .where(
            Entry.user_id == current_user.id,
            Entry.deleted_at.is_(None),
            Entry.timestamp >= since,
            xcol.isnot(None),
        )
        .group_by(bx)
    ).subquery()

    by = func.date_trunc("day", Entry.timestamp).label("d")
    sub_y = (
        select(by, func.avg(ycol).label("yv"))
        .where(
            Entry.user_id == current_user.id,
            Entry.deleted_at.is_(None),
            Entry.timestamp >= since,
            ycol.isnot(None),
        )
        .group_by(by)
    ).subquery()

    stmt = (
        select(sub_x.c.d, sub_x.c.xv, sub_y.c.yv)
        .select_from(sub_x.join(sub_y, sub_x.c.d == sub_y.c.d))
        .order_by(sub_x.c.d)
    )
    result = await db.execute(stmt)
    return [
        CorrelationPoint(day=_bucket_day(d), x=float(xv), y=float(yv))
        for d, xv, yv in result.all()
        if d is not None and xv is not None and yv is not None
    ]
