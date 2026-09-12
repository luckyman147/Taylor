"""Agent Budget — enforces execution limits.

Tracks tokens, cost, time, iterations, and tool calls against configured limits.
"""

import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class BudgetConfig:
    """Execution budget limits."""
    max_iterations: int = 3
    max_tool_calls: int = 10
    max_execution_time_ms: float = 30000  # 30 seconds
    max_parallel_tools: int = 5
    max_cost_usd: float = 0.05
    max_context_tokens: int = 20000


class ExecutionBudget:
    """Tracks and enforces execution budget."""

    def __init__(self, config: BudgetConfig | None = None) -> None:
        self.config = config or BudgetConfig()
        self._start_time: float | None = None

    def start(self) -> None:
        """Start the budget timer."""
        self._start_time = time.monotonic()

    def check_iteration(self, current: int) -> bool:
        """Check if another iteration is allowed."""
        return current < self.config.max_iterations

    def check_tool_calls(self, current: int) -> bool:
        """Check if another tool call is allowed."""
        return current < self.config.max_tool_calls

    def check_time(self) -> bool:
        """Check if we're still within the time budget."""
        if self._start_time is None:
            return True
        elapsed_ms = (time.monotonic() - self._start_time) * 1000
        return elapsed_ms < self.config.max_execution_time_ms

    def check_tokens(self, current: int) -> bool:
        """Check if we're still within the token budget."""
        return current < self.config.max_context_tokens

    def check_cost(self, current: float) -> bool:
        """Check if we're still within the cost budget."""
        return current < self.config.max_cost_usd

    def check_all(
        self,
        iteration: int,
        tool_calls: int,
        tokens: int,
        cost: float,
    ) -> tuple[bool, str | None]:
        """Check all budget constraints. Returns (ok, reason)."""
        if not self.check_iteration(iteration):
            return False, f"Max iterations ({self.config.max_iterations}) reached"
        if not self.check_tool_calls(tool_calls):
            return False, f"Max tool calls ({self.config.max_tool_calls}) reached"
        if not self.check_time():
            return False, f"Max execution time ({self.config.max_execution_time_ms}ms) reached"
        if not self.check_tokens(tokens):
            return False, f"Max context tokens ({self.config.max_context_tokens}) reached"
        if not self.check_cost(cost):
            return False, f"Max cost (${self.config.max_cost_usd}) reached"
        return True, None

    def elapsed_ms(self) -> float:
        """Get elapsed time in milliseconds."""
        if self._start_time is None:
            return 0.0
        return (time.monotonic() - self._start_time) * 1000

    def remaining_time_ms(self) -> float:
        """Get remaining time budget in milliseconds."""
        if self._start_time is None:
            return self.config.max_execution_time_ms
        elapsed = (time.monotonic() - self._start_time) * 1000
        return max(0.0, self.config.max_execution_time_ms - elapsed)


budget = ExecutionBudget()
