"""Eval metrics package — auto-discovers all Metric implementations."""

from eval.metrics.base import registry

# Auto-discover on import
registry.auto_discover()

__all__ = ["registry"]
