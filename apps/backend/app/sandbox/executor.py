"""Sandbox Executor — runs individual workflow steps with timeout and retry."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.sandbox.models import StepResult, WorkflowStep
from app.sandbox.policy import policy
from app.tools.executor import tool_executor
from app.tools.cache import tool_cache
from app.services.chat_tools import ToolRequiresConfirmation

logger = logging.getLogger(__name__)


def _state_for_events(run_id: str) -> dict[str, Any]:
    """Build a minimal state dict so emit_event can look up the queue."""
    return {"run_id": run_id}


class StepExecutor:
    """Executes individual workflow steps with timeout, caching, and permission checks."""

    async def execute_step(
        self,
        step: WorkflowStep,
        mode: str,
        skills: list[str] | None = None,
        run_id: str = "",
    ) -> StepResult:
        """Execute a single workflow step.

        Returns StepResult with success/failure and timing.
        """
        from app.agent.state import emit_event
        from app.schemas.agent_events import StepEvent

        state = _state_for_events(run_id)

        # Policy check
        error = policy.check_step(step.tool_name, mode, skills)
        if error:
            await emit_event(state, StepEvent(
                step_id=step.step_id,
                tool=step.tool_name,
                status="skipped",
            ))
            return StepResult(
                step_id=step.step_id,
                success=False,
                error=error,
            )

        # Emit: step running
        await emit_event(state, StepEvent(
            step_id=step.step_id,
            tool=step.tool_name,
            status="running",
        ))

        # Cache check
        cached = await tool_cache.get(step.tool_name, step.arguments)
        if cached is not None:
            await emit_event(state, StepEvent(
                step_id=step.step_id,
                tool=step.tool_name,
                status="success",
                duration_ms=0,
            ))
            return StepResult(
                step_id=step.step_id,
                success=True,
                result=cached,
                latency_ms=0.0,
            )

        # Execute with timeout
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(
                tool_executor.execute(step.tool_name, step.arguments),
                timeout=step.timeout_ms / 1000,
            )
            latency_ms = (time.monotonic() - start) * 1000

            if result["success"]:
                await tool_cache.set(step.tool_name, step.arguments, result["result"])
                await emit_event(state, StepEvent(
                    step_id=step.step_id,
                    tool=step.tool_name,
                    status="success",
                    duration_ms=int(latency_ms),
                ))
                return StepResult(
                    step_id=step.step_id,
                    success=True,
                    result=result["result"],
                    latency_ms=latency_ms,
                )
            else:
                await emit_event(state, StepEvent(
                    step_id=step.step_id,
                    tool=step.tool_name,
                    status="failed",
                    duration_ms=int(latency_ms),
                    error=result.get("error"),
                ))
                return StepResult(
                    step_id=step.step_id,
                    success=False,
                    error=result.get("error"),
                    latency_ms=latency_ms,
                )

        except asyncio.TimeoutError:
            latency_ms = (time.monotonic() - start) * 1000
            await emit_event(state, StepEvent(
                step_id=step.step_id,
                tool=step.tool_name,
                status="timeout",
                duration_ms=int(latency_ms),
                error=f"Timeout after {step.timeout_ms}ms",
            ))
            return StepResult(
                step_id=step.step_id,
                success=False,
                error=f"Timeout after {step.timeout_ms}ms",
                latency_ms=latency_ms,
            )
        except ToolRequiresConfirmation as e:
            latency_ms = (time.monotonic() - start) * 1000
            await emit_event(state, StepEvent(
                step_id=step.step_id,
                tool=step.tool_name,
                status="confirmation_required",
                duration_ms=int(latency_ms),
                error=str(e),
            ))
            return StepResult(
                step_id=step.step_id,
                success=False,
                error="confirmation_required",
                metadata={"tool": step.tool_name, "args": step.arguments},
                latency_ms=latency_ms,
            )
        except Exception as e:
            latency_ms = (time.monotonic() - start) * 1000
            await emit_event(state, StepEvent(
                step_id=step.step_id,
                tool=step.tool_name,
                status="failed",
                duration_ms=int(latency_ms),
                error=str(e),
            ))
            return StepResult(
                step_id=step.step_id,
                success=False,
                error=str(e),
                latency_ms=latency_ms,
            )


step_executor = StepExecutor()
