from app.services.schema_guard import classify_value, precheck_rows, RANGES


def test_scores_are_one_to_ten():
    assert RANGES["mood_score"] == (1, 10)
    assert classify_value("mood_score", 0) == "out_of_range"
    assert classify_value("mood_score", 11) == "out_of_range"
    assert classify_value("mood_score", 7) is None
    assert classify_value("mood_score", None) is None


def test_precheck_does_not_rewrite():
    rows = [
        {"id": "ok", "mood_score": 5},
        {"id": "bad", "mood_score": 0, "sleep_hours": 30},
    ]
    report = precheck_rows(rows)
    assert rows[1]["mood_score"] == 0
    assert report == [{"id": "bad", "fields": ["mood_score", "sleep_hours"]}]
