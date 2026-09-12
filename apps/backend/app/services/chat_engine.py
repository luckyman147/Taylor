"""Chat Command Center — orchestrator.

Intent-based routing: classifies user intent, then routes to the appropriate
handler (job search, profile, resume audit, or general planner).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any

from app.config_cache import get_content_language
from app.database import db
from app.llm import complete, complete_json, get_llm_config, get_model_name
from app.prompts import (
    CHAT_ANSWER_PROMPT,
    CHAT_BASE_MODES,
    CHAT_PLANNER_PROMPT,
    CHAT_PLANNER_SYSTEM_PROMPTS,
    CHAT_THINKING_PROMPT,
    get_language_name,
    get_merged_system_prompt,
)
from app.services.chat_tools import (
    ToolRequiresConfirmation,
    execute_tool,
    get_tool_catalog_json,
)
from app.services.chat_gateway import ChatIntent, should_clarify, DEFAULT_CLARIFICATION_OPTIONS
from app.agent.runner import agent_runner
from app.agent.budget import BudgetConfig

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
        logger.warning("Pending token %s not found (may have expired or server restarted)", token[:8])
        return None
    if time.time() - entry["created_at"] > _PENDING_TTL:
        _pending_store.pop(token, None)
        logger.warning("Pending token %s expired", token[:8])
        return None
    return entry


def _remove_pending(token: str) -> None:
    _pending_store.pop(token, None)


# ---------------------------------------------------------------------------
# Conversation state (in-memory, per thread)
# ---------------------------------------------------------------------------

class ConversationState:
    """Tracks pending clarification across turns for a single thread."""

    def __init__(self) -> None:
        self.pending_clarification: bool = False
        self.clarification_options: list[str] = []
        self.previous_intent: str | None = None


# Thread ID → ConversationState (in-memory, single-worker)
_conversation_states: dict[str, ConversationState] = {}


def _get_conversation_state(thread_id: str) -> ConversationState:
    if thread_id not in _conversation_states:
        _conversation_states[thread_id] = ConversationState()
    return _conversation_states[thread_id]


_INTENT_LABELS: dict[str, str] = {
    "job_search": "Search for jobs matching your profile",
    "resume_audit": "Improve or audit your resume",
    "profile": "Review your career profile",
    "market": "Analyze market position and trends",
    "skills": "Get skill suggestions and ROI analysis",
}


async def _handle_clarification(
    thread_id: str,
    user_message: str,
    gateway: Any,
    _emit,
) -> dict[str, Any]:
    """Handle ambiguous/unclear user messages by asking clarifying questions."""
    from app.schemas.agent_events import TurnCompleteEvent

    state = _get_conversation_state(thread_id)

    # If we already asked and user is now responding, try to resolve
    if state.pending_clarification and state.clarification_options:
        resolved = _resolve_clarification_reply(user_message, state.clarification_options)
        if resolved:
            state.pending_clarification = False
            state.clarification_options = []
            # Route to the resolved intent by re-classifying with more context
            from app.services.chat_gateway import classify_intent as _classify
            new_decision = await _classify(resolved)
            # Inject the resolved intent as context for the planner
            gateway.intent = new_decision.intent
            gateway.preferred_tools = new_decision.preferred_tools
            gateway.confidence = new_decision.confidence
            gateway.needs_clarification = False
            return None  # Signal to continue normal routing
        # User response didn't resolve — still ambiguous
        options_text = "\n".join(
            f"  {i+1}. {label}"
            for i, label in enumerate(state.clarification_options)
        )
        assistant_content = (
            "I'm not sure which one you mean. Could you pick from these?\n\n"
            + options_text
        )
        clarify_card = {
            "kind": "clarify",
            "data": {
                "options": [
                    {"label": _INTENT_LABELS.get(intent, intent), "intent": intent}
                    for intent in state.clarification_options
                ],
            },
        }
        await db.add_chat_message(thread_id, "assistant", assistant_content, envelope={"cards": [clarify_card]})
        result = {
            "assistant_content": assistant_content,
            "cards": [clarify_card],
            "actions": [],
            "stats": None,
            "pending_action": None,
            "memory_candidates": [],
            "followups": [],
            "sources": [],
        }
        await _emit(TurnCompleteEvent(data=result))
        return result

    # First clarification — show options
    suggested = gateway.suggested_intents or ["job_search", "resume_audit", "profile"]
    options = [_INTENT_LABELS.get(intent, intent) for intent in suggested]
    state.pending_clarification = True
    state.clarification_options = suggested

    options_text = "\n".join(
        f"  {i+1}. {label}"
        for i, label in enumerate(options)
    )
    assistant_content = (
        "I can help with several career tasks. What would you like to do?\n\n"
        + options_text
    )
    clarify_card = {
        "kind": "clarify",
        "data": {
            "options": [
                {"label": label, "intent": intent}
                for intent, label in zip(suggested, options)
            ],
        },
    }
    await db.add_chat_message(thread_id, "assistant", assistant_content, envelope={"cards": [clarify_card]})
    result = {
        "assistant_content": assistant_content,
        "cards": [clarify_card],
        "actions": [],
        "stats": None,
        "pending_action": None,
        "memory_candidates": [],
        "followups": [],
        "sources": [],
    }
    await _emit(TurnCompleteEvent(data=result))
    return result


def _resolve_clarification_reply(
    user_message: str,
    options: list[str],
) -> str | None:
    """Try to match a user reply to one of the clarification options.

    Returns the resolved intent string or None if unclear.
    """
    msg = user_message.strip().lower()

    # Numbered selection: "1", "option 2"
    num_match = re.search(r"(?:option\s*)?(\d+)", msg)
    if num_match:
        idx = int(num_match.group(1)) - 1
        if 0 <= idx < len(options):
            return options[idx]

    # Ordinal words: "first", "second", "third", "the first one"
    _ORDINALS = {
        "first": 0, "1st": 0,
        "second": 1, "2nd": 1,
        "third": 2, "3rd": 2,
        "fourth": 3, "4th": 3,
        "fifth": 4, "5th": 4,
    }
    for word, idx in _ORDINALS.items():
        if word in msg and idx < len(options):
            return options[idx]

    # Keyword matching against intent labels (most specific first)
    _KEYWORD_MAP = {
        "job": "job_search",
        "jobs": "job_search",
        "search": "job_search",
        "find": "job_search",
        "resume": "resume_audit",
        "cv": "resume_audit",
        "audit": "resume_audit",
        "profile": "profile",
        "career": "profile",
        "market": "market",
        "trends": "market",
        "skills": "skills",
        "skill": "skills",
        "advice": "profile",
        "improve": "resume_audit",
    }
    for keyword, intent in _KEYWORD_MAP.items():
        if keyword in msg:
            return intent

    # "yes"/"yeah" with single option
    if msg in ("yes", "yeah", "yep", "y", "sure", "ok") and len(options) == 1:
        return options[0]

    return None


# ---------------------------------------------------------------------------
# Job search parameter extraction (regex only)
# ---------------------------------------------------------------------------

_ROLE_PATTERN = re.compile(
    r"(?:find|search|look\s+for|hiring|show\s+me)\s+"
    r"(?:me\s+)?(?:some\s+)?(?:a\s+)?"
    r"(.+?)(?:\s+(?:in|at|near|from|jobs?|positions?|roles?|openings?|vacancies?))",
    re.IGNORECASE,
)

_LOCATION_PATTERN = re.compile(
    r"\b(?:in|at|near|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
)

_REMOTE_PATTERN = re.compile(
    r"\b(remote|work\s+from\s+home|wfh|hybrid|onsite|on-site)\b",
    re.IGNORECASE,
)

_SENIORITY_PATTERN = re.compile(
    r"\b(junior|senior|lead|principal|staff|intern|entry[- ]level|mid[- ]level|chief|head)\b",
    re.IGNORECASE,
)

_SKILLS_PATTERN = re.compile(
    r"\b(python|javascript|typescript|react|angular|vue|node\.?js|java|go|rust|"
    r"django|fastapi|flask|spring|sql|postgresql|mongodb|docker|kubernetes|aws|"
    r"gcp|azure|terraform|graphql|rest|figma|tailwind|css|html)\b",
    re.IGNORECASE,
)


def _extract_job_params(message: str) -> dict[str, Any]:
    """Extract job search parameters from user message using regex."""
    params: dict[str, Any] = {}

    role_match = _ROLE_PATTERN.search(message)
    if role_match:
        role = role_match.group(1).strip()
        role = re.sub(r"\s+(and|or|with|that|who|the)$", "", role, flags=re.IGNORECASE)
        if len(role) > 3:
            params["role"] = role

    loc_match = _LOCATION_PATTERN.search(message)
    if loc_match:
        params["location"] = loc_match.group(1)

    remote_match = _REMOTE_PATTERN.search(message)
    if remote_match:
        params["remote"] = remote_match.group(1).lower()

    sen_match = _SENIORITY_PATTERN.search(message)
    if sen_match:
        params["seniority"] = sen_match.group(1).lower()

    skills = _SKILLS_PATTERN.findall(message)
    if skills:
        params["skills"] = list(set(s.lower() for s in skills))

    return params


def _build_search_query(params: dict[str, Any]) -> str:
    """Build a search query from extracted params."""
    parts = []
    if params.get("role"):
        parts.append(params["role"])
    if params.get("skills"):
        parts.extend(params["skills"])
    if params.get("seniority"):
        parts.append(params["seniority"])
    if params.get("location"):
        parts.append(params["location"])
    if params.get("remote") in ("remote", "work from home", "wfh"):
        parts.append("remote")
    return " ".join(parts) if parts else "software engineer"


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


def _build_conversation_context(messages: list[dict[str, Any]]) -> str:
    """Build compact keyword-focused context from recent messages for the answer LLM.

    Extracts key entities (resume names, scores, skills, questions) so the
    answer maintains continuity without passing the full history.
    """
    recent = messages[-10:]
    resumes: set[str] = []
    scores: list[str] = []
    skills_mentioned: set[str] = set()
    questions: list[str] = []
    target_roles: set[str] = set()
    job_results: list[str] = []

    seen_resumes: set[str] = set()

    for m in recent:
        content = m.get("content") or ""
        role = m.get("role", "user")

        # Extract resume filenames from "I uploaded" pattern
        for match in re.finditer(r'uploaded "([^"]+)"', content):
            name = match.group(1)
            if name not in seen_resumes:
                seen_resumes.add(name)
                resumes.append(name)

        # Extract from envelope cards
        envelope = m.get("envelope") or {}
        for card in envelope.get("cards", []):
            kind = card.get("kind", "")
            data = card.get("data", {})
            if kind == "file":
                fname = data.get("filename", "")
                if fname and fname not in seen_resumes:
                    seen_resumes.add(fname)
                    resumes.append(fname)
            if kind == "audit":
                overall = data.get("overall_score") or data.get("Overall Score")
                if overall is not None:
                    scores.append(f"ATS:{overall}")
                for k in ("skills_coverage", "market_alignment", "quantification", "section_completeness", "action_verbs"):
                    v = data.get(k)
                    if v is not None:
                        scores.append(f"{k}:{v}")
            if kind == "info":
                sk = data.get("skills") or data.get("Skills")
                if isinstance(sk, list):
                    for s in sk[:10]:
                        name = s.get("name") if isinstance(s, dict) else str(s)
                        skills_mentioned.add(name)
                tr = data.get("target_roles") or data.get("Target")
                if isinstance(tr, list):
                    for r in tr:
                        target_roles.add(str(r))
                elif isinstance(tr, str):
                    target_roles.add(tr)
            if kind == "job_list":
                jobs = data.get("jobs", [])
                if jobs:
                    for j in jobs[:10]:
                        title = j.get("title", "N/A")
                        company = j.get("company", "N/A")
                        loc = j.get("location", "")
                        job_results.append(f"{title} at {company} ({loc})" if loc else f"{title} at {company}")

        # Track user questions
        if role == "user":
            q = content[:120].replace("\n", " ")
            questions.append(q)

    # Format compact output
    parts: list[str] = []
    if job_results:
        parts.append(f"Previous job search results ({len(job_results)} jobs):\n" + "\n".join(f"  - {s}" for s in job_results))
    if resumes:
        parts.append(f"Resumes: {', '.join(resumes)}")
    if scores:
        parts.append(f"Scores: {', '.join(scores)}")
    if skills_mentioned:
        parts.append(f"Skills discussed: {', '.join(list(skills_mentioned)[:12])}")
    if target_roles:
        parts.append(f"Target roles: {', '.join(target_roles)}")
    if questions:
        parts.append(f"User asked: {'; '.join(questions[-5:])}")

    return "\n".join(parts) if parts else "(no prior context)"


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

async def _run_turn_core(
    thread_id: str,
    user_message: str,
    resume_id: str | None,
    _emit,
    _try_agent_loop_fn,
) -> dict[str, Any]:
    """Shared chat turn logic: gateway → agent loop → planner → tools → answer.

    _emit: async callback for streaming events (no-op in non-streaming path).
    _try_agent_loop_fn: async callable for the agent loop (streaming or not).
    """
    from app.schemas.agent_events import (
        AgentStatusEvent,
        AgentStatus,
        ToolExecutionEvent,
        ToolExecStatus,
        TurnCompleteEvent,
    )

    thread = await db.get_chat_thread(thread_id)
    if not thread:
        raise ValueError(f"Thread {thread_id} not found")

    mode = thread.get("mode", "ask")
    skills = thread.get("skills", [])
    language = get_content_language()
    output_language = get_language_name(language)

    # Load context
    messages = await db.list_chat_messages(thread_id, limit=50)
    memories = await db.list_active_chat_memories(limit=20)

    # --- Gateway: fast intent classification (no LLM call) ---
    from app.services.chat_gateway import classify_intent
    gateway = await classify_intent(user_message, resume_id=resume_id)

    # --- Contextual follow-up: only if there are previous job results to reference ---
    if gateway.contextual_follow_up:
        has_job_context = any(
            card.get("kind") == "job_list"
            for m in messages
            if m.get("role") == "assistant"
            for card in (m.get("envelope") or {}).get("cards", [])
        )
        if has_job_context:
            return await _handle_contextual_follow_up(
                thread_id, user_message, gateway, _emit, messages, memories,
            )
        # No job context — fall through to normal planner path

    # --- Clarification: gateway detected ambiguity ---
    if gateway.needs_clarification or gateway.intent == ChatIntent.CLARIFY:
        logger.info("Gateway: needs_clarification=True, intent=%s, confidence=%.2f",
                     gateway.intent, gateway.confidence)
        clarification_result = await _handle_clarification(
            thread_id, user_message, gateway, _emit,
        )
        if clarification_result is not None:
            return clarification_result
        # clarification resolved — continue with updated gateway intent

    # --- Intent-based routing ---
    if gateway.intent == ChatIntent.JOB_SEARCH:
        return await _handle_job_search(
            thread_id, user_message, gateway, _emit, messages, memories,
        )

    if gateway.intent in (ChatIntent.PROFILE, ChatIntent.APPLICATIONS,
                          ChatIntent.SKILLS, ChatIntent.MARKET):
        return await _handle_direct_tool(
            thread_id, user_message, gateway, _emit, messages, memories,
        )

    # --- Resume audit: selection flow ---
    if gateway.needs_selection:
        await db.add_chat_message(thread_id, "user", user_message, envelope={"resume_id": resume_id} if resume_id else None)
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
        result = {
            "assistant_content": assistant_content,
            "cards": envelope["cards"],
            "actions": envelope["actions"],
            "stats": None,
            "pending_action": None,
            "memory_candidates": [],
            "followups": envelope["followups"],
            "sources": [],
        }
        await _emit(TurnCompleteEvent(data=result))
        return result

    # If gateway determined a specific resume, inject it into context
    gateway_context = ""
    gateway_resume_filename = ""
    if gateway.resume_id:
        gateway_context = f"\n[GATEWAY: User wants to audit resume_id={gateway.resume_id}. Call get_ats_audit with resume_id='{gateway.resume_id}'.]"
        logger.info("Gateway context injected: resume_id=%s", gateway.resume_id)
        try:
            _resume = await db.get_resume(gateway.resume_id)
            if _resume:
                gateway_resume_filename = _resume.get("title") or _resume.get("filename") or "Resume"
        except Exception:
            gateway_resume_filename = "Resume"

    # --- Agent Loop ---
    await _emit(AgentStatusEvent(status=AgentStatus.DISCOVERING_TOOLS, message="Finding the best tools for your request..."))

    agent_result = await _try_agent_loop_fn(user_message, mode, skills, thread_id, messages, memories)
    if agent_result is not None:
        await db.add_chat_message(thread_id, "user", user_message, envelope={"resume_id": resume_id} if resume_id else None)
        envelope = {
            "cards": agent_result.get("cards", []),
            "actions": [],
            "stats": None,
            "pending_action": None,
            "followups": ["Tell me more", "What else can you do?"],
            "sources": [],
        }
        await db.add_chat_message(thread_id, "assistant", agent_result["answer"], envelope=envelope)
        config = get_llm_config()
        result = {
            "assistant_content": agent_result["answer"],
            "cards": envelope["cards"],
            "actions": envelope["actions"],
            "stats": None,
            "pending_action": None,
            "memory_candidates": [],
            "followups": envelope["followups"],
            "sources": [],
            "model_info": {"provider": config.provider, "model": config.model},
        }
        await _emit(TurnCompleteEvent(data=result))
        return result

    # --- Standard Planner Path ---
    catalog_json = get_tool_catalog_json(mode=mode, skills=skills)
    tool_catalog_text = "\n".join(
        f"- {t['name']}{'(' + ', '.join(p for p, s in t['params'].items() if s.get('required')) + ')' if t['params'] else ''}: {t.get('description', '')}"
        for t in catalog_json
    )

    # Phase 1: Plan
    await _emit(AgentStatusEvent(status=AgentStatus.PLANNING, message="Planning which tools to use..."))

    planner_prompt = CHAT_PLANNER_PROMPT.format(
        active_memories=_format_memories(memories),
        history=_format_history(messages),
        tool_catalog=tool_catalog_text,
        output_language=output_language,
    ) + gateway_context

    from app.prompts import get_merged_system_prompt
    system_prompt = get_merged_system_prompt(mode, skills)

    try:
        plan = await complete_json(
            prompt=planner_prompt,
            system_prompt=system_prompt,
            schema_type="chat_plan",
        )
    except Exception as e:
        logger.warning("Planner LLM failed, falling back to no-tool answer: %s", e)
        plan = {"tool_calls": [], "followups": [], "memory_candidates": [], "title": ""}

    tool_calls = plan.get("tool_calls", [])
    followups = plan.get("followups", [])
    memory_candidates = plan.get("memory_candidates", [])
    plan_title = plan.get("title", "")

    # Planner-level clarification fallback (gateway missed it)
    # BUT: if the gateway said needs_clarification=False, override the planner's clarify
    # (the user's intent was clear — planner may have been confused)
    if plan.get("intent") == "clarify" and not tool_calls:
        if not gateway.needs_clarification:
            logger.info("Planner returned clarify but gateway says intent is clear — overriding to query")
            plan["intent"] = "query"
        else:
            logger.info("Planner returned clarify intent with %d questions", len(followups))
            state = _get_conversation_state(thread_id)
            state.pending_clarification = True
            state.clarification_options = followups

            options_text = "\n".join(
                f"  {i+1}. {q}" for i, q in enumerate(followups)
            )
            assistant_content = (
                "I want to make sure I understand correctly. Could you clarify?\n\n"
                + options_text
            )
            clarify_card = {
                "kind": "clarify",
                "data": {
                    "options": [
                        {"label": q, "intent": "general"}
                        for q in followups
                    ],
                },
            }
            await db.add_chat_message(thread_id, "assistant", assistant_content, envelope={"cards": [clarify_card]})
            result = {
                "assistant_content": assistant_content,
                "cards": [clarify_card],
                "actions": [],
                "stats": None,
                "pending_action": None,
                "memory_candidates": [],
                "followups": followups,
            "sources": [],
        }
        await _emit(TurnCompleteEvent(data=result))
        return result

    if plan_title and len(messages) <= 1:
        try:
            await db.update_chat_thread(thread_id, title=plan_title[:80])
        except Exception:
            pass

    # Phase 2: Execute tools
    await _emit(AgentStatusEvent(status=AgentStatus.EXECUTING, message=f"Running {len(tool_calls)} tool(s)..."))

    tool_results: dict[str, Any] = {}
    stats: dict[str, Any] | None = None
    pending_action: dict[str, Any] | None = None

    for call in tool_calls:
        tool_name = call.get("tool", "")
        tool_args = call.get("args", {})
        if not tool_name:
            continue

        await _emit(ToolExecutionEvent(tool=tool_name, status=ToolExecStatus.RUNNING))

        try:
            result = await execute_tool(tool_name, tool_args)
            tool_results[tool_name] = result
            await _emit(ToolExecutionEvent(tool=tool_name, status=ToolExecStatus.SUCCESS))
            if _is_stats_tool(tool_name):
                stats = result
        except ToolRequiresConfirmation as e:
            token = _store_pending(e.tool, e.args, e.summary)
            pending_action = {
                "token": token,
                "tool": e.tool,
                "summary": e.summary,
            }
            await _emit(ToolExecutionEvent(tool=tool_name, status=ToolExecStatus.SUCCESS, message="Pending confirmation"))
        except Exception as e:
            logger.warning("Tool %s failed: %s", tool_name, e)
            tool_results[tool_name] = {"error": str(e)}
            await _emit(ToolExecutionEvent(tool=tool_name, status=ToolExecStatus.FAILED, message=str(e)))

    # Phase 2.5: RAG
    await _emit(AgentStatusEvent(status=AgentStatus.EVALUATING, message="Gathering additional context..."))

    rag_context = ""
    try:
        from app.services.rag import rag_index
        from app.services.rag import build_context_block
        rag_results = await rag_index.query(user_message, top_k=3, rerank=True)
        rag_input = {}
        for source_type, items in rag_results.items():
            rag_input[source_type] = items
        rag_context = build_context_block(rag_input)
    except Exception:
        pass

    # Phase 3: Generate answer (two-pass: think → answer)
    await _emit(AgentStatusEvent(status=AgentStatus.GENERATING_ANSWER, message="Preparing your answer..."))

    career_data = await _build_career_context()
    resume_context = f"\nRESUME BEING ANALYZED: {gateway_resume_filename} (id={gateway.resume_id})" if gateway.resume_id else ""
    conversation_ctx = _build_conversation_context(messages)

    thinking_prompt = CHAT_THINKING_PROMPT.format(
        user_message=user_message,
        conversation_context=conversation_ctx,
        career_data=career_data,
        tool_stats=json.dumps(tool_results, ensure_ascii=False, default=str) + resume_context,
        rag_context=rag_context,
        active_memories=_format_memories(memories),
        mode=mode,
        output_language=output_language,
    )

    try:
        thinking = await complete(
            prompt=thinking_prompt,
            system_prompt=system_prompt,
            max_tokens=2048,
            temperature=0.5,
        )
    except Exception as e:
        logger.warning("Thinking pass failed: %s", e)
        thinking = ""

    answer_prompt = CHAT_ANSWER_PROMPT.format(
        user_message=user_message,
        conversation_context=conversation_ctx,
        career_data=career_data,
        tool_stats=json.dumps(tool_results, ensure_ascii=False, default=str) + resume_context,
        rag_context=rag_context,
        active_memories=_format_memories(memories),
        mode=mode,
        output_language=output_language,
    )
    answer_with_thinking = f"{answer_prompt}\n\nYOUR DETAILED ANALYSIS:\n{thinking}\n\nNow generate the final polished answer based on your analysis above. Be thorough, specific, and actionable."

    try:
        assistant_content = await complete(
            prompt=answer_with_thinking,
            system_prompt=system_prompt,
        )
    except Exception as e:
        logger.error("Answer generation failed: %s", e)
        assistant_content = (
            "I wasn't able to generate a complete answer right now. "
            "Please try again in a moment, or check your API configuration."
        )

    # Persist user message
    await db.add_chat_message(thread_id, "user", user_message, envelope={"resume_id": resume_id} if resume_id else None)

    # Build envelope for assistant message
    cards = _build_cards(tool_results, stats)
    if gateway.resume_id:
        cards.insert(0, {"kind": "file", "data": {"filename": gateway_resume_filename, "resume_id": gateway.resume_id}})
    envelope = {
        "cards": cards,
        "actions": _build_actions(tool_results),
        "stats": stats,
        "pending_action": pending_action,
        "followups": followups,
        "sources": _extract_sources(tool_results),
    }

    # Persist assistant message
    await db.add_chat_message(thread_id, "assistant", assistant_content, envelope=envelope)

    # Process memory candidates (dedup, cap at 3)
    saved_memories = await _process_memory_candidates(memory_candidates, thread_id)

    # Include model info
    config = get_llm_config()
    model_info = {"provider": config.provider, "model": config.model}

    result = {
        "assistant_content": assistant_content,
        "cards": envelope["cards"],
        "actions": envelope["actions"],
        "stats": stats,
        "pending_action": pending_action,
        "memory_candidates": saved_memories,
        "followups": followups,
        "sources": envelope["sources"],
        "model_info": model_info,
    }
    await _emit(TurnCompleteEvent(data=result))
    return result


# ---------------------------------------------------------------------------
# Intent handlers
# ---------------------------------------------------------------------------

async def _handle_job_search(
    thread_id: str,
    user_message: str,
    gateway: Any,
    _emit,
    messages: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Handle job search intent: extract params → confirm → search."""
    from app.schemas.agent_events import AgentStatusEvent, AgentStatus, TurnCompleteEvent

    params = _extract_job_params(user_message)

    # If vague — show interactive search form
    if not params.get("role") and not params.get("skills"):
        await _emit(AgentStatusEvent(
            status=AgentStatus.THINKING,
            message="What kind of role are you looking for?",
        ))

        assistant_content = (
            "Use the form below to describe the role, location, and skills you're looking for. "
            "You can pick from the suggestions or type your own."
        )

        await db.add_chat_message(thread_id, "user", user_message)
        envelope = {
            "cards": [{"kind": "job_search_form", "data": {}}],
            "actions": [],
            "stats": None,
            "pending_action": None,
            "followups": [],
            "sources": [],
        }
        await db.add_chat_message(thread_id, "assistant", assistant_content, envelope=envelope)

        result = {
            "assistant_content": assistant_content,
            "cards": [{"kind": "job_search_form", "data": {}}],
            "actions": [],
            "stats": None,
            "pending_action": None,
            "memory_candidates": [],
            "followups": [],
            "sources": [],
        }
        await _emit(TurnCompleteEvent(data=result))
        return result

    # Params extracted — stage for confirmation
    query = _build_search_query(params)

    summary_parts = [f"Search for: {query}"]
    if params.get("role"):
        summary_parts.append(f"Role: {params['role']}")
    if params.get("location"):
        summary_parts.append(f"Location: {params['location']}")
    if params.get("skills"):
        summary_parts.append(f"Skills: {', '.join(params['skills'])}")
    summary_parts.append("Sources: LinkedIn, Exa, RSS, RemoteOK, Keejob")

    token = _store_pending(
        tool="search_mcp_jobs",
        args={
            "query": query,
            "limit": 10,
            "seniority": params.get("seniority", ""),
            "location": params.get("location", ""),
            "remote": params.get("remote", ""),
        },
        summary=" | ".join(summary_parts),
    )

    await _emit(AgentStatusEvent(
        status=AgentStatus.DISCOVERING_TOOLS,
        message=f"Found search parameters for {params.get('role', 'jobs')}...",
    ))

    # Build confirmation message
    role_display = params.get("role", "jobs")
    location_display = f" in **{params['location']}**" if params.get("location") else ""
    skills_display = f" matching **{', '.join(params['skills'])}**" if params.get("skills") else ""
    remote_display = " (**remote**)" if params.get("remote") in ("remote", "work from home", "wfh") else ""

    assistant_content = (
        f"I'll search for **{role_display}** jobs{location_display}{skills_display}{remote_display} "
        f"across LinkedIn, Exa, RSS feeds, RemoteOK, and Keejob. "
        f"Click **Execute** to start the search."
    )

    await db.add_chat_message(thread_id, "user", user_message)
    pending_action = {
        "token": token,
        "tool": "search_mcp_jobs",
        "summary": " | ".join(summary_parts),
    }
    envelope = {
        "cards": [],
        "actions": [],
        "stats": None,
        "pending_action": pending_action,
        "followups": [
            f"Search for {role_display} in another location",
            "Filter by remote only",
            "Show job market trends",
        ],
        "sources": [],
    }
    await db.add_chat_message(thread_id, "assistant", assistant_content, envelope=envelope)

    result = {
        "assistant_content": assistant_content,
        "cards": [],
        "actions": [],
        "stats": None,
        "pending_action": pending_action,
        "memory_candidates": [],
        "followups": envelope["followups"],
        "sources": [],
    }
    await _emit(TurnCompleteEvent(data=result))
    return result


