"""Runner protocol for eval."""

from typing import Protocol

from eval.config import EvalConfig
from eval.sample import EvalSample, EvalTrace


class Runner(Protocol):
    """Any eval runner must implement this interface."""

    async def run(self, sample: EvalSample, config: EvalConfig) -> EvalTrace: ...
