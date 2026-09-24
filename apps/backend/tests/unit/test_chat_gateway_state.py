"""Conversation-state continuity: gateway signals → thread state → context.

Covers Phase 1 refactor wiring: _persist_gateway_state,
build_gateway_context, _update_conversation_state, and the direct-tool
path's obligation to record executed tools.

Phase 3: topic demotion/reset, stack cap 10, effective active-topic age-out.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.database import Database
from app.services.chat_engine import (
    ConversationState,
    _conversation_states,
    _get_conversation_state,
    _handle_direct_tool,
    _should_handle_jobs_followup,
    _update_conversation_state,
    build_gateway_context,
    _persist_gateway_state,
)
from app.services.chat_gateway import (
    ChatIntent,
    GatewayDecision,
    format_gateway_signals,
)


def test_persist_and_build_gateway_context_roundtrip():
    state = ConversationState()
    decision = GatewayDecision(
        intent=ChatIntent.GENERAL,
        confidence=0.95,
        preferred_tools=["search_mcp_jobs"],
        topics=["jobs", "salary"],
    )
    _persist_gateway_state(state, decision, "find python jobs")

    ctx = build_gateway_context(state)
    assert ctx.active_topic == "jobs"
    assert ctx.last_tools == ["search_mcp_jobs"]
    assert ctx.recent_user_messages == ["find python jobs"]
    assert ctx.turn == 1
    assert ctx.last_intent is ChatIntent.GENERAL
    assert [t.topic for t in ctx.topic_stack] == ["jobs"]


def test_persist_topic_shift_demotes_but_retains_stack():
    state = ConversationState()
    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.GENERAL, confidence=0.9, topics=["jobs"]
        ),
        "find python jobs",
    )
    assert state.active_topic == "jobs"

    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.UNKNOWN,
            confidence=0.5,
            topics=["technology"],
            topic_shift=True,
        ),
        "Actually forget that — explain Kubernetes",
    )
    assert state.active_topic == "technology"
    assert [t.topic for t in state.topic_stack] == ["jobs", "technology"]
    assert state.topic_stack[0].demoted is True
    assert state.topic_stack[1].demoted is False


def test_persist_topic_reset_clears_stack_then_pushes_new_topic():
    state = ConversationState()
    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.GENERAL, confidence=0.9, topics=["jobs"]
        ),
        "find python jobs",
    )
    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.UNKNOWN,
            confidence=0.5,
            topics=["technology"],
            topic_reset=True,
            topic_shift=True,
        ),
        "Actually forget that — explain Kubernetes",
    )
    assert state.active_topic == "technology"
    assert [t.topic for t in state.topic_stack] == ["technology"]
    assert state.topic_stack[0].demoted is False


def test_effective_active_topic_ages_out_after_four_turns():
    state = ConversationState()
    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.GENERAL, confidence=0.9, topics=["jobs"]
        ),
        "find python jobs",
    )
    # turn=1, entry.turn=1 → age 0 → still active
    assert build_gateway_context(state).active_topic == "jobs"
    # Simulate four intervening turns with no topic push (age = 5 > 4)
    state.turn = 6
    assert build_gateway_context(state).active_topic is None
    # Stack entry retained for history
    assert [t.topic for t in state.topic_stack] == ["jobs"]


def test_demoted_entry_is_not_effective_active_topic():
    state = ConversationState()
    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.GENERAL, confidence=0.9, topics=["jobs"]
        ),
        "find python jobs",
    )
    _persist_gateway_state(
        state,
        GatewayDecision(
            intent=ChatIntent.UNKNOWN,
            confidence=0.5,
            topics=[],
            topic_shift=True,
        ),
        "moving on to something else",
    )
    # Shift with no new primary topic: active cleared, stack demoted but retained
    assert state.active_topic is None
    assert [t.topic for t in state.topic_stack] == ["jobs"]
    assert state.topic_stack[0].demoted is True
    assert build_gateway_context(state).active_topic is None


def test_topic_stack_caps_at_ten():
    state = ConversationState()
    for i in range(12):
        _persist_gateway_state(
            state,
            GatewayDecision(
                intent=ChatIntent.GENERAL,
                confidence=0.5,
                topics=[f"topic{i}"],
            ),
            f"message {i}",
        )
    assert len(state.topic_stack) == 10
    # Oldest two trimmed; newest retained
    assert state.topic_stack[0].topic == "topic2"
    assert state.topic_stack[-1].topic == "topic11"


def test_update_conversation_state_writes_job_entity_and_tools():
    state = ConversationState()
    _update_conversation_state(
        state,
        {
            "search_mcp_jobs": {
                "jobs": [
                    {"job_id": "j-1", "company": "Acme"},
                    {"job_id": "j-2", "company": "Beta"},
                ]
            }
        },
        intent="job_search",
    )
    assert state.active_job_id == "j-1"
    assert state.active_company == "Acme"
    assert state.active_task == "search"
    assert state.last_tools == ["search_mcp_jobs"]
    assert state.previous_intent == "job_search"


def test_format_gateway_signals_renders_shift_and_followup():
    text = format_gateway_signals(
        GatewayDecision(
            intent=ChatIntent.UNKNOWN,
            confidence=0.5,
            topics=["technology"],
            actions=["explain"],
            topic_shift=True,
            has_followup_reference=False,
        )
    )
    assert "technology" in text
    assert "explain" in text
    assert "Topic shift" in text
    assert "Gateway intent: unknown" in text

    empty = format_gateway_signals(GatewayDecision(intent=ChatIntent.PROFILE))
    assert empty == "(no gateway signals)"


def test_format_gateway_signals_renders_history_and_reset():
    text = format_gateway_signals(
        GatewayDecision(
            intent=ChatIntent.GENERAL,
            confidence=0.7,
            topic_history=["jobs", "salary"],
            topic_reset=True,
        )
    )
    assert "Recent topic history: jobs, salary" in text
    assert "Topic reset detected" in text


@pytest.mark.asyncio
async def test_direct_tool_records_state(isolated_db: Database):
    """Regression: _handle_direct_tool never wrote ConversationState —
    last_tools/previous_intent stayed stale after forced tool turns."""
    thread = await isolated_db.create_chat_thread("State")
    thread_id = thread["thread_id"]
    _conversation_states.pop(thread_id, None)
    gateway = SimpleNamespace(
        preferred_tools=["get_market_position"],
        intent=ChatIntent.MARKET,
        slash_args=None,
    )
    emit = AsyncMock()
    messages = [{"role": "user", "content": "market trends"}]

    try:
        with patch("app.services.chat_engine.db", isolated_db), \
             patch("app.services.chat_engine.execute_tool", new_callable=AsyncMock) as mock_execute, \
             patch("app.services.chat_engine.complete", new_callable=AsyncMock, return_value="ok"), \
             patch("app.services.chat_engine._build_career_context", new_callable=AsyncMock, return_value=""):
            mock_execute.return_value = {"position": "P75"}
            await _handle_direct_tool(
                thread_id, "market trends", gateway, emit, messages, []
            )

        state = _get_conversation_state(thread_id)
        assert state.last_tools == ["get_market_position"]
        assert state.previous_intent == "market"
    finally:
        _conversation_states.pop(thread_id, None)


# ---------------------------------------------------------------------------
# Phase 2 — jobs follow-up gate (deterministic jobs vs planner)
# ---------------------------------------------------------------------------

def test_jobs_followup_remote_positions_with_job_cards():
    gw = SimpleNamespace(contextual_follow_up=False, has_followup_reference=True)
    assert _should_handle_jobs_followup(
        gw, "Which ones have remote positions?", True
    ) is True


def test_jobs_followup_tech_stack_rejected_despite_job_cards():
    # Skills-only / no structural job params → planner, never jobs handler.
    gw = SimpleNamespace(contextual_follow_up=False, has_followup_reference=True)
    assert _should_handle_jobs_followup(
        gw, "What about their tech stack?", True
    ) is False


def test_jobs_followup_requires_job_context_cards():
    gw = SimpleNamespace(contextual_follow_up=True, has_followup_reference=True)
    assert _should_handle_jobs_followup(
        gw, "narrow down those results", False
    ) is False


def test_jobs_followup_contextual_flag_without_params():
    gw = SimpleNamespace(contextual_follow_up=True, has_followup_reference=True)
    assert _should_handle_jobs_followup(
        gw, "narrow down those results", True
    ) is True


def test_jobs_followup_fresh_search_not_treated_as_continuation():
    # "find remote go jobs" has structural params but no follow-up reference.
    gw = SimpleNamespace(contextual_follow_up=False, has_followup_reference=False)
    assert _should_handle_jobs_followup(
        gw, "find remote go jobs", True
    ) is False


def test_jobs_followup_compare_these_not_jobs_continuation():
    gw = SimpleNamespace(contextual_follow_up=False, has_followup_reference=True)
    assert _should_handle_jobs_followup(
        gw, "Can you compare these with my resume?", True
    ) is False
