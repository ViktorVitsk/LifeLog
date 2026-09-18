from datetime import UTC, datetime

from app.services.calendar_days import (
    calendar_day,
    entry_calendar_day,
    start_of_day,
    yesterday_evening,
)


def test_moscow_rolls_date_before_utc_midnight():
    instant = datetime(2026, 9, 18, 22, 0, tzinfo=UTC)
    assert calendar_day(instant, "Europe/Moscow") == "2026-09-19"
    assert calendar_day(instant, "UTC") == "2026-09-18"


def test_sleep_uses_wake_day_not_bedtime():
    wake = datetime(2026, 9, 19, 4, 0, tzinfo=UTC)  # 07:00 Moscow
    day = entry_calendar_day(
        timestamp=wake,
        entry_type="SLEEP",
        sleep_hours=8,
        time_zone="Europe/Moscow",
    )
    assert day == "2026-09-19"
    bedtime_local_day = calendar_day(datetime(2026, 9, 18, 20, 0, tzinfo=UTC), "Europe/Moscow")
    assert bedtime_local_day == "2026-09-18"
    assert day != bedtime_local_day


def test_yesterday_evening_is_not_now():
    now = datetime(2026, 9, 19, 10, 30, tzinfo=UTC)
    event = yesterday_evening(now, "Europe/Moscow")
    assert calendar_day(event, "Europe/Moscow") == "2026-09-18"
    assert event.hour == 17  # 20:00 Moscow in September is UTC+3
    assert event != now


def test_start_of_day_matches_calendar_key():
    start = start_of_day("2026-09-19", "Europe/Moscow")
    assert calendar_day(start, "Europe/Moscow") == "2026-09-19"
