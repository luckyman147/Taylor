from app.services.context_builder import build_chat_context, ChatContext
from app.services.chat_engine import ConversationState
from typing import Any

def test_build_context_respects_token_budget():
    messages: list[dict[str, Any]] = [{"role": "user", "content": "a " * 5000}] * 20
    state = ConversationState()
    ctx = build_chat_context(messages, state, budget_tokens=500)
    assert ctx.token_count <= 500

def test_build_context_includes_recent_turns_first():
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "old message"},
        {"role": "assistant", "content": "old reply"},
        {"role": "user", "content": "latest question"},
    ]
    state = ConversationState()
    ctx = build_chat_context(messages, state, budget_tokens=5000)
    assert "latest question" in ctx.history_text
    assert "old message" in ctx.history_text

def test_build_context_includes_entity_summary():
    messages: list[dict[str, Any]] = [{"role": "user", "content": "test"}]
    state = ConversationState()
    state.active_company = "Google"
    state.active_task = "search"
    ctx = build_chat_context(messages, state, budget_tokens=5000)
    assert "Google" in ctx.entity_summary
