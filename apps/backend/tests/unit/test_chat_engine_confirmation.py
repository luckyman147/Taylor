import pytest
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch
from app.database import Database
from app.services.chat_engine import run_turn, confirm_pending, cancel_pending
from app.services.tool_execution import ToolExecutionStatus

@pytest.mark.asyncio
async def test_run_turn_requires_confirmation(isolated_db: Database):
    thread_data = await isolated_db.create_chat_thread("Test")
    thread_id = thread_data["thread_id"]
    
    # Mock LLM to return a write tool call
    mock_llm_response = {
        "text": "I will create that for you.",
        "tool_calls": [{"name": "create_resume", "args": {"title": "Backend SWE"}}]
    }
    
    with patch("app.services.chat_engine.db", isolated_db), \
         patch("app.services.chat_engine.complete_json", new_callable=AsyncMock) as mock_plan, \
         patch("app.services.chat_engine.complete", new_callable=AsyncMock) as mock_complete, \
         patch("app.services.tool_execution.execute_tool_with_policy", new_callable=AsyncMock) as mock_exec, \
         patch("app.services.chat_engine._try_agent_loop", new_callable=AsyncMock) as mock_agent_loop:
        
        mock_agent_loop.return_value = None
        
        # mock planner returning a tool call
        mock_plan.return_value = {
            "intent": "action",
            "tool_calls": [{"tool": "create_resume", "args": {"title": "Backend SWE"}}],
            "title": "Create Resume"
        }
        
        # mock answer generation
        mock_complete.return_value = "I will create that for you."
        
        # execution policy returns PENDING
        from app.services.tool_execution import ToolExecutionResult, ToolExecutionStatus
        mock_exec.return_value = ToolExecutionResult(
            tool="create_resume",
            status=ToolExecutionStatus.PENDING_CONFIRMATION,
            summary="Create a resume titled 'Backend SWE'",
            data={"title": "Backend SWE"}
        )
        
        result = await run_turn(thread_id, "Please create a Backend SWE resume.")
        
        # Check that it asked for confirmation
        assert "pending_action" in result
        pending = result["pending_action"]
        assert pending is not None
        assert pending["tool"] == "create_resume"
        assert pending["summary"] == "Create a resume titled 'Backend SWE'"
        assert "token" in pending
        
        # Check DB
        token = pending["token"]
        db_pending = await isolated_db.get_pending_action(token, thread_id)
        assert db_pending is not None
        assert db_pending["tool"] == "create_resume"

@pytest.mark.asyncio
async def test_confirm_pending_action(isolated_db: Database):
    thread_data = await isolated_db.create_chat_thread("Test")
    thread_id = thread_data["thread_id"]
    
    token = await isolated_db.add_pending_action(
        thread_id, "create_resume", {"title": "DevOps"}, "Create DevOps resume"
    )
    
    with patch("app.services.chat_engine.db", isolated_db), \
         patch("app.services.chat_tools.execute_tool_confirmed", new_callable=AsyncMock) as mock_exec_confirmed:
        mock_exec_confirmed.return_value = {"id": "resume-123", "title": "DevOps"}
        
        result = await confirm_pending(token, thread_id)
        
        # Check result
        assert result["ok"] is True
        assert result["result_card"]["data"]["id"] == "resume-123"
        
        # Check DB status - since get_pending_action filters out confirmed ones, it should return None
        db_pending = await isolated_db.get_pending_action(token, thread_id)
        assert db_pending is None

@pytest.mark.asyncio
async def test_cancel_pending_action(isolated_db: Database):
    thread_data = await isolated_db.create_chat_thread("Test")
    thread_id = thread_data["thread_id"]
    
    token = await isolated_db.add_pending_action(
        thread_id, "delete_resume", {"resume_id": "r-123"}, "Delete resume"
    )
    
    with patch("app.services.chat_engine.db", isolated_db):
        result = await cancel_pending(token, thread_id)
    
    assert result["ok"] is True
    assert await isolated_db.get_pending_action(token, thread_id) is None
