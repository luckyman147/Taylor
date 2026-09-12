"""Agent Nodes — LangGraph node implementations for the TAYLOR agent loop.

Each node is an async function that takes TaylorState and returns a partial
state update dict. Nodes wrap existing planner/evaluator/recovery logic.
Events are emitted to state["event_queue"] for SSE streaming.
"""

import asyncio
import logging
import time
from typing import Any

from app.agent.evaluate import agent_evaluator
from app.agent.planner import agent_planner
from app.agent.recovery import agent_recovery
from app.agent.state import (
    TaylorState,
    ToolCall,
    add_tool_call,
    emit_event,
    get_tool_results,
)
from app.schemas.agent_events import (
    AgentStatusEvent,
    AgentStatus,
    ToolExecutionEvent,
    ToolExecStatus,
    RecoveryEvent,
)
from app.tools.cache import tool_cache
from app.tools.executor import tool_executor
from app.tools.permissions import permission_manager
from app.tools.ranking import tool_ranker
from app.tools.registry import tool_registry
from app.tools.retrieval import tool_retriever

logger = logging.getLogger(__name__)


async def analyze_request(state: TaylorState) -> dict[str, Any]:
    """Analyze the user request and retrieve + rank candidate tools."""
    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.DISCOVERING_TOOLS,
        message="Finding the best tools for your request...",
    ))

    query = state.get("query", "")
    context = state.get("context", {})

    candidates = await tool_retriever.retrieve(query, top_k=12, context=context)
    ranked = await tool_ranker.rank(candidates, query, context, top_k=8)

    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.PLANNING,
        message=f"Found {len(ranked)} candidate tools. Planning next steps...",
    ))

    return {"ranked_tools": ranked}


async def plan(state: TaylorState) -> dict[str, Any]:
    """Plan which tools to call next using the LLM planner."""
    iteration = state.get("iteration", 0)
    ranked_tools = state.get("ranked_tools", [])

    # Reset plan signatures at start of new turn
    if iteration == 0:
        agent_planner.reset_signatures()

    # Rate limit protection: delay between iterations to stay under LLM quotas
    if iteration > 0:
        await asyncio.sleep(5)

    actions = await agent_planner.plan_next_actions(state, ranked_tools)

    if not actions:
        return {
            "sufficient_data": True,
        }

    iteration += 1
    tool_names = [a.get("tool_name", "") for a in actions if a.get("tool_name")]
    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.EXECUTING,
        message=f"Planning to run: {', '.join(tool_names)}",
    ))

    return {
        "iteration": iteration,
        "_pending_actions": actions,
    }


async def execute(state: TaylorState) -> dict[str, Any]:
    """Execute planned tool calls via sandbox workflow."""
    from app.agent.workflow_generator import workflow_generator
    from app.sandbox.manager import sandbox_manager

    actions = state.get("_pending_actions", [])
    ranked_tools = state.get("ranked_tools", [])
    mode = state.get("mode", "ask")
    skills = state.get("skills", [])
    iteration = state.get("iteration", 0)

    # Generate workflow from planned actions
    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.GENERATING_WORKFLOW,
        message="Generating execution workflow...",
    ))

    workflow = await workflow_generator.generate(
        query=state.get("query", ""),
        available_tools=ranked_tools,
        context=state.get("context", {}),
        mode=mode,
        skills=skills,
    )

    # Execute in sandbox — pass run_id so sandbox can emit events via registry
    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.EXECUTING,
        message=f"Executing workflow ({len(workflow.steps)} steps)...",
    ))

    result = await sandbox_manager.execute(
        workflow=workflow,
        mode=mode,
        skills=skills,
        run_id=state.get("run_id", ""),
    )

    # Convert StepResults to ToolCalls
    tool_calls = list(state.get("tool_calls", []))
    total_tool_calls = state.get("total_tool_calls", 0)
    consecutive_failures = state.get("consecutive_failures", 0)
    errors = list(state.get("errors", []))

    for sr in result.step_results:
        call = ToolCall(
            tool_name=sr.step_id,
            arguments={},
            result=sr.result,
            success=sr.success,
            error=sr.error,
            latency_ms=sr.latency_ms,
            iteration=iteration,
        )
        tool_calls.append(call)
        total_tool_calls += 1

        if sr.success:
            consecutive_failures = 0
        else:
            consecutive_failures += 1
            if sr.error:
                errors.append(f"{sr.step_id}: {sr.error}")

    return {
        "tool_calls": tool_calls,
        "total_tool_calls": total_tool_calls,
        "consecutive_failures": consecutive_failures,
        "errors": errors,
    }


async def evaluate(state: TaylorState) -> dict[str, Any]:
    """Evaluate whether collected data is sufficient to answer."""
    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.EVALUATING,
        message="Checking whether the retrieved data is sufficient...",
    ))

    # If planner already said sufficient, trust it
    if state.get("sufficient_data"):
        return {"_verdict": "success"}

    results = get_tool_results(state)
    if not results:
        return {
            "_verdict": "insufficient",
            "data_gaps": ["No data collected yet"],
        }

    eval_result = await agent_evaluator.evaluate_sufficiency(state)

    if eval_result["sufficient"]:
        return {"_verdict": "success"}

    return {
        "_verdict": "insufficient",
        "data_gaps": eval_result.get("gaps", []),
    }


