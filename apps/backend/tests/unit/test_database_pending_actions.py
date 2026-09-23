import pytest
from app.database import Database
from datetime import datetime, timezone

@pytest.mark.asyncio
async def test_add_and_get_pending_action(isolated_db: Database):
    thread_id = "test-thread-123"
    tool = "create_resume"
    args = {"title": "SWE"}
    summary = "Create SWE resume"
    
    token = await isolated_db.add_pending_action(thread_id, tool, args, summary)
    assert token is not None
    assert len(token) > 10
    
    # Retrieve
    action = await isolated_db.get_pending_action(token, thread_id)
    assert action is not None
    assert action["tool"] == tool
    assert action["args"] == args
    assert action["summary"] == summary
    assert action["status"] == "pending"

@pytest.mark.asyncio
async def test_delete_pending_action(isolated_db: Database):
    thread_id = "test-thread-123"
    token = await isolated_db.add_pending_action(thread_id, "test", {}, "test")
    
    assert await isolated_db.delete_pending_action(token, thread_id) is True
    
    # Should be gone
    action = await isolated_db.get_pending_action(token, thread_id)
    assert action is None

@pytest.mark.asyncio
async def test_update_pending_action_status(isolated_db: Database):
    thread_id = "test-thread-123"
    token = await isolated_db.add_pending_action(thread_id, "test", {}, "test")
    
    assert await isolated_db.update_pending_action_status(token, thread_id, "confirmed") is True
    
    # get_pending_action only returns "pending" status, so it should be None now
    action = await isolated_db.get_pending_action(token, thread_id)
    assert action is None
