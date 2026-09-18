"""Account-local calendar days. Instants stay UTC; days use an IANA zone."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "UTC"


def validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, KeyError) as exc:
        raise ValueError("invalid_timezone") from exc
    return name


def calendar_day(instant: datetime, time_zone: str) -> str:
    if instant.tzinfo is None:
        raise ValueError("naive_timestamp")
    zone = ZoneInfo(validate_timezone(time_zone))
    return instant.astimezone(zone).date().isoformat()


def start_of_day(day: str, time_zone: str) -> datetime:
    year, month, day_n = (int(part) for part in day.split("-"))
    zone = ZoneInfo(validate_timezone(time_zone))
    return datetime(year, month, day_n, tzinfo=zone).astimezone(UTC)


def entry_calendar_day(
    *,
    timestamp: datetime,
    entry_type: str,
    sleep_hours: float | None,
    time_zone: str,
) -> str:
    """
    Sleep that crosses midnight belongs to the local day of wake.
    `timestamp` for SLEEP is the wake / end of the night, not bedtime.
    sleep_hours is only used to describe the night, not to pick the day.
    """
    del sleep_hours
    if entry_type == "SLEEP":
        return calendar_day(timestamp, time_zone)
    return calendar_day(timestamp, time_zone)


def yesterday_evening(now: datetime, time_zone: str) -> datetime:
    """Bind «вчера вечером» to 20:00 yesterday in the account zone — not to now()."""
    if now.tzinfo is None:
        raise ValueError("naive_timestamp")
    zone = ZoneInfo(validate_timezone(time_zone))
    local = now.astimezone(zone)
    yesterday = local.date() - timedelta(days=1)
    return datetime.combine(yesterday, time(20, 0), tzinfo=zone).astimezone(UTC)
