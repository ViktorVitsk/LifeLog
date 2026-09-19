from app.services.login_throttle import LoginThrottle


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_blocks_after_failure_limit_within_window():
    clock = Clock()
    limiter = LoginThrottle(max_failures=3, window_seconds=60, clock=clock)
    key = ("127.0.0.1", "owner")

    assert limiter.retry_after(key) is None
    limiter.record_failure(key)
    limiter.record_failure(key)
    limiter.record_failure(key)

    assert limiter.retry_after(key) == 60


def test_success_reset_clears_failure_counter():
    clock = Clock()
    limiter = LoginThrottle(max_failures=2, window_seconds=60, clock=clock)
    key = ("127.0.0.1", "owner")

    limiter.record_failure(key)
    limiter.reset(key)
    limiter.record_failure(key)

    assert limiter.retry_after(key) is None


def test_expired_failures_do_not_count():
    clock = Clock()
    limiter = LoginThrottle(max_failures=2, window_seconds=60, clock=clock)
    key = ("127.0.0.1", "owner")

    limiter.record_failure(key)
    limiter.record_failure(key)
    clock.now = 61

    assert limiter.retry_after(key) is None
