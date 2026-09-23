"""Regression tests for the direct-tool (market-intent) answer path."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.database import Database
from app.services.chat_engine import _handle_direct_tool


@pytest.mark.asyncio
async def test_direct_tool_prompt_includes_conversation_history(isolated_db: Database):
    """Regression: KeyError 'conversation_history' killed market-intent turns.

    ``_handle_direct_tool`` formats ``CHAT_ANSWER_PROMPT``; it must supply
    every placeholder the template declares — including
    ``conversation_history`` — otherwise the streamed turn dies with a
    KeyError before the LLM is ever called.
    """
    thread = await isolated_db.create_chat_thread("Test")
    thread_id = thread["thread_id"]
    user_message = "What are the market trends for data engineers?"
    messages = [
        {"role": "user", "content": "Tell me about my applications"},
        {"role": "assistant", "content": "You have 3 active applications."},
        {"role": "user", "content": user_message},
    ]
    gateway = SimpleNamespace(preferred_tools=["market_position"])
    emit = AsyncMock()

    with patch("app.services.chat_engine.db", isolated_db), \
         patch("app.services.chat_engine.execute_tool", new_callable=AsyncMock) as mock_execute, \
         patch("app.services.chat_engine.complete", new_callable=AsyncMock) as mock_complete, \
         patch("app.services.chat_engine._build_career_context", new_callable=AsyncMock, return_value="CAREER DATA"):
        mock_execute.return_value = {"score": 80}
        mock_complete.return_value = "Market looks good."

        result = await _handle_direct_tool(
            thread_id, user_message, gateway, emit, messages, []
        )

    # The format call succeeded (no KeyError) and the LLM was reached.
    assert mock_complete.call_args is not None
    prompt = mock_complete.call_args.kwargs["prompt"]
    assert "{conversation_history}" not in prompt
    # History lines are rendered as "ROLE: content" — prove a *prior* turn
    # was injected, not just the current user_message placeholder.
    assert "USER: Tell me about my applications" in prompt
    assert result["assistant_content"] == "Market looks good."
