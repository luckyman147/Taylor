"""Baseline runner — uses the existing plan→execute→answer flow (no agent loop)."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from eval.config import EvalConfig
from eval.sample import EvalSample, EvalTrace, ToolCallRecord, TokenUsage

logger = logging.getLogger(__name__)


class BaselineRunner:
    """Runs a sample through the current non-agent path.

    This captures the existing run_turn() behavior for A/B comparison.
    """

    async def run(self, sample: EvalSample, config: EvalConfig) -> EvalTrace:
        start = time.monotonic()
        trace = EvalTrace(
            sample_id=sample.id,
            mode="baseline",
            query=sample.query,
            config=config.to_dict(),
        )

        try:
            from app.services.chat_engine import run_turn
            from app.database import db

            # Create a temp thread for the eval
            thread_id = f"eval_{uuid.uuid4().hex[:8]}"
            await db.create_chat_thread(thread_id, title=f"eval_{sample.id}")

            result = await run_turn(thread_id, sample.query)

            # Extract trace data from result
            trace.final_answer = result.get("assistant_content", "")
            trace.success = bool(trace.final_answer and len(trace.final_answer) > 10)

            # Record tool calls from cards
            cards = result.get("cards", [])
            for card in cards:
                tool_name = card.get("data", {}).get("tool", "unknown")
                trace.tool_calls.append(ToolCallRecord(
                    tool_name=tool_name,
                    success=True,
                    result=card.get("data"),
                ))

            trace.selected_tools = [tc.tool_name for tc in trace.tool_calls]
            trace.ranked_tools = trace.selected_tools.copy()

            # Cleanup
            await db.delete_chat_thread(thread_id)

        except Exception as e:
            logger.error("Baseline runner failed: %s", e)
            trace.final_answer = f"Error: {e}"
            trace.success = False

        trace.latency_ms = (time.monotonic() - start) * 1000
        return trace


baseline_runner = BaselineRunner()
