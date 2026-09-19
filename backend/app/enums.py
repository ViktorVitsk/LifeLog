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


class GoalState(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    DROPPED = "dropped"


class MemoryKind(StrEnum):
    PREFERENCE = "preference"
    CONTEXT = "context"
    OBSERVED_PATTERN = "observed_pattern"
    HYPOTHESIS = "hypothesis"


class MemoryState(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    DISPUTED = "disputed"
    STALE = "stale"


class MemoryOrigin(StrEnum):
    USER = "user"
    AGENT = "agent"
    IMPORT = "import"


class ActionState(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    ACTIVE = "active"
    COMPLETED = "completed"
    STOPPED = "stopped"


class FeedbackOutcome(StrEnum):
    NOT_TRIED = "not_tried"
    NOT_SUITABLE = "not_suitable"
    TRIED_NO_EFFECT = "tried_no_effect"
    TRIED_HELPED = "tried_helped"
    TRIED_HURT = "tried_hurt"
    UNEVALUATED = "unevaluated"
    OTHER = "other"
