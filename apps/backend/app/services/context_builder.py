"""Build token-budgeted conversation context for LLM passes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CHAT_CONTEXT_MAX_TOKENS = 12_000
HISTORY_BUDGET_TOKENS = 5_000
SUMMARY_BUDGET_TOKENS = 1_000
MAX_CHARS_PER_TURN = 2_000


def _estimate_tokens(text: str) -> int:
    return len(text) // 4


@dataclass
class ChatContext:
    history_text: str
    entity_summary: str
    token_count: int


def _format_entity_summary(state: Any) -> str:
    parts: list[str] = []
    if getattr(state, "active_company", None):
        parts.append(f"company={state.active_company}")
    if getattr(state, "active_job_id", None):
        parts.append(f"job={state.active_job_id}")
    if getattr(state, "active_resume_id", None):
        parts.append(f"resume={state.active_resume_id}")
    if getattr(state, "active_task", None):
        parts.append(f"task={state.active_task}")
    if not parts:
        return "(no active entities)"
    return f"Active context: {', '.join(parts)}"


def build_chat_context(
    messages: list[dict[str, Any]],
    state: Any,
    budget_tokens: int = HISTORY_BUDGET_TOKENS,
) -> ChatContext:
    entity_summary = _format_entity_summary(state)
    entity_tokens = _estimate_tokens(entity_summary)
    remaining = budget_tokens - entity_tokens

    turns: list[str] = []
    total_tokens = entity_tokens

    for m in reversed(messages):
        role = m.get("role", "user").upper()
        content = (m.get("content") or "")[:MAX_CHARS_PER_TURN]
        line = f"{role}: {content}"
        line_tokens = _estimate_tokens(line)
        if total_tokens + line_tokens > budget_tokens:
            break
        turns.append(line)
        total_tokens += line_tokens

    turns.reverse()
    history_text = "\n".join(turns) if turns else "(no history)"

    return ChatContext(
        history_text=history_text,
        entity_summary=entity_summary,
        token_count=total_tokens,
    )
