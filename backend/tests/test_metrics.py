from app.services.metrics import (
    METRICS,
    MIN_JOINT_DAYS,
    coverage,
    get_metric,
    normalize_sample,
    reduce_values,
    shift_civil_day,
)


def test_catalog_defines_scale_and_aggregation():
    mood = get_metric("mood_score")
    assert mood is not None
    assert mood.unit == "score"
    assert mood.scale_min == 1
    assert mood.scale_max == 10
    assert mood.aggregation == "avg"
    assert mood.missing == "skip"

    minutes = get_metric("session_duration_min")
    assert minutes is not None
    assert minutes.aggregation == "sum"
    assert minutes.unit == "min"

    habit = get_metric("habit_value")
    assert habit is not None
    assert habit.required_filters == ("habit_id",)


def test_sum_sessions_avg_mood():
    assert reduce_values([20, 10], "sum") == 30
    assert reduce_values([6, 8], "avg") == 7


def test_missing_is_skipped():
    spec = METRICS["mood_score"]
    assert normalize_sample(None, spec) is None
    assert normalize_sample(7, spec) == 7
    assert normalize_sample(True, spec) is None


def test_habit_completed_is_a_rate():
    spec = METRICS["habit_completed"]
    assert normalize_sample(True, spec) == 1.0
    assert normalize_sample(False, spec) == 0.0
    assert normalize_sample(None, spec) is None


def test_coverage_and_lag_shift():
    assert coverage(6, 30) == 0.2
    assert shift_civil_day("2026-09-18", 1) == "2026-09-19"
    assert MIN_JOINT_DAYS == 3
