"""Chat Command Center endpoints: threads, turns, confirm/cancel, memory."""

import logging

from fastapi import APIRouter, HTTPException

from app.database import db
from app.schemas.chat import (
    CancelRequest,
    ConfirmRequest,
    ConfirmResponse,
    MemorySaveRequest,
    ThreadCreate,
    ThreadSummary,
    ThreadUpdate,
    TurnRequest,
    TurnResponse,
)
from app.services.chat_engine import cancel_pending, confirm_pending, run_turn

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


# ---------------------------------------------------------------------------
# Thread CRUD
# ---------------------------------------------------------------------------


@router.get("/threads", response_model=list[ThreadSummary])
async def list_threads() -> list[ThreadSummary]:
    """List all chat threads with message counts and previews."""
    threads = await db.list_chat_threads()
    return [
        ThreadSummary(
            thread_id=t["thread_id"],
            title=t.get("title", "New Chat"),
            mode=t.get("mode", "ask"),
            created_at=t.get("created_at", ""),
            updated_at=t.get("updated_at", ""),
            message_count=t.get("message_count", 0),
            last_preview=t.get("last_preview", ""),
        )
        for t in threads
    ]


@router.post("/threads", response_model=ThreadSummary)
async def create_thread(request: ThreadCreate) -> ThreadSummary:
    """Create a new chat thread."""
    title = request.title or "New Chat"
    thread = await db.create_chat_thread(title=title, mode=request.mode)
    return ThreadSummary(
        thread_id=thread["thread_id"],
        title=thread.get("title", title),
        mode=thread.get("mode", request.mode),
        created_at=thread.get("created_at", ""),
        updated_at=thread.get("updated_at", ""),
        message_count=0,
        last_preview="",
    )


@router.patch("/threads/{thread_id}")
async def update_thread(thread_id: str, request: ThreadUpdate) -> dict:
    """Update thread title or mode."""
    thread = await db.get_chat_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    updated = await db.update_chat_thread(
        thread_id,
        title=request.title,
        mode=request.mode,
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update thread")
    return {"ok": True, "thread": updated}


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str) -> dict:
    """Delete a chat thread and its messages."""
    thread = await db.get_chat_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    await db.delete_chat_thread(thread_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Turn (send message)
# ---------------------------------------------------------------------------


@router.post("/threads/{thread_id}/turn", response_model=TurnResponse)
async def send_turn(thread_id: str, request: TurnRequest) -> TurnResponse:
    """Send a user message and get an assistant response."""
    try:
        result = await run_turn(thread_id, request.message)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Chat turn failed: %s", e)
        raise HTTPException(status_code=500, detail="Chat turn failed. Please try again.")

    return TurnResponse(
        assistant_content=result["assistant_content"],
        cards=result.get("cards", []),
        actions=result.get("actions", []),
        stats=result.get("stats"),
        pending_action=result.get("pending_action"),
        memory_candidates=result.get("memory_candidates", []),
        followups=result.get("followups", []),
        sources=result.get("sources", []),
    )


# ---------------------------------------------------------------------------
# Confirm / Cancel pending write actions
# ---------------------------------------------------------------------------


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm_action(request: ConfirmRequest) -> ConfirmResponse:
    """Confirm and execute a pending write action."""
    try:
        result = await confirm_pending(request.token)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Confirm failed: %s", e)
        raise HTTPException(status_code=500, detail="Action failed. Please try again.")

    return ConfirmResponse(
        ok=result["ok"],
        message=result["message"],
        result_card=result.get("result_card"),
    )


@router.post("/cancel")
async def cancel_action(request: CancelRequest) -> dict:
    """Cancel a pending write action."""
    try:
        result = await cancel_pending(request.token)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return result


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------


@router.post("/memory/save")
async def save_memory(request: MemorySaveRequest) -> dict:
    """Manually save a memory statement."""
    from app.services.chat_engine import _process_memory_candidates

    saved = await _process_memory_candidates(
        [{"statement": request.statement}],
        request.source_thread_id,
    )
    return {"ok": True, "saved": saved}


@router.delete("/memory/{memory_id}")
async def dismiss_memory(memory_id: str) -> dict:
    """Dismiss (deactivate) a memory by ID."""
    ok = await db.dismiss_chat_memory(memory_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"ok": True}
