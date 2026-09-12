"""Eval configuration — reproducibility settings."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class EvalConfig:
    """Evaluation run configuration.

    Every field is designed to make results reproducible.
    """

    # Reproducibility
    seed: int = 42
    temperature: float = 0.0
    model: str | None = None  # Override LLM model for eval
    model_version: str = "v1.0"
    prompt_version: str = "v1.0"
    tool_registry_version: str = "v1.0"
    dataset_version: str = "v1.0"
    evaluation_version: str = "v1.0"

    # Mode
    eval_mode: str = "both"  # "baseline" | "autonomous" | "both"

    # Budget (mirrors production)
    max_iterations: int = 3
    max_tool_calls: int = 10
    max_execution_time_ms: float = 30000
    max_cost_usd: float = 0.05

    # Paths
    dataset_path: str = "eval/datasets/benchmark.jsonl"
    failure_dataset_path: str = "eval/datasets/failure_injection.jsonl"
    results_dir: str = "eval/results"

    def to_dict(self) -> dict:
        """Serialize config for JSON output."""
        return {
            "seed": self.seed,
            "temperature": self.temperature,
            "model": self.model,
            "model_version": self.model_version,
            "prompt_version": self.prompt_version,
            "tool_registry_version": self.tool_registry_version,
            "dataset_version": self.dataset_version,
            "evaluation_version": self.evaluation_version,
            "eval_mode": self.eval_mode,
            "max_iterations": self.max_iterations,
            "max_tool_calls": self.max_tool_calls,
            "max_execution_time_ms": self.max_execution_time_ms,
            "max_cost_usd": self.max_cost_usd,
        }
