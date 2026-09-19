from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable

LoginKey = tuple[str, str]


class LoginThrottle:
    """Process-local fixed-window limiter for failed login attempts."""

    def __init__(
        self,
        *,
        max_failures: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._clock = clock
        self._failures: dict[LoginKey, deque[float]] = {}

    def _active(self, key: LoginKey) -> deque[float]:
        now = self._clock()
        attempts = self._failures.setdefault(key, deque())
        cutoff = now - self.window_seconds
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if not attempts:
            self._failures.pop(key, None)
        return attempts

    def retry_after(self, key: LoginKey) -> int | None:
        attempts = self._active(key)
        if len(attempts) < self.max_failures:
            return None
        remaining = attempts[0] + self.window_seconds - self._clock()
        return max(1, math.ceil(remaining))

    def record_failure(self, key: LoginKey) -> None:
        attempts = self._active(key)
        attempts.append(self._clock())
        self._failures[key] = attempts

    def reset(self, key: LoginKey) -> None:
        self._failures.pop(key, None)
