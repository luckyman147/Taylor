from app.services.chat_engine import _format_history, ConversationState, _update_conversation_state
from typing import Any

def test_format_history_truncates_at_2000_chars():
    long_msg = "x" * 3000
    messages: list[dict[str, Any]] = [{"role": "user", "content": long_msg}]
    result = _format_history(messages)
    # Each line is "ROLE: content" — content should be <=2000 chars
    assert len(result.split(": ", 1)[1]) <= 2000

def test_format_history_includes_card_summaries():
    messages: list[dict[str, Any]] = [
        {
            "role": "assistant",
            "content": "Here are your jobs",
            "envelope": {"cards": [{"kind": "job_list", "data": {"total": 12}}]},
        }
    ]
    result = _format_history(messages)
    assert "job_search: 12 jobs" in result

def test_conversation_state_tracks_job_from_tool_result():
    state = ConversationState()
    tool_results = {"search_mcp_jobs": {"jobs": [{"title": "Python Dev", "company": "Acme"}]}}
    _update_conversation_state(state, tool_results)
    assert state.active_task == "search"
    assert state.active_company == "Acme"
