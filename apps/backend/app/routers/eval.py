"""Eval API endpoint — serves eval metrics to the chat page."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/eval", tags=["Eval"])


class EvalRunRequest(BaseModel):
    query: str
    mode: str = "autonomous"  # "baseline" | "autonomous" | "both"
    sample_id: str | None = None


class EvalQuickRequest(BaseModel):
    """Quick eval: run a single query through both modes and compare."""
    query: str
    sample_id: str | None = None


@router.post("/run")
async def run_eval(request: EvalRunRequest) -> dict:
    """Run a single eval sample and return the trace + metrics."""
    from eval.config import EvalConfig
    from eval.sample import EvalSample
    from eval.runners.agent_runner import agent_runner_eval
    from eval.runners.baseline_runner import baseline_runner
    from eval.metrics.base import registry

    config = EvalConfig()
    sample = EvalSample(
        id=request.sample_id or "manual",
        query=request.query,
        required_evidence=[],
    )

    runner = agent_runner_eval if request.mode == "autonomous" else baseline_runner
    trace = await runner.run(sample, config)

    # Evaluate with all metrics
    metric_results = []
    metrics = registry.list_all()
    for metric in metrics:
        try:
            result = await metric.evaluate(sample, trace)
            metric_results.append(result.to_dict())
        except Exception as e:
            metric_results.append({"metric_name": metric.name, "value": 0.0, "error": str(e)})

    return {
        "trace": trace.to_dict(),
        "metrics": metric_results,
        "mode": request.mode,
    }


@router.post("/compare")
async def compare_eval(request: EvalQuickRequest) -> dict:
    """Run a query through both baseline and autonomous, return comparison."""
    from eval.config import EvalConfig
    from eval.sample import EvalSample
    from eval.runners.agent_runner import agent_runner_eval
    from eval.runners.baseline_runner import baseline_runner
    from eval.metrics.base import registry

    config = EvalConfig()
    sample = EvalSample(
        id=request.sample_id or "compare",
        query=request.query,
        required_evidence=[],
    )

    # Run both modes
    baseline_trace = await baseline_runner.run(sample, config)
    agent_trace = await agent_runner_eval.run(sample, config)

    # Evaluate both
    metrics = registry.list_all()
    baseline_metrics = []
    agent_metrics = []
    for metric in metrics:
        try:
            b_result = await metric.evaluate(sample, baseline_trace)
            a_result = await metric.evaluate(sample, agent_trace)
            baseline_metrics.append(b_result.to_dict())
            agent_metrics.append(a_result.to_dict())
        except Exception:
            pass

    return {
        "query": request.query,
        "baseline": {
            "trace": baseline_trace.to_dict(),
            "metrics": baseline_metrics,
        },
        "autonomous": {
            "trace": agent_trace.to_dict(),
            "metrics": agent_metrics,
        },
    }


@router.get("/metrics")
async def list_metrics() -> list[dict]:
    """List all registered eval metrics."""
    from eval.metrics.base import registry
    return [{"name": m.name} for m in registry.list_all()]


@router.get("/health")
async def eval_health() -> dict:
    """Check eval framework health."""
    from eval.metrics.base import registry
    count = registry.auto_discover()
    return {
        "status": "ok",
        "metrics_registered": len(registry.list_all()),
        "metric_names": registry.list_names(),
    }


# ---------------------------------------------------------------------------
# Results dashboard endpoints (temporary, reads JSON files from eval/results/)
# ---------------------------------------------------------------------------

import json
import os
import re
from pathlib import Path

_RESULTS_DIR = Path(__file__).resolve().parent.parent.parent / "eval" / "results"
_FILENAME_RE = re.compile(r"^run_[a-zA-Z0-9_-]+\.json$")


@router.get("/results")
async def list_results() -> list[dict]:
    """List all eval result files with summary metrics."""
    if not _RESULTS_DIR.exists():
        return []

    results = []
    for f in sorted(_RESULTS_DIR.glob("run_*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not _FILENAME_RE.match(f.name):
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            # Extract top-level metrics into a flat dict
            metrics_flat = {}
            for m in data.get("metrics", []):
                name = m.get("metric", "")
                value = m.get("value")
                pass_rate = m.get("pass_rate")
                if name and value is not None:
                    metrics_flat[name] = {"value": value, "pass_rate": pass_rate}

            results.append({
                "filename": f.name,
                "mode": data.get("mode", "unknown"),
                "dataset": data.get("dataset", ""),
                "samples_total": data.get("samples_total", 0),
                "traces_collected": data.get("traces_collected", 0),
                "elapsed_seconds": data.get("elapsed_seconds", 0),
                "metrics": metrics_flat,
                "created_at": f.stat().st_mtime,
            })
        except Exception:
            continue

    return results


@router.get("/results/{filename}")
async def get_result(filename: str) -> dict:
    """Return full content of a specific eval result file."""
    if not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    fpath = _RESULTS_DIR / filename
    if not fpath.exists():
        raise HTTPException(status_code=404, detail="Result not found")

    try:
        return json.loads(fpath.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read result: {e}")


@router.post("/benchmark/run")
async def run_benchmark(mode: str = "autonomous", dataset: str = "benchmark.jsonl") -> dict:
    """Trigger a full benchmark run and persist results."""
    from eval.config import EvalConfig
    from eval.runners.benchmark_runner import BenchmarkRunner

    config = EvalConfig(eval_mode=mode, dataset_path=f"eval/datasets/{dataset}")

    runner = BenchmarkRunner()
    try:
        result = await runner.run_benchmark(config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Benchmark run failed: {e}")

    # Persist result to JSON file
    import uuid
    run_id = uuid.uuid4().hex[:12]
    out = _RESULTS_DIR / f"run_{mode}_{run_id}.json"
    _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, default=str)

    return {
        "run_id": run_id,
        "filename": out.name,
        "mode": mode,
        "samples_total": result.get("samples_total", 0),
        "traces_collected": result.get("traces_collected", 0),
        "elapsed_seconds": result.get("elapsed_seconds", 0),
    }