async def recover(state: TaylorState) -> dict[str, Any]:
    """Handle failures and decide recovery action."""
    tool_calls = state.get("tool_calls", [])
    if not tool_calls:
        return {"_recovery_action": "give_up", "recovery_attempts": state.get("recovery_attempts", 0) + 1}

    last_call = tool_calls[-1]
    if last_call.success:
        return {"_recovery_action": "skip"}

    recovery_attempts = state.get("recovery_attempts", 0) + 1
    await emit_event(state, RecoveryEvent(
        attempt=recovery_attempts,
        message=f"Tool '{last_call.tool_name}' failed. Attempting recovery ({recovery_attempts}/3)...",
    ))

    recovery = await agent_recovery.handle_failure(state, last_call)
    return {
        "_recovery_action": recovery.get("action", "skip"),
        "recovery_attempts": recovery_attempts,
    }


async def generate_answer(state: TaylorState) -> dict[str, Any]:
    """Generate the final answer from collected tool results."""
    from app.llm import complete

    await emit_event(state, AgentStatusEvent(
        status=AgentStatus.COMPLETED,
        message="Preparing your answer...",
    ))

    results = get_tool_results(state)
    query = state.get("query", "")

    if not results:
        return {
            "final_answer": "I wasn't able to gather the information needed to answer your question.",
            "cards": [],
        }

    # Extract sources and build raw data for LLM, deduplicating by URL
    sources = []
    seen_urls: set[str] = set()
    raw_data_blocks = []
    for r in results:
        result = r.get("result")
        if not result:
            continue

        if isinstance(result, dict) and "results" in result:
            # web_search result — deduplicate by URL
            for item in result.get("results", []):
                title = item.get("title", "")
                url = item.get("url", "")
                snippet = item.get("snippet", "")
                if title and url and url not in seen_urls:
                    seen_urls.add(url)
                    sources.append({"url": url, "title": title})
                    raw_data_blocks.append(f"[{title}]({url}): {snippet}")

        elif isinstance(result, dict) and "jobs" in result:
            # search_mcp_jobs result — deduplicate by URL
            for job in result.get("jobs", []):
                title = job.get("title", "")
                company = job.get("company", "")
                url = job.get("url", "")
                location = job.get("location", "")
                if title and url and url not in seen_urls:
                    seen_urls.add(url)
                    sources.append({"url": url, "title": f"{title} - {company}"})
                    raw_data_blocks.append(f"{title} at {company} ({location}): {url}")

    if not raw_data_blocks:
        return {
            "final_answer": "I found some data but couldn't extract useful information from it.",
            "cards": [],
        }

    # Deduplicate sources
    unique_sources = {}
    for s in sources:
        if s["url"] and s["url"] not in unique_sources:
            unique_sources[s["url"]] = s["title"]

    # Limit to top 10 results to keep prompt focused
    raw_data_blocks = raw_data_blocks[:10]

    import json
    raw_json = json.dumps(raw_data_blocks, indent=2)

    prompt = f"""The user asked: "{query}"

Here are {len(raw_data_blocks)} search results:
{raw_json}

Write a well-structured answer synthesizing these results.

RULES:
- Write as a knowledgeable assistant, not as a data dump
- Start with a brief 1-2 sentence overview
- Use headings (##) to organize major themes
- Use bullet points for specific findings
- Quote or reference specific sources when making claims
- Keep total length to 3-5 paragraphs
- Do NOT include a "Sources" section (it's rendered separately)
- Do NOT repeat the raw data back verbatim

Example of GOOD output:
## Overview
Recent developments in AI show several key trends...

## Key Trends
- **Agentic AI**: Multiple sources highlight the rise of autonomous AI agents that can plan and execute multi-step workflows (McKinsey, Accenture).
- **Foundation Models**: ... (Gartner, Deloitte)

## Impact
These trends suggest...

Example of BAD output (DO NOT do this):
Here are the search results:
[Title](url): snippet
[Title](url): snippet
...

Write your answer now:"""

    # Retry with backoff for rate limits
    for attempt in range(3):
        try:
            response = await complete(prompt, temperature=0.3, max_tokens=2000)
            final_answer = response if isinstance(response, str) else response.get("content", "")
            break
        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "429" in err_str or "rate" in err_str or "quota" in err_str
            if is_rate_limit and attempt < 2:
                wait = 10 * (attempt + 1)
                logger.warning("Rate limited in generate_answer, retrying in %ds", wait)
                await asyncio.sleep(wait)
                continue
            logger.error("Answer generation failed: %s", e)
            final_answer = "## Search Results\n\n" + "\n\n".join(raw_data_blocks[:5])

    # Build a sources card for the frontend
    cards = []
    if unique_sources:
        cards.append({
            "kind": "sources",
            "data": {
                "sources": [{"url": url, "title": title} for url, title in unique_sources.items()],
            },
        })

    return {"final_answer": final_answer, "cards": cards}
