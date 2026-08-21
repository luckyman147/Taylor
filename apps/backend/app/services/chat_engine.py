"""Chat Command Center — orchestrator.

Two-phase planner: read tools execute immediately, write tools return
pending_action. In-memory pending store (single-worker assumption).
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from app.config_cache import get_content_language
from app.database import db
from app.llm import complete, complete_json
from app.prompts import (
    CHAT_ANSWER_PROMPT,
    CHAT_PLANNER_PROMPT,
    CHAT_PLANNER_SYSTEM_PROMPTS,
    get_language_name,
)
from app.services.chat_tools import (
    ToolRequiresConfirmation,
    execute_tool,
    get_tool_catalog_json,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pending action store (in-memory, TTL 30 min, single-worker)
# ---------------------------------------------------------------------------

_PENDING_TTL = 30 * 60  # seconds
_pending_store: dict[str, dict[str, Any]] = {}


def _cleanup_pending() -> None:
    """Evict expired pending actions."""
    now = time.time()
    expired = [t for t, v in _pending_store.items() if now - v["created_at"] > _PENDING_TTL]
    for t in expired:
        _pending_store.pop(t, None)


def _store_pending(tool: str, args: dict[str, Any], summary: str) -> str:
    """Store a pending write action, return confirmation token."""
    _cleanup_pending()
    token = uuid.uuid4().hex[:16]
    _pending_store[token] = {
        "tool": tool,
        "args": args,
        "summary": summary,
        "created_at": time.time(),
    }
    return token


def _get_pending(token: str) -> dict[str, Any] | None:
    """Retrieve and validate a pending action."""
    _cleanup_pending()
    entry = _pending_store.get(token)
    if entry is None:
        return None
    if time.time() - entry["created_at"] > _PENDING_TTL:
        _pending_store.pop(token, None)
        return None
    return entry


def _remove_pending(token: str) -> None:
    _pending_store.pop(token, None)


# ---------------------------------------------------------------------------
# History formatting
# ---------------------------------------------------------------------------

def _format_history(messages: list[dict[str, Any]], limit: int = 20) -> str:
    """Format recent messages into a compact history string."""
    recent = messages[-limit:]
    parts: list[str] = []
    for m in recent:
        role = m.get("role", "user")
        content = (m.get("content") or "")[:500]
        parts.append(f"{role.upper()}: {content}")
    return "\n".join(parts)


def _format_memories(memories: list[dict[str, Any]]) -> str:
    """Format active memories for the planner prompt."""
    if not memories:
        return "(none)"
    return "\n".join(f"- {m.get('statement', '')}" for m in memories)


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

async def run_turn(
    thread_id: str,
    user_message: str,
) -> dict[str, Any]:
    """Execute a full chat turn: plan → tool calls → answer.

    Returns a dict matching TurnResponse schema.
    """
    thread = await db.get_chat_thread(thread_id)
    if not thread:
        raise ValueError(f"Thread {thread_id} not found")

    mode = thread.get("mode", "ask")
    language = get_content_language()
    output_language = get_language_name(language)

    # Load context
    messages = await db.list_chat_messages(thread_id, limit=50)
    memories = await db.list_active_chat_memories(limit=20)

    # --- Gateway: fast intent classification (no LLM call) ---
    from app.services.chat_gateway import classify_intent
    gateway = await classify_intent(user_message)

    if gateway.needs_selection:
        # Multiple resumes — return selection card, skip planner entirely
        await db.add_chat_message(thread_id, "user", user_message)
        selection_card = {
            "kind": "resume_selection",
            "data": {
                "needs_selection": True,
                "prompt": "Which resume would you like to audit?",
                "resumes": gateway.resumes,
            },
        }
        envelope = {
            "cards": [selection_card],
            "actions": [],
            "stats": None,
            "pending_action": None,
            "followups": ["Audit my master resume", "Compare all resumes"],
            "sources": [],
        }
        assistant_content = "Which resume would you like me to audit?"
        await db.add_chat_message(thread_id, "assistant", assistant_content, envelope=envelope)
        return {
            "assistant_content": assistant_content,
            "cards": envelope["cards"],
            "actions": envelope["actions"],
            "stats": None,
            "pending_action": None,
            "memory_candidates": [],
            "followups": envelope["followups"],
            "sources": [],
        }

    # If gateway determined a specific resume, inject it into context
    gateway_context = ""
    if gateway.resume_id:
        gateway_context = f"\n[GATEWAY: User wants to audit resume_id={gateway.resume_id}. Call get_ats_audit with resume_id='{gateway.resume_id}'.]"
        logger.info("Gateway context injected: resume_id=%s", gateway.resume_id)

    # --- End gateway ---

    catalog_json = get_tool_catalog_json(mode=mode)
    tool_catalog_text = ", ".join(
        f"{t['name']}{'(' + ', '.join(p for p, s in t['params'].items() if s.get('required')) + ')' if t['params'] else ''}"
        for t in catalog_json
    )

    # Phase 1: Plan
    planner_prompt = CHAT_PLANNER_PROMPT.format(
        active_memories=_format_memories(memories),
        history=_format_history(messages),
        tool_catalog=tool_catalog_text,
        output_language=output_language,
    ) + gateway_context

    system_prompt = CHAT_PLANNER_SYSTEM_PROMPTS.get(mode, CHAT_PLANNER_SYSTEM_PROMPTS["ask"])

    plan = await complete_json(
        prompt=planner_prompt,
        system_prompt=system_prompt,
        schema_type="chat_plan",
    )

    tool_calls = plan.get("tool_calls", [])
    narrative = plan.get("narrative", "")
    followups = plan.get("followups", [])
    memory_candidates = plan.get("memory_candidates", [])
    plan_title = plan.get("title", "")

    # Auto-title: update thread title from planner on first message
    if plan_title and len(messages) <= 1:
        try:
            await db.update_chat_thread(thread_id, title=plan_title[:80])
        except Exception:
            pass

    # Phase 2: Execute read tools
    tool_results: dict[str, Any] = {}
    stats: dict[str, Any] | None = None
    pending_action: dict[str, Any] | None = None

    for call in tool_calls:
        tool_name = call.get("tool", "")
        tool_args = call.get("args", {})
        if not tool_name:
            continue

        try:
            result = await execute_tool(tool_name, tool_args)
            tool_results[tool_name] = result
            # Surface stats if the tool produced numeric data
            if _is_stats_tool(tool_name):
                stats = result
        except ToolRequiresConfirmation as e:
            # Write tool → store pending, don't execute yet
            token = _store_pending(e.tool, e.args, e.summary)
            pending_action = {
                "token": token,
                "tool": e.tool,
                "summary": e.summary,
            }
        except Exception as e:
            logger.warning("Tool %s failed: %s", tool_name, e)
            tool_results[tool_name] = {"error": str(e)}

    # Phase 2.5: Retrieve RAG context for the answer
    rag_context = ""
    try:
        from app.services.rag import rag_index
        from app.services.rag import build_context_block
        rag_results = await rag_index.query(
            user_message,
            top_k=3,
            rerank=True,
        )
        # Convert to (Chunk, score) tuples for context builder
        rag_input = {}
        for source_type, items in rag_results.items():
            rag_input[source_type] = items
        rag_context = build_context_block(rag_input)
    except Exception:
        pass

    # Phase 3: Generate answer
    answer_prompt = CHAT_ANSWER_PROMPT.format(
        user_message=user_message,
        tool_stats=json.dumps(tool_results, ensure_ascii=False, default=str),
        rag_context=rag_context,
        active_memories=_format_memories(memories),
        mode=mode,
        output_language=output_language,
    )

    assistant_content = await complete(
        prompt=answer_prompt,
        system_prompt=system_prompt,
    )

    # Persist user message
    await db.add_chat_message(thread_id, "user", user_message)

    # Build envelope for assistant message
    envelope = {
        "cards": _build_cards(tool_results, stats),
        "actions": _build_actions(tool_results),
        "stats": stats,
        "pending_action": pending_action,
        "followups": followups,
        "sources": _extract_sources(tool_results),
    }

    # Persist assistant message
    await db.add_chat_message(thread_id, "assistant", assistant_content, envelope=envelope)

    # Process memory candidates (dedup, cap at 3)
    saved_memories = await _process_memory_candidates(
        memory_candidates, thread_id
    )

    return {
        "assistant_content": assistant_content,
        "cards": envelope["cards"],
        "actions": envelope["actions"],
        "stats": stats,
        "pending_action": pending_action,
        "memory_candidates": saved_memories,
        "followups": followups,
        "sources": envelope["sources"],
    }


# ---------------------------------------------------------------------------
# Confirm / Cancel
# ---------------------------------------------------------------------------

async def confirm_pending(token: str) -> dict[str, Any]:
    """Execute a previously pending write tool."""
    entry = _get_pending(token)
    if entry is None:
        raise ValueError("Pending action not found or expired")

    _remove_pending(token)

    # Execute the write tool
    result = await execute_tool(entry["tool"], entry["args"])

    return {
        "ok": True,
        "message": f"Action completed: {entry['summary']}",
        "result_card": {
            "kind": "info",
            "data": {"tool": entry["tool"], "result": result},
        },
    }


async def cancel_pending(token: str) -> dict[str, Any]:
    """Discard a pending write action."""
    entry = _get_pending(token)
    if entry is None:
        raise ValueError("Pending action not found or expired")

    _remove_pending(token)

    return {
        "ok": True,
        "message": f"Action cancelled: {entry['summary']}",
    }


# ---------------------------------------------------------------------------
# Memory persistence
# ---------------------------------------------------------------------------

async def _process_memory_candidates(
    candidates: list[dict[str, str]],
    thread_id: str,
) -> list[dict[str, str]]:
    """Dedup and persist memory candidates. Returns saved memories."""
    saved: list[dict[str, str]] = []
    for c in candidates[:3]:
        statement = (c.get("statement") or "").strip()
        if not statement or len(statement) < 10:
            continue
        exists = await db.memory_statement_exists(statement)
        if not exists:
            await db.create_chat_memory(statement, thread_id)
            saved.append({"statement": statement})
    return saved


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_stats_tool(tool_name: str) -> bool:
    """Check if a tool produces stats-worthy data."""
    return tool_name in {
        "get_funnel_stats",
        "get_skill_roi",
        "get_market_position",
        "get_ats_audit",
    }


def _build_cards(
    tool_results: dict[str, Any],
    stats: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Build tool cards from results."""
    cards: list[dict[str, Any]] = []
    for tool_name, result in tool_results.items():
        if isinstance(result, dict) and "error" not in result:
            card_kind = _tool_to_card_kind(tool_name)
            cards.append({"kind": card_kind, "data": result})
    return cards


