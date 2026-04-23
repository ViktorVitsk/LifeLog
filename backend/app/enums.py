from enum import StrEnum


class EntryType(StrEnum):
    DAILY_CHECKIN = "DAILY_CHECKIN"
    EMOTIONAL_STATE = "EMOTIONAL_STATE"
    GRATITUDE = "GRATITUDE"
    SKILL_SESSION = "SKILL_SESSION"
    HABIT_LOG = "HABIT_LOG"
    SLEEP = "SLEEP"
    MEAL = "MEAL"
    SUPPLEMENT = "SUPPLEMENT"
    BODY_METRICS = "BODY_METRICS"
    THOUGHT = "THOUGHT"
    GOAL_UPDATE = "GOAL_UPDATE"
    BELIEF = "BELIEF"


class HabitFrequency(StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
