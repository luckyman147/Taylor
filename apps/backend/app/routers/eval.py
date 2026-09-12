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
