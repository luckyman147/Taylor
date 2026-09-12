"""Metric protocol and auto-discovering registry."""

from __future__ import annotations

import importlib
import pkgutil
from typing import Protocol, runtime_checkable

from eval.sample import EvalSample, EvalTrace, MetricResult


@runtime_checkable
class Metric(Protocol):
    """Any metric must implement this interface."""

    name: str

    async def evaluate(self, sample: EvalSample, trace: EvalTrace) -> MetricResult: ...


class MetricRegistry:
    """Auto-discovers and registers all Metric implementations in eval/metrics/."""

    def __init__(self) -> None:
        self._metrics: dict[str, Metric] = {}

    def register(self, metric: Metric) -> None:
        self._metrics[metric.name] = metric

    def get(self, name: str) -> Metric | None:
        return self._metrics.get(name)

    def list_all(self) -> list[Metric]:
        return list(self._metrics.values())

    def list_names(self) -> list[str]:
        return list(self._metrics.keys())

    def auto_discover(self) -> int:
        """Import all modules in eval/metrics/ and register Metric instances.

        Returns the number of metrics discovered.
        """
        import eval.metrics as metrics_pkg

        package_path = getattr(metrics_pkg, "__path__", None)
        if not package_path:
            return 0

        count = 0
        for importer, module_name, is_pkg in pkgutil.iter_modules(package_path):
            if is_pkg or module_name.startswith("_"):
                continue
            try:
                module = importlib.import_module(f"eval.metrics.{module_name}")
            except Exception:
                continue

            for attr_name in dir(module):
                obj = getattr(module, attr_name)
                if (
                    isinstance(obj, Metric)
                    and hasattr(obj, "name")
                    and obj.name not in self._metrics
                ):
                    self.register(obj)
                    count += 1

        return count


# Global registry
registry = MetricRegistry()
