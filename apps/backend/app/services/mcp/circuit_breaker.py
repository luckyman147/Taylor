"""Circuit breaker pattern for MCP resilience."""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open."""


class CircuitBreaker:
    """Circuit breaker: CLOSED (normal) -> OPEN (failing) -> HALF_OPEN (testing).

    After *failure_threshold* consecutive failures the circuit opens and
    rejects calls for *recovery_timeout* seconds, then transitions to
    HALF_OPEN to allow a single probe request.
    """

    def __init__(
        self,
        name: str = "default",
        failure_threshold: int = 3,
        recovery_timeout: float = 300.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count: int = 0
        self.state: str = "CLOSED"
        self.last_failure_time: float | None = None

    def _now(self) -> float:
        return time.time()

    async def call(self, func, *args, **kwargs):  # type: ignore[no-untyped-def]
        """Execute *func* through the circuit breaker."""
        if self.state == "OPEN":
            if (
                self.last_failure_time is not None
                and self._now() - self.last_failure_time > self.recovery_timeout
            ):
                self.state = "HALF_OPEN"
                logger.info("Circuit %s: OPEN -> HALF_OPEN", self.name)
            else:
                raise CircuitOpenError(
                    f"Circuit '{self.name}' is OPEN; retry in "
                    f"{self.recovery_timeout}s"
                )

        try:
            result = await func(*args, **kwargs)
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"
                self.failure_count = 0
                logger.info("Circuit %s: HALF_OPEN -> CLOSED", self.name)
            return result
        except CircuitOpenError:
            raise
        except Exception:
            self.failure_count += 1
            self.last_failure_time = self._now()
            if self.failure_count >= self.failure_threshold:
                self.state = "OPEN"
                logger.warning(
                    "Circuit %s: OPEN after %d failures",
                    self.name,
                    self.failure_count,
                )
            raise

    def reset(self) -> None:
        """Manually reset the circuit to CLOSED."""
        self.failure_count = 0
        self.state = "CLOSED"
        self.last_failure_time = None