async def _handle_direct_tool(
    thread_id: str,
    user_message: str,
    gateway: Any,
    _emit,
    messages: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Handle intents that map directly to specific tools (profile, applications, skills, market)."""
    from app.schemas.agent_events import AgentStatusEvent, AgentStatus, TurnCompleteEvent

    await _emit(AgentStatusEvent(
        status=AgentStatus.RETRIEVING_CONTEXT,
        message="Loading your data...",
    ))

    tool_results: dict[str, Any] = {}
    for tool_name in gateway.preferred_tools:
        try:
            result = await execute_tool(tool_name, {})
            tool_results[tool_name] = result
        except Exception as e:
            logger.warning("Direct tool %s failed: %s", tool_name, e)
            tool_results[tool_name] = {"error": str(e)}

    await _emit(AgentStatusEvent(
        status=AgentStatus.GENERATING_ANSWER,
        message="Preparing your answer...",
    ))

    language = get_content_language()
    output_language = get_language_name(language)
    career_data = await _build_career_context()
    conversation_ctx = _build_conversation_context(messages)
    system_prompt = get_merged_system_prompt("ask", [])

    tool_summary = json.dumps(tool_results, ensure_ascii=False, default=str)

    answer_prompt = CHAT_ANSWER_PROMPT.format(
        user_message=user_message,
        conversation_context=conversation_ctx,
        career_data=career_data,
        tool_stats=tool_summary,
        rag_context="",
        active_memories=_format_memories(memories),
        mode="ask",
        output_language=output_language,
    )

    try:
        assistant_content = await complete(
            prompt=answer_prompt,
            system_prompt=system_prompt,
            max_tokens=2048,
            temperature=0.5,
        )
    except Exception as e:
        logger.error("Direct tool answer LLM failed: %s", e)
        assistant_content = (
            f"Here's what I found:\n\n"
            f"```json\n{tool_summary[:2000]}\n```\n\n"
            f"(Generated without AI summarization)"
        )

    await db.add_chat_message(thread_id, "user", user_message)
    cards = _build_cards(tool_results, None)
    envelope = {
        "cards": cards,
        "actions": [],
        "stats": None,
        "pending_action": None,
        "followups": [],
        "sources": _extract_sources(tool_results),
    }
    await db.add_chat_message(thread_id, "assistant", assistant_content, envelope=envelope)

    config = get_llm_config()
    result = {
        "assistant_content": assistant_content,
        "cards": cards,
        "actions": [],
        "stats": None,
        "pending_action": None,
        "memory_candidates": [],
        "followups": [],
        "sources": envelope["sources"],
        "model_info": {"provider": config.provider, "model": config.model},
    }
    await _emit(TurnCompleteEvent(data=result))
    return result


# ---------------------------------------------------------------------------
# Contextual follow-up handler
# ---------------------------------------------------------------------------

async def _handle_contextual_follow_up(
    thread_id: str,
    user_message: str,
    gateway: Any,
    _emit: Any,
    messages: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    """Handle follow-up messages that reference previous results (e.g. 'give me the best of that list').

    Loads the previous job results from conversation history and passes them
    to the LLM for analysis without re-fetching.
    """
    from app.config_cache import get_content_language, get_language_name
    from app.llm import complete
    from app.schemas.agent_events import (
        AgentStatusEvent, AgentStatus, TurnCompleteEvent,
    )

    language = get_content_language()
    output_language = get_language_name(language)

    await _emit(AgentStatusEvent(
        status=AgentStatus.THINKING,
        message="Analyzing previous results...",
    ))

    # Find the last assistant message with job_list cards
    previous_jobs = []
    for m in reversed(messages):
        if m.get("role") != "assistant":
            continue
        envelope = m.get("envelope") or {}
        for card in envelope.get("cards", []):
            if card.get("kind") == "job_list":
                data = card.get("data", {})
                previous_jobs = data.get("jobs", [])
                break
        if previous_jobs:
            break

    # Build context with previous results
    jobs_context = ""
    if previous_jobs:
        job_lines = []
        for i, j in enumerate(previous_jobs[:15], 1):
            title = j.get("title", "N/A")
            company = j.get("company", "N/A")
            location = j.get("location", "")
            url = j.get("url", "")
            source = j.get("source", "")
            snippet = j.get("description_snippet", "")
            line = f"{i}. **{title}** at {company}"
            if location:
                line += f" ({location})"
            if source:
                line += f" [{source}]"
            if snippet:
                line += f"\n   {snippet[:150]}"
            if url:
                line += f"\n   {url}"
            job_lines.append(line)
        jobs_context = "\n\n".join(job_lines)
    else:
        jobs_context = "(No previous job results found in conversation history)"

    conversation_context = _build_conversation_context(messages)

    prompt = (
        f"You are Taylor's career assistant. The user is following up on previous job search results.\n\n"
        f"USER MESSAGE: {user_message}\n\n"
        f"PREVIOUS JOB SEARCH RESULTS:\n{jobs_context}\n\n"
        f"CONVERSATION CONTEXT:\n{conversation_context}\n\n"
        f"OUTPUT LANGUAGE: {output_language}\n\n"
        f"RULES:\n"
        f"1. Answer in Markdown (short sections, bullet points).\n"
        f"2. Analyze, filter, rank, or summarize the previous job results as requested.\n"
        f"3. Reference specific jobs by title and company.\n"
        f"4. Be concise, specific, and actionable.\n"
        f"5. Do NOT re-fetch jobs — use only the results provided above.\n"
    )

    answer_text = await complete(
        prompt,
        max_tokens=2000,
    )

    await _emit(AgentStatusEvent(status=AgentStatus.COMPLETE, message="Done"))

    envelope = {
        "cards": [],
        "actions": [],
        "stats": None,
        "pending_action": None,
        "followups": [],
        "sources": [],
    }
    await db.add_chat_message(thread_id, "user", user_message)
    await db.add_chat_message(thread_id, "assistant", answer_text, envelope=envelope)

    result = {
        "assistant_content": answer_text,
        "cards": [],
        "actions": [],
        "stats": None,
        "pending_action": None,
        "memory_candidates": [],
        "followups": [],
        "sources": [],
        "model_info": None,
    }
    await _emit(TurnCompleteEvent(data=result))
    return result


async def run_turn(
    thread_id: str,
    user_message: str,
    resume_id: str | None = None,
) -> dict[str, Any]:
    """Execute a full chat turn: plan → tool calls → answer.

    Returns a dict matching TurnResponse schema.
    """

    async def _noop_emit(_event):
        pass

    return await _run_turn_core(thread_id, user_message, resume_id, _emit=_noop_emit, _try_agent_loop_fn=_try_agent_loop)


# ---------------------------------------------------------------------------
# Streaming turn (SSE)
# ---------------------------------------------------------------------------

async def run_turn_stream(
    thread_id: str,
    user_message: str,
    resume_id: str | None = None,
    event_queue: asyncio.Queue | None = None,
) -> dict[str, Any]:
    """Execute a full chat turn with event streaming.

    Events are put into event_queue as the turn progresses.
    Returns the final TurnResponse dict.
    """
    _emit = _make_emitter(event_queue)

    async def _agent_loop_stream(
        user_message: str,
        mode: str,
        skills: list[str],
        thread_id: str,
        messages: list[dict[str, Any]],
        memories: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        return await _try_agent_loop_stream(user_message, mode, skills, thread_id, messages, memories, _emit)

    return await _run_turn_core(thread_id, user_message, resume_id, _emit=_emit, _try_agent_loop_fn=_agent_loop_stream)


def _make_emitter(event_queue: asyncio.Queue | None):
    """Create a non-blocking emit function for a queue."""
    async def _emit(event):
        if event_queue is not None:
            try:
                event_queue.put_nowait(event)
            except Exception:
                pass
            # Yield control so the generator can drain the queue
            await asyncio.sleep(0)
    return _emit


async def _try_agent_loop_stream(
    user_message: str,
    mode: str,
    skills: list[str],
    thread_id: str,
    messages: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    _emit,
) -> dict[str, Any] | None:
    """Try agent loop with streaming events."""
    msg_lower = user_message.lower()
    is_complex = (
        any(p in msg_lower for p in _COMPLEX_PATTERNS)
        or any(rx.search(msg_lower) for rx in _COMPLEX_PATTERNS_RE)
    )
    agent_mode = CHAT_BASE_MODES.get(mode, {}).get("agent_loop", False)
    if not is_complex and not agent_mode:
        return None

    import asyncio
    from app.schemas.agent_events import AgentStatusEvent, AgentStatus

    await _emit(AgentStatusEvent(status=AgentStatus.PLANNING, message="Agent planning autonomous execution..."))

    context = {
        "mode": mode,
        "skills": skills,
        "thread_id": thread_id,
        "history": _format_history(messages, limit=10),
        "memories": _format_memories(memories),
    }

    try:
        # Run agent loop — events flow directly to _emit (real-time, no buffering)
        result = await agent_runner.run(
            query=user_message,
            mode=mode,
            skills=skills,
            context=context,
            budget_config=BudgetConfig(
                max_iterations=4 if mode == "search" else 3,
                max_tool_calls=15 if mode == "search" else 8,
                max_execution_time_ms=60000 if mode == "search" else 25000,
            ),
            emit_fn=_emit,
        )

        answer = result.get("answer", "")
        if answer and len(answer) > 20:
            cards = []
            for tc in result.get("tool_calls", []):
                if tc.get("success"):
                    cards.append({
                        "kind": "info",
                        "data": {"tool": tc["tool"], "status": "completed"},
                    })
            return {"answer": answer, "cards": cards}

    except Exception as e:
        logger.warning("Agent loop failed, falling through to planner: %s", e)

    return None


# ---------------------------------------------------------------------------
# Confirm / Cancel
# ---------------------------------------------------------------------------

async def confirm_pending(token: str, thread_id: str) -> dict[str, Any]:
    """Execute a previously pending write tool and persist results to conversation."""
    from app.services.chat_tools import execute_tool, execute_tool_confirmed

    entry = _get_pending(token)
    if entry is None:
        raise ValueError("Pending action not found or expired")

    _remove_pending(token)

    # search_mcp_jobs is a read tool — execute directly
    if entry["tool"] == "search_mcp_jobs":
        result = await execute_tool(entry["tool"], entry["args"])
    else:
        result = await execute_tool_confirmed(entry["tool"], entry["args"])

    # Persist the execution result as a chat message so the LLM has context
    jobs = result.get("jobs", [])
    result_text = result.get("query", entry["summary"])
    if jobs:
        job_lines = [f"{j.get('title', 'N/A')} at {j.get('company', 'N/A')} ({j.get('location', 'N/A')})" for j in jobs[:10]]
        result_text = (
            f"Job search completed. Found {result.get('total_results', len(jobs))} results "
            f"({len(jobs)} returned) from sources: {', '.join(result.get('sources', {}).keys())}.\n\n"
            f"Top results:\n" + "\n".join(f"- {line}" for line in job_lines)
        )
    else:
        error = result.get("error")
        result_text = f"Job search completed with no results." + (f" Error: {error}" if error else "")

    await db.add_chat_message(thread_id, "user", f"Executed: {entry['summary']}")
    await db.add_chat_message(
        thread_id,
        "assistant",
        result_text,
        envelope={
            "cards": [{"kind": "job_list", "data": result}],
            "actions": [],
            "stats": None,
            "pending_action": None,
            "followups": [
                "Give me the best of that list",
                "Filter by remote only",
                "Show more results",
            ],
            "sources": list(result.get("sources", {}).keys()),
        },
    )

    return {
        "ok": True,
        "message": f"Action completed: {entry['summary']}",
        "result_card": {
            "kind": "job_list",
            "data": result,
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
# Agent loop (optional path for complex queries)
# ---------------------------------------------------------------------------

# Complex query patterns that benefit from the autonomous agent loop
_COMPLEX_PATTERNS = [
    "analysis", "analyze", "evaluate", "assess",
    "research", "discover", "explore",
    "market position", "industry trends",
    "what skills", "what companies", "what roles",
]
_COMPLEX_PATTERNS_RE = [
    re.compile(r'\bhow\s+do\s+i\s+improve\b'),
    re.compile(r'\bwhat\s+are\s+the\s+best\b'),
    re.compile(r'\bwhat\s+should\s+i\b'),
    re.compile(r'\bsalary\b'),
]


async def _try_agent_loop(
    user_message: str,
    mode: str,
    skills: list[str],
    thread_id: str,
    messages: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Try to handle a query with the autonomous agent loop.

    Returns agent result if the query is complex enough, None to fall
    through to the standard planner path.
    """
    msg_lower = user_message.lower()

    # Only trigger for complex queries or when agent mode is active
    is_complex = (
        any(p in msg_lower for p in _COMPLEX_PATTERNS)
        or any(rx.search(msg_lower) for rx in _COMPLEX_PATTERNS_RE)
    )
    agent_mode = CHAT_BASE_MODES.get(mode, {}).get("agent_loop", False)
    if not is_complex and not agent_mode:
        return None

    # Build context from conversation history
    context = {
        "mode": mode,
        "skills": skills,
        "thread_id": thread_id,
        "history": _format_history(messages, limit=10),
        "memories": _format_memories(memories),
    }

    try:
        result = await agent_runner.run(
            query=user_message,
            mode=mode,
            skills=skills,
            context=context,
            budget_config=BudgetConfig(
                max_iterations=4 if mode == "search" else 3,
                max_tool_calls=15 if mode == "search" else 8,
                max_execution_time_ms=60000 if mode == "search" else 25000,
            ),
        )

        # If agent returned a meaningful answer, use it
        answer = result.get("answer", "")
        if answer and len(answer) > 20:
            # Build cards from tool results
            cards = []
            for tc in result.get("tool_calls", []):
                if tc.get("success"):
                    cards.append({
                        "kind": "info",
                        "data": {"tool": tc["tool"], "status": "completed"},
                    })
            return {"answer": answer, "cards": cards}

    except Exception as e:
        logger.warning("Agent loop failed, falling through to planner: %s", e)

    return None


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


async def _build_career_context() -> str:
    """Build compact career context for the answer prompt."""
    parts = []
    profile = await db.get_career_profile() or {}
    if name := profile.get("name"):
        parts.append(f"Name: {name}")
    if title := profile.get("title"):
        parts.append(f"Current Title: {title}")
    if targets := profile.get("target_roles"):
        parts.append(f"Target Roles: {', '.join(targets[:3])}")

    skills = await db.list_career_skills()
    if skills:
        skill_names = [s.get("name", "") for s in skills[:25] if s.get("name")]
        parts.append(f"Skills: {', '.join(skill_names)}")

    work = profile.get("work_experience") or []
    if work:
        entries = []
        for w in work[:3]:
            role = w.get("role", "")
            company = w.get("company", "")
            entries.append(f"{role} at {company}".strip())
        parts.append(f"Experience: {'; '.join(entries)}")

    # Projects with descriptions and languages
    projects = await db.list_career_projects()
    if projects:
        proj_entries = []
        for p in projects[:8]:
            name = p.get("name", "")
            role = p.get("role", "")
            langs = p.get("languages") or []
            desc = p.get("description") or []
            parts_list = [f"  - {name}"]
            if role:
                parts_list[0] += f" ({role})"
            if langs:
                parts_list.append(f"    Tech: {', '.join(langs[:8])}")
            if desc:
                for bullet in desc[:3]:
                    parts_list.append(f"    • {bullet}")
            proj_entries.append("\n".join(parts_list))
        parts.append("Projects:\n" + "\n".join(proj_entries))

    certs = await db.list_career_certifications()
    if certs:
        cert_names = [c.get("name", "") for c in certs[:5] if c.get("name")]
        parts.append(f"Certifications: {', '.join(cert_names)}")

    return "\n".join(parts) if parts else "(No career profile loaded)"


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


def _extract_sources(tool_results: dict[str, Any]) -> list[dict]:
    """Extract source info from tool results.

    Returns list of dicts with {url, title, favicon_url, hostname}.
    Deduplicates by URL.
    """
    sources: list[dict] = []
    seen_urls: set[str] = set()

    for tool_name, result in tool_results.items():
        if tool_name == "web_search" and isinstance(result, dict):
            for item in result.get("results", []):
                url = item.get("url", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                sources.append({
                    "url": url,
                    "title": item.get("title", ""),
                    "hostname": item.get("hostname", ""),
                    "favicon_url": item.get("favicon_url", ""),
                })
        elif tool_name.startswith("get_"):
            label = tool_name.replace("get_", "").replace("_", " ")
            sources.append({"title": label, "url": "", "hostname": "", "favicon_url": ""})

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
        "search_mcp_jobs": "job_list",
        "get_career_summary": "info",
        "compare_resumes": "info",
        "get_applications": "info",
        "get_rejections": "info",
        "get_contacts": "info",
        "get_companies": "info",
        "get_skill_suggestions": "info",
        "fetch_emails": "email_list",
        "search_emails": "email_list",
        "web_search": "sources",
    }
    return mapping.get(tool_name, "info")