def _build_actions(tool_results: dict[str, Any]) -> list[dict[str, Any]]:
    """Build action buttons from tool results."""
    actions: list[dict[str, Any]] = []
    # Add resume audit "Apply" action if audit was run
    if "get_ats_audit" in tool_results:
        actions.append({
            "kind": "link",
            "label": "Open Builder",
            "href": "/builder",
        })
    return actions


def _extract_sources(tool_results: dict[str, Any]) -> list[str]:
    """Extract source labels from tool results."""
    sources: list[str] = []
    for tool_name in tool_results:
        if tool_name.startswith("get_"):
            sources.append(tool_name.replace("get_", "").replace("_", " "))
    return sources


def _tool_to_card_kind(tool_name: str) -> str:
    """Map tool name to card kind."""
    mapping = {
        "get_ats_audit": "audit",
        "get_funnel_stats": "stats",
        "get_skill_roi": "stats",
        "get_market_position": "stats",
        "get_evidence": "evidence",
        "get_job_verdict": "job",
        "search_jobs": "job",
        "get_career_summary": "info",
        "compare_resumes": "info",
        "get_applications": "info",
        "get_rejections": "info",
        "get_contacts": "info",
        "get_companies": "info",
        "get_skill_suggestions": "info",
    }
    return mapping.get(tool_name, "info")
