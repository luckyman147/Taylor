"""TAYLOR Evaluation CLI.

Usage:
    python -m eval.run --dataset eval/datasets/benchmark.jsonl --mode autonomous
    python -m eval.run --dataset eval/datasets/benchmark.jsonl --mode both
    python -m eval.run --query "Find backend jobs in Germany" --mode autonomous
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="TAYLOR Evaluation Framework")
    parser.add_argument("--dataset", type=str, default=None, help="Path to JSONL dataset")
    parser.add_argument("--query", type=str, default=None, help="Single query to evaluate")
    parser.add_argument("--mode", type=str, default="autonomous", choices=["baseline", "autonomous", "both"])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=str, default=None, help="Output JSON path")
    args = parser.parse_args()

    asyncio.run(_run(args))


async def _run(args: argparse.Namespace) -> None:
    from eval.config import EvalConfig
    from eval.metrics.base import registry
    from eval.reports.scorecard import Scorecard
    from eval.sample import EvalReport

    # Discover metrics
    count = registry.auto_discover()
    print(f"Discovered {count} metrics: {registry.list_names()}")

    config = EvalConfig(seed=args.seed, eval_mode=args.mode)

    if args.query:
        # Single query mode
        await _run_single_query(args.query, config)
    elif args.dataset:
        # Dataset mode
        await _run_dataset(args.dataset, config, args.output)
    else:
        print("Provide --dataset or --query")
        sys.exit(1)


async def _run_single_query(query: str, config: EvalConfig) -> None:
    from eval.sample import EvalSample
    from eval.runners.agent_runner import agent_runner_eval
    from eval.runners.baseline_runner import baseline_runner

    sample = EvalSample(id="cli", query=query)

    if config.eval_mode in ("autonomous", "both"):
        runner = agent_runner_eval
        trace = await runner.run(sample, config)
        print(f"\n[autonomous] {trace.latency_ms:.0f}ms, success={trace.success}")
        print(f"  Answer: {trace.final_answer[:200]}...")
        print(f"  Tools: {[tc.tool_name for tc in trace.tool_calls]}")

    if config.eval_mode in ("baseline", "both"):
        runner = baseline_runner
        trace = await runner.run(sample, config)
        print(f"\n[baseline] {trace.latency_ms:.0f}ms, success={trace.success}")
        print(f"  Answer: {trace.final_answer[:200]}...")
        print(f"  Tools: {[tc.tool_name for tc in trace.tool_calls]}")


async def _run_dataset(dataset_path: str, config: EvalConfig, output_path: str | None) -> None:
    from eval.runners.benchmark_runner import benchmark_runner, load_samples
    from eval.reports.scorecard import Scorecard
    from eval.sample import EvalReport

    samples = load_samples(dataset_path)
    if not samples:
        print(f"No samples found in {dataset_path}")
        sys.exit(1)

    print(f"Running {len(samples)} samples in {config.eval_mode} mode...")

    modes = ["baseline", "autonomous"] if config.eval_mode == "both" else [config.eval_mode]

    for mode in modes:
        print(f"\n{'='*50}")
        print(f"Mode: {mode}")
        print(f"{'='*50}")

        result = await benchmark_runner.run_benchmark(config, mode=mode)

        # Print summary
        for m in result.get("metrics", []):
            icon = "✓" if m.get("pass_rate", 0) >= 0.7 else "✗"
            print(f"  {icon} {m['metric']:30s} {m['value']:.4f}  (pass: {m['pass_rate']:.0%})")

        # Save results
        out = Path(output_path) if output_path else Path(config.results_dir) / f"run_{mode}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w") as f:
            json.dump(result, f, indent=2, default=str)
        print(f"\nResults saved to {out}")


if __name__ == "__main__":
    main()
