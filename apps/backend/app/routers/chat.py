"""Chat Command Center endpoints: threads, turns, confirm/cancel, memory."""

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.database import db
from app.schemas.agent_events import serialize_event
from app.schemas.chat import (
    CancelRequest,
    ConfirmRequest,
    ConfirmResponse,
    MemorySaveRequest,
    ThreadCreate,
    ThreadMessage,
    ThreadSummary,
    ThreadUpdate,
    TurnRequest,
    TurnResponse,
)
from app.services.chat_engine import cancel_pending, confirm_pending, run_turn, run_turn_stream

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
            skills=t.get("skills", []),
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
    thread = await db.create_chat_thread(title=title, mode=request.mode, skills=request.skills)
    return ThreadSummary(
        thread_id=thread["thread_id"],
        title=thread.get("title", title),
        mode=thread.get("mode", request.mode),
        skills=thread.get("skills", []),
        created_at=thread.get("created_at", ""),
        updated_at=thread.get("updated_at", ""),
        message_count=0,
        last_preview="",
    )


@router.patch("/threads/{thread_id}")
async def update_thread(thread_id: str, request: ThreadUpdate) -> dict:
    """Update thread title, mode, or skills."""
    thread = await db.get_chat_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    updated = await db.update_chat_thread(
        thread_id,
        title=request.title,
        mode=request.mode,
        skills=request.skills,
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


@router.get("/threads/{thread_id}/messages", response_model=list[ThreadMessage])
async def get_thread_messages(thread_id: str, limit: int = 100) -> list[ThreadMessage]:
    """Get all messages for a thread."""
    thread = await db.get_chat_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    messages = await db.list_chat_messages(thread_id, limit=limit)
    return [
        ThreadMessage(
            message_id=m["message_id"],
            thread_id=m["thread_id"],
            role=m["role"],
            content=m["content"],
            created_at=m["created_at"],
            envelope=m.get("envelope"),
        )
        for m in messages
    ]


# ---------------------------------------------------------------------------
# Turn (send message)
# ---------------------------------------------------------------------------


@router.post("/threads/{thread_id}/turn", response_model=TurnResponse)
async def send_turn(thread_id: str, request: TurnRequest) -> TurnResponse:
    """Send a user message and get an assistant response."""
    try:
        result = await run_turn(thread_id, request.message, resume_id=request.resume_id)
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


@router.post("/threads/{thread_id}/turn/stream", response_model=None)
async def send_turn_stream(
    thread_id: str,
    request: TurnRequest,
    stream: bool = Query(True),
) -> StreamingResponse | TurnResponse:
    """Send a message with optional SSE streaming of agent status events.

    ?stream=true (default): Returns text/event-stream with status events
    followed by a final turn_complete event.
    ?stream=false: Returns the plain TurnResponse (backward compat).
    """
    if not stream:
        result = await run_turn(thread_id, request.message, resume_id=request.resume_id)
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

    event_queue: asyncio.Queue = asyncio.Queue()

    async def event_generator():
        async def _run():
            try:
                await run_turn_stream(
                    thread_id,
                    request.message,
                    resume_id=request.resume_id,
                    event_queue=event_queue,
                )
            except Exception as e:
                logger.error("Streamed turn failed: %s", e)
                from app.schemas.agent_events import AgentStatusEvent, AgentStatus
                await event_queue.put(AgentStatusEvent(
                    status=AgentStatus.FAILED,
                    message="An error occurred. Please try again.",
                ))
            finally:
                await event_queue.put(None)  # Sentinel

        turn_task = asyncio.create_task(_run())
        event_count = 0

        while True:
            try:
                event = await event_queue.get()
            except asyncio.CancelledError:
                break
            if event is None:
                break
            event_count += 1
            yield f"data: {serialize_event(event)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Confirm / Cancel pending write actions
# ---------------------------------------------------------------------------


@router.post("/confirm", response_model=ConfirmResponse)
async def confirm_action(request: ConfirmRequest) -> ConfirmResponse:
    """Confirm and execute a pending write action."""
    try:
        result = await confirm_pending(request.token, request.thread_id)
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
