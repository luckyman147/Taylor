"""Sandbox Manager — orchestrates workflow execution with parallel steps."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.sandbox.models import StepResult, Workflow, WorkflowResult
from app.sandbox.executor import step_executor

logger = logging.getLogger(__name__)


class SandboxManager:
    """Executes workflows in a controlled environment.

    Steps with no dependencies run in parallel.
    Budget limits are enforced at each level.
    """

    async def execute(
        self,
        workflow: Workflow,
        mode: str,
        skills: list[str] | None = None,
        run_id: str = "",
    ) -> WorkflowResult:
        """Execute a complete workflow.

        Args:
            workflow: The structured workflow to execute.
            mode: Current chat mode (ask/agent/search).
            skills: Active skill IDs.
            run_id: Agent run ID for event queue lookup.

        Returns:
            WorkflowResult with all step results.
        """
        from app.agent.state import emit_event
        from app.schemas.agent_events import WorkflowEvent

        # Build a fake state for emit_event to look up the queue
        fake_state = {"run_id": run_id}

        await emit_event(fake_state, WorkflowEvent(
            status="executing",
            step_count=len(workflow.steps),
            message=f"Executing {len(workflow.steps)} step(s)...",
        ))

        results: list[StepResult] = []
        completed: dict[str, Any] = {}
        start_time = time.monotonic()

        # Topological sort: group steps by dependency level
        levels = self._topological_sort(workflow.steps)

        for level_idx, level in enumerate(levels):
            # Check budget
            elapsed_ms = (time.monotonic() - start_time) * 1000
            if elapsed_ms >= workflow.budget.max_time_ms:
                logger.warning("Workflow %s: time budget exhausted", workflow.workflow_id)
                break
            if len(results) >= workflow.budget.max_steps:
                logger.warning("Workflow %s: step budget exhausted", workflow.workflow_id)
                break

            # Execute independent steps in parallel
            tasks = []
            for step in level:
                # Resolve arguments from completed steps
                resolved_args = self._resolve_args(step.arguments, completed)
                step_with_resolved = step.model_copy(update={"arguments": resolved_args})

                tasks.append(step_executor.execute_step(
                    step_with_resolved, mode, skills, run_id,
                ))

            if tasks:
                level_results = await asyncio.gather(*tasks, return_exceptions=True)
                for result in level_results:
                    if isinstance(result, Exception):
                        results.append(StepResult(
                            step_id="unknown",
                            success=False,
                            error=str(result),
                        ))
                    else:
                        results.append(result)
                        if result.success:
                            completed[result.step_id] = result.result

        total_time_ms = (time.monotonic() - start_time) * 1000
        success = any(r.success for r in results)

        await emit_event(fake_state, WorkflowEvent(
            status="completed",
            step_count=len(results),
            message=f"Workflow complete: {sum(1 for r in results if r.success)}/{len(results)} steps succeeded",
        ))

        return WorkflowResult(
            workflow_id=workflow.workflow_id,
            step_results=results,
            success=success,
            total_time_ms=total_time_ms,
        )

    def _topological_sort(self, steps: list) -> list[list]:
        """Group steps into dependency levels for parallel execution."""
        step_map = {s.step_id: s for s in steps}
        completed_ids: set[str] = set()
        levels: list[list] = []
        remaining = list(steps)

        while remaining:
            # Find steps whose dependencies are all completed
            ready = [
                s for s in remaining
                if all(dep in completed_ids for dep in s.depends_on)
            ]
            if not ready:
                # Circular dependency — execute remaining sequentially
                ready = remaining[:1]

            levels.append(ready)
            for s in ready:
                completed_ids.add(s.step_id)
                remaining.remove(s)

        return levels

    def _resolve_args(
        self,
        arguments: dict[str, Any],
        completed: dict[str, Any],
    ) -> dict[str, Any]:
        """Resolve arguments that reference results from completed steps."""
        resolved = {}
        for key, value in arguments.items():
            if isinstance(value, str) and value.startswith("$step."):
                # Reference to a step result: $step.step_id.field
                parts = value[6:].split(".", 1)
                step_id = parts[0]
                field = parts[1] if len(parts) > 1 else None
                if step_id in completed:
                    result = completed[step_id]
                    if field and isinstance(result, dict):
                        resolved[key] = result.get(field)
                    else:
                        resolved[key] = result
                else:
                    resolved[key] = value  # Keep unresolved
            else:
                resolved[key] = value
        return resolved


sandbox_manager = SandboxManager()
