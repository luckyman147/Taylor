"""Phase 3: agent-loop gateway_signals injection + structured decision log.

Anti-theater: fails if agent context omits gateway_signals, if the agent
planner prompt never renders them, or if gateway_classification logs message
text / drops required evidence fields.
"""

import json
import logging
from unittest.mock import AsyncMock

import pytest

from app.agent.planner import AgentPlanner
from app.services.chat_engine import _try_agent_loop, _try_agent_loop_stream
from app.services.chat_gateway import (
    ChatIntent,
    GatewayDecision,
    classify_intent,
)


def _gateway_with_signals() -> GatewayDecision:
    return GatewayDecision(
        intent=ChatIntent.GENERAL,
        confidence=0.7,
        topics=["jobs"],
        actions=["search"],
        topic_history=["salary"],
    )


@pytest.mark.asyncio
async def test_agent_loop_context_includes_gateway_signals(monkeypatch):
    captured: dict = {}

    async def fake_run(*, query, mode, skills, context, budget_config=None, emit_fn=None):
        captured["context"] = context
        return {"answer": "This is a long agent answer for the test.", "tool_calls": []}

    monkeypatch.setattr("app.services.chat_engine.agent_runner.run", fake_run)
    result = await _try_agent_loop(
        "analyze market position and research industry trends",
        "ask",
        [],
        "thread-1",
        [],
        [],
        _gateway_with_signals(),
    )
    assert result is not None
    assert "gateway_signals" in captured["context"]
    assert "Detected topics: jobs" in captured["context"]["gateway_signals"]
    assert "Recent topic history: salary" in captured["context"]["gateway_signals"]


@pytest.mark.asyncio
async def test_agent_loop_stream_context_includes_gateway_signals(monkeypatch):
    captured: dict = {}

    async def fake_run(*, query, mode, skills, context, budget_config=None, emit_fn=None):
        captured["context"] = context
        return {"answer": "This is a long agent answer for the test.", "tool_calls": []}

    monkeypatch.setattr("app.services.chat_engine.agent_runner.run", fake_run)
    emit = AsyncMock()
    result = await _try_agent_loop_stream(
        "analyze market position and research industry trends",
        "ask",
        [],
        "thread-1",
        [],
        [],
        emit,
        _gateway_with_signals(),
    )
    assert result is not None
    assert "Detected topics: jobs" in captured["context"]["gateway_signals"]


@pytest.mark.asyncio
async def test_agent_loop_without_gateway_has_empty_signals(monkeypatch):
    captured: dict = {}

    async def fake_run(*, query, mode, skills, context, budget_config=None, emit_fn=None):
        captured["context"] = context
        return {"answer": "This is a long agent answer for the test.", "tool_calls": []}

    monkeypatch.setattr("app.services.chat_engine.agent_runner.run", fake_run)
    await _try_agent_loop(
        "analyze market position and research industry trends",
        "ask",
        [],
        "thread-1",
        [],
        [],
        None,
    )
    assert captured["context"]["gateway_signals"] == ""


@pytest.mark.asyncio
async def test_agent_planner_prompt_renders_gateway_signals(monkeypatch):
    captured: dict = {}

    async def fake_complete_json(prompt, **kwargs):
        captured["prompt"] = prompt
        return {"actions": [], "sufficient": True}

    monkeypatch.setattr("app.agent.planner.complete_json", fake_complete_json)
    planner = AgentPlanner()
    state = {
        "query": "find remote roles",
        "data_gaps": [],
        "tool_calls": [],
        "context": {
            "gateway_signals": "- Detected topics: jobs\n- Follow-up reference detected",
        },
    }
    await planner.plan_next_actions(state, [{"name": "search_mcp_jobs", "description": "d"}])
    assert "Detected topics: jobs" in captured["prompt"]
    assert "Follow-up reference detected" in captured["prompt"]


@pytest.mark.asyncio
async def test_agent_planner_prompt_uses_none_when_signals_missing(monkeypatch):
    captured: dict = {}

    async def fake_complete_json(prompt, **kwargs):
        captured["prompt"] = prompt
        return {"actions": [], "sufficient": True}

    monkeypatch.setattr("app.agent.planner.complete_json", fake_complete_json)
    planner = AgentPlanner()
    state = {"query": "q", "data_gaps": [], "tool_calls": [], "context": {}}
    await planner.plan_next_actions(state, [{"name": "t", "description": "d"}])
    assert "(none)" in captured["prompt"]


@pytest.mark.asyncio
async def test_gateway_classification_log_is_json_evidence_only(caplog):
    secret = "SENTINEL_TOKEN_XYZ"
    with caplog.at_level(logging.INFO, logger="app.services.chat_gateway"):
        await classify_intent(f"find {secret} jobs about python")

    lines = [
        r.getMessage()
        for r in caplog.records
        if r.getMessage().startswith("gateway_classification ")
    ]
    assert len(lines) == 1
    assert secret not in lines[0]
    payload = json.loads(lines[0][len("gateway_classification "):])
    assert set(payload) == {
        "event",
        "intent",
        "confidence",
        "topics",
        "actions",
        "active_topic",
        "has_followup_reference",
        "topic_shift",
        "preferred_tools",
        "force_preferred",
    }
    assert payload["event"] == "gateway_classification"
    assert payload["intent"] == "job_search"
    assert "jobs" in payload["topics"]


@pytest.mark.asyncio
async def test_clarify_log_scrubs_message_text(caplog):
    # Matches _CLARIFY_PATTERNS only (not _GENERAL_QUERY_PATTERNS, which is
    # checked first) so the clarify branch actually runs.
    with caplog.at_level(logging.INFO, logger="app.services.chat_gateway"):
        await classify_intent("can you help me with SECRET_MSG_42")

    clarify_lines = [
        r.getMessage()
        for r in caplog.records
        if "clarify pattern matched" in r.getMessage()
    ]
    assert clarify_lines
    for line in clarify_lines:
        assert "SECRET_MSG_42" not in line
        assert "message=" not in line
