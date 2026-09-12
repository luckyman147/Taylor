"""Benchmark runner — orchestrates eval runs over a dataset."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from eval.config import EvalConfig
from eval.failures.mock_mcp import MockMCP
from eval.metrics.base import registry
from eval.sample import EvalReport, EvalSample, EvalTrace

logger = logging.getLogger(__name__)


def load_samples(path: str) -> list[EvalSample]:
    """Load eval samples from a JSONL file."""
    samples: list[EvalSample] = []
    file_path = Path(path)
    if not file_path.exists():
        logger.warning("Dataset not found: %s", path)
        return samples
    with open(file_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            samples.append(EvalSample.from_dict(data))
    return samples


class BenchmarkRunner:
    """Runs samples through runners and evaluates with metrics."""

    async def run_single(
        self,
        sample: EvalSample,
        runner: Any,
        config: EvalConfig,
        mock_mcp: MockMCP | None = None,
    ) -> EvalTrace:
        """Run a single sample and return the trace."""
        return await runner.run(sample, config)

    async def run_dataset(
        self,
        samples: list[EvalSample],
        runner: Any,
        config: EvalConfig,
        mock_mcp: MockMCP | None = None,
        on_progress: Any = None,
    ) -> list[EvalTrace]:
        """Run all samples and collect traces."""
        traces: list[EvalTrace] = []
        total = len(samples)
        for i, sample in enumerate(samples):
            if on_progress:
                on_progress(i + 1, total, sample.id)
            try:
                trace = await self.run_single(sample, runner, config, mock_mcp)
                traces.append(trace)
            except Exception as e:
                logger.error("Failed sample %s: %s", sample.id, e)
        return traces

    async def evaluate(
        self,
        samples: list[EvalSample],
        traces: list[EvalTrace],
    ) -> list[dict[str, Any]]:
        """Run all registered metrics against traces."""
        metrics = registry.list_all()
        results: list[dict[str, Any]] = []

        for metric in metrics:
            metric_results = []
            for sample, trace in zip(samples, traces):
                if sample.id != trace.sample_id:
                    # Match by index if IDs don't align
                    pass
                try:
                    result = await metric.evaluate(sample, trace)
                    metric_results.append(result)
                except Exception as e:
                    logger.error("Metric %s failed on %s: %s", metric.name, sample.id, e)

            if metric_results:
                avg_value = sum(r.value for r in metric_results if r.value != float("inf")) / max(1, len([r for r in metric_results if r.value != float("inf")]))
                passed_count = sum(1 for r in metric_results if r.passed is True)
                total_count = sum(1 for r in metric_results if r.passed is not None)
                results.append({
                    "metric": metric.name,
                    "value": avg_value,
                    "pass_rate": passed_count / total_count if total_count > 0 else 0.0,
                    "samples": len(metric_results),
                })

        return results

    async def run_benchmark(
        self,
        config: EvalConfig,
        mode: str = "autonomous",
    ) -> dict[str, Any]:
        """Full benchmark: load dataset, run, evaluate, report."""
        from eval.runners.agent_runner import agent_runner_eval
        from eval.runners.baseline_runner import baseline_runner

        runner = agent_runner_eval if mode == "autonomous" else baseline_runner
        samples = load_samples(config.dataset_path)
        if not samples:
            return {"error": "No samples loaded", "metrics": []}

        start = time.monotonic()
        traces = await self.run_dataset(samples, runner, config)
        metric_results = await self.evaluate(samples, traces)
        elapsed = time.monotonic() - start

        return {
            "mode": mode,
            "dataset": config.dataset_path,
            "samples_total": len(samples),
            "traces_collected": len(traces),
            "elapsed_seconds": round(elapsed, 2),
            "config": config.to_dict(),
            "metrics": metric_results,
            "traces": [t.to_dict() for t in traces[:5]],  # First 5 for inspection
        }


benchmark_runner = BenchmarkRunner()
