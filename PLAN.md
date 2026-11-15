# TAYLOR Autonomous Execution Platform — Implementation Plan

## Architecture

```
User Request → Agent Router → Tool/MCP Retrieval → LLM Planner
    → Structured Workflow → Sandbox Manager → Python Script
    → Built-in Tools + MCPs → Execution Result → Evaluator
    → enough? YES → Answer
    → failed?  RECOVER → retry/alternative → Planner
```

**Principle:** LLM decides what should happen. Python controls what is allowed. Sandbox executes it.

**Event streaming (all phases emit events):**
```
THINKING → PLANNING → DISCOVERING_TOOLS → GENERATING_WORKFLOW
→ EXECUTING → TOOL_RUNNING → TOOL_COMPLETED → EVALUATING
→ RECOVERING → COMPLETED | FAILED
```

---

## Phase 1 — Foundation

Agent state, agent runner, MCP registry, MCP discovery, credential references, tool retrieval, event streaming.

### 1.1 Agent State — `apps/backend/app/agent/state.py`

Add to `TaylorState`:
- `skills: list[str]` — active skill IDs
- `budget: dict[str, Any]` — serializable budget `{max_iterations, max_tool_calls, max_time_ms, max_cost_usd}`
- `workflow_steps: list[dict[str, Any]]` — LLM-generated workflow steps
- `recovery_attempts: int` — count of recovery attempts

Update `create_initial_state()` to accept `skills` param and populate `budget`.

### 1.2 Agent Runner — `apps/backend/app/agent/runner.py`

- Accept `skills` param in `AgentRunner.run()`
- Pass `skills` into `create_initial_state()`
- Include `budget` dict in initial state
- Remove `_is_simple_query` short-circuit (let router handle that)

### 1.3 MCP Connection — `apps/backend/app/services/mcp/connection.py`

Implement real MCP SDK connections (currently stubbed):
- `connect()`: Use `streamablehttp_client` + `ClientSession` for HTTP, `stdio_client` for stdio. Fallback to httpx health check if SDK not installed.
- `list_tools()`: Use `session.list_tools()` to discover tools. Cache in `server_manager`.
- `call_tool()`: Use `session.call_tool()` for real execution.
- Store sessions in `self._sessions[server_id]`.

### 1.4 MCP Discovery — `apps/backend/app/services/mcp/discovery.py`

- Use `asyncio.gather()` for parallel tool discovery (currently sequential).
- Wire results into `tool_registry.load_mcp_tools()`.

### 1.5 Tool Retrieval — `apps/backend/app/tools/retrieval.py`

- Pass `skills` context to scoring.
- Skill-aware capability matching (boost tools matching active skill allowlists).

### 1.6 Event Streaming — `apps/backend/app/schemas/agent_events.py`

New types:
- `WorkflowEvent` — `status: generating|executing|completed`, `step_count`, `message`
- `StepEvent` — `step_id`, `tool`, `status: running|success|failed|skipped|timeout`, `duration_ms`, `error`
- Add `GENERATING_WORKFLOW` to `AgentStatus` enum
- Update `AgentEvent` union to include `WorkflowEvent | StepEvent`

### 1.7 Tool Executor Health — `apps/backend/app/tools/executor.py`

After each MCP tool call in `_dispatch_mcp()`:
- Call `health_monitor.record_success(server_id, latency_ms)` on success
- Call `health_monitor.record_failure(server_id, error)` on failure

### 1.8 Database Migration — `apps/backend/app/db_engine.py` + `apps/backend/app/database.py`

- Add `skills TEXT DEFAULT '[]'` to `chat_threads` (idempotent ALTER TABLE)
- Migrate existing threads: `mode="coach"` → `{mode: "ask", skills: ["coach"]}` (same for recruiter, resume_analyst)
- Add `skills` to CRUD operations in `database.py`
- Add `skills` to `_chat_thread_to_dict()`

### 1.9 Chat Schemas — `apps/backend/app/schemas/chat.py`

- Add `skills: list[str]` to `ThreadCreate`, `ThreadUpdate`, `ThreadSummary`

### 1.10 Chat Router — `apps/backend/app/routers/chat.py`

- Handle `skills` in create/update/list endpoints
- Pass `skills` through to `chat_engine.run_turn_stream()`

### 1.11 Prompt Templates — `apps/backend/app/prompts/templates.py`

Replace `CHAT_MODE_CONFIGS` and `CHAT_PLANNER_SYSTEM_PROMPTS` with:

```python
CHAT_BASE_MODES: dict[str, dict[str, Any]] = {
    "ask": {
        "agent_loop": False,
        "search_priority": False,
        "system": "...",
    },
    "agent": {
        "agent_loop": True,
        "search_priority": False,
        "system": "...",
    },
    "search": {
        "agent_loop": True,
        "search_priority": True,
        "system": "...",
    },
}

CHAT_SKILLS: dict[str, dict[str, Any]] = {
    "coach": {
        "system": "...",
        "tool_allowlist": [...],
        "domain_boost": {"career": 0.8, "communication": 0.8},
    },
    "recruiter": { ... },
    "resume_analyst": { ... },
}

def get_merged_system_prompt(mode: str, skills: list[str]) -> str: ...
def get_skill_allowlist(skills: list[str]) -> list[str]: ...  # UNION, not intersection
```

### 1.12 Chat Engine — `apps/backend/app/services/chat_engine.py`

- Accept `skills` param
- Call `get_merged_system_prompt(mode, skills)` for system prompt
- Call `get_tool_catalog_json(mode, skills)` for tool catalog
- Force agent loop when `CHAT_BASE_MODES[mode]["agent_loop"]` is True
- Set `search_priority` flag for search mode

### 1.13 Permissions — `apps/backend/app/tools/permissions.py`

Update `can_auto_execute(tool_name, mode, skills)`:
- `mode="agent"` → auto-execute all writes
- Skills active → auto-execute tools in skill allowlist
- Otherwise → require confirmation for writes

### 1.14 Ranking — `apps/backend/app/tools/ranking.py`

- Add skill-based domain boosts from `CHAT_SKILLS[skill]["domain_boost"]`
- Search mode: boost web/MCP/adapters with 0.9 score

---

## Phase 2 — Execution

Sandbox manager, Python workflow generation, built-in tool bridge, MCP bridge, execution limits.

### 2.1 New Module: `apps/backend/app/sandbox/`

```
sandbox/
├── __init__.py
├── models.py      — Workflow, WorkflowStep, WorkflowResult, StepResult, WorkflowBudget
├── manager.py     — SandboxManager: orchestrates workflow execution
├── executor.py    — StepExecutor: runs individual steps with timeout/retry
├── policy.py      — ExecutionPolicy: security rules, permission checks
└── workspace.py   — Workspace: isolated execution environment
```

**`sandbox/models.py`:**
- `WorkflowStep`: step_id, tool_name, arguments, depends_on, timeout_ms, retry_policy
- `Workflow`: workflow_id, query, steps, budget
- `WorkflowBudget`: max_steps=10, max_time_ms=30000, max_cost_usd=0.05
- `StepResult`: step_id, success, result, error, latency_ms
- `WorkflowResult`: workflow_id, step_results, success, total_time_ms

**`sandbox/manager.py`:**
- `execute(workflow, mode, skills, event_queue)` → `WorkflowResult`
- Topological sort steps by dependencies
- Independent steps run in parallel via `asyncio.gather()`
- Check policy before each step
- Emit `StepEvent` for each step
- Enforce budget limits (max steps, max time)

**`sandbox/executor.py`:**
- `_execute_step(step, event_queue)` → `StepResult`
- Permission check via `policy.requires_confirmation()`
- Cache check via `tool_cache.get()`
- Execute via `tool_executor.execute()` with timeout
- Emit start/completion events

**`sandbox/policy.py`:**
- `BLOCKED_TOOLS`: `{"reset_database", "delete_resume"}`
- `check_blocked(tool_name, mode)` → error or None
- `requires_confirmation(tool_name, mode, skills)` → bool

**`sandbox/workspace.py`:**
- Isolated temp directory per workflow
- Cleanup after execution

### 2.2 Workflow Generator — `apps/backend/app/agent/workflow_generator.py`

```python
class WorkflowGenerator:
    async def generate(query, available_tools, context, mode, skills) -> Workflow:
        # LLM generates structured workflow
        # Prompt includes: query, tools, mode, skills
        # Output: JSON with steps, dependencies, timeouts
        # Validation: tool names must exist in catalog
```

### 2.3 Agent Execute Node — `apps/backend/app/agent/nodes.py`

Replace direct `tool_executor.execute()` calls with:
1. Call `workflow_generator.generate()` to create workflow
2. Call `sandbox_manager.execute()` to run workflow
3. Convert `StepResult` list to `ToolCall` records
4. Return partial state update

### 2.4 Built-in Tool Bridge — `apps/backend/app/services/chat_tools.py`

New tools:
- `crawl4ai_scrape`: params `url` (required), `extraction_schema` (optional)
- `parse_document`: params `file_path` or `resume_id`

Update `get_tool_catalog_json()` to accept `skills` param for allowlist filtering.

### 2.5 MCP Bridge — `apps/backend/app/tools/executor.py`

- MCP dispatch uses `connection_manager.call_tool()` (now real, not stubbed)
- Health monitoring wired after each call

---

## Phase 3 — Autonomy

Evaluate result, failure classification, retry, alternative MCP, re-planning, max 3 iterations.

### 3.1 Recovery Node Wiring — `apps/backend/app/agent/graph.py`

Fix dead recovery node:
- Add `execute → recover` conditional edge via `_route_after_execute()`
- `_route_after_execute()`: if `consecutive_failures >= 3` → evaluate; if last call failed → recover; else → evaluate

### 3.2 Budget Enforcement — `apps/backend/app/agent/graph.py`

Wire budget into `_route_after_evaluate()`:
- Read `budget.max_iterations` from state
- Check `iteration >= max_iterations` → budget_exhausted
- Check `consecutive_failures >= 3` → budget_exhausted

### 3.3 Recovery Logic — `apps/backend/app/agent/recovery.py`

Add `handle_workflow_failure(state, failed_call)`:
- Classify error (existing `FailureType` enum)
- Actions: retry, skip, re_plan, ask_user
- Track `recovery_attempts` in state
- Max 3 recovery attempts before give_up

### 3.4 Re-planning — `apps/backend/app/agent/planner.py`

When recovery says "re_plan":
- Planner receives updated context with failure info
- Can suggest alternative tools/MCPs
- Include failure reason in prompt so LLM avoids same mistake

### 3.5 Evaluate Node — `apps/backend/app/agent/evaluate.py`

Accept workflow-level results:
- Evaluate if collected data from workflow steps is sufficient
- Check if all critical steps succeeded
- Return verdict: success / insufficient / budget_exhausted

---

## Phase 4 — Evaluation

AgentTrace, baseline vs autonomous mode, failure injection, RAGAS, tool-selection metrics, recovery metrics, cost/token/latency metrics.

### 4.1 Agent Trace — `apps/backend/app/eval/trace.py`

```python
class AgentTrace(BaseModel):
    trace_id: str
    query: str
    mode: str
    skills: list[str]
    workflow_steps: list[dict]
    tool_calls: list[dict]
    iterations: int
    total_time_ms: float
    total_tokens: int
    total_cost_usd: float
    success: bool
    recovery_attempts: int
    events: list[dict]  # Full event timeline
```

### 4.2 Evaluation Metrics — `apps/backend/app/eval/metrics.py`

| Metric | Description |
|--------|-------------|
| `tool_selection_accuracy` | Did the LLM pick the right tools? |
| `workflow_efficiency` | Were steps ordered optimally? |
| `recovery_rate` | % of failures successfully recovered |
| `latency_p50/p95` | End-to-end response time |
| `cost_per_turn` | Average USD per turn |
| `user_satisfaction` | Implicit (follow-up rate, explicit rating) |

### 4.3 Failure Injection — `apps/backend/app/eval/inject.py`

```python
class FailureInjector:
    async def inject_tool_failure(tool_name, error_type): ...
    async def inject_timeout(tool_name, delay_ms): ...
    async def inject_mcp_unavailable(server_id): ...
```

### 4.4 RAGAS Integration — `apps/backend/app/eval/ragas_eval.py`

- Faithfulness: Is the answer grounded in tool results?
- Relevancy: Does the answer address the query?
- Context precision: Were the right tools called?

### 4.5 CLI — `apps/backend/app/eval/cli.py`

```bash
python -m app.eval.cli run --query "find me senior frontend jobs" --mode agent --skills coach
python -m app.eval.cli benchmark --dataset eval/datasets/basic.jsonl
python -m app.eval.cli compare --baseline eval/results/baseline.json --autonomous eval/results/agent.json
```

---

## Phase 5 — UX

Live agent status, expandable execution timeline, tool/MCP activity, recovery messages, final answer.

### 5.1 Frontend Event Types — `apps/frontend/lib/api/chat.ts`

Add:
```typescript
export interface WorkflowEvent {
  type: 'workflow';
  status: 'generating' | 'executing' | 'completed';
  step_count: number;
  message: string;
}

export interface StepEvent {
  type: 'step';
  step_id: string;
  tool: string;
  status: 'running' | 'success' | 'failed' | 'skipped' | 'timeout';
  duration_ms?: number;
  error?: string;
}
```

Update `AgentEvent` union to include `WorkflowEvent | StepEvent`.

Add `skills: string[]` to `ThreadSummary`.

### 5.2 Status Timeline — `apps/frontend/components/chat/status-timeline.tsx`

Update `buildTimelineSteps()`:
- `workflow` events → top-level status steps with step count badge
- `step` events → child steps under the workflow parent
- Recovery events → standalone recovery steps with retry indicator

### 5.3 Mode/Skill Selector — `apps/frontend/components/chat/mode-switcher.tsx`

Refactor to `ModeSkillSelector`:
- Base mode dropdown: ask / agent / search
- Skill toggle chips: coach / recruiter / resume_analyst
- Multi-select with union tool access (not intersection)
- Layout: `[Ask ▾] [Coach] [Recruiter] [Analyst]`

### 5.4 Thread Sidebar — `apps/frontend/components/chat/thread-sidebar.tsx`

- Show active skill badges next to thread titles
- Skill badge colors: coach=blue, recruiter=green, analyst=purple

### 5.5 Chat Page — `apps/frontend/app/(default)/chat/[threadId]/page.tsx`

- Update `MODES` array: ask/agent/search
- Add `SKILLS` array: coach/recruiter/resume_analyst
- Send handler passes `skills` to API
- Pause button via `AbortController.abort()`

### 5.6 MCP Bar — `apps/frontend/components/chat/mcp-bar.tsx`

- Merge adapter-based status (from `GET /mcp/status`) with DB status (from `GET /mcp/servers`)
- Show live connection state

---

## File Change Summary

| # | File | Change | Phase |
|---|------|--------|-------|
| 1 | `agent/state.py` | Add skills, budget, workflow_steps, recovery_attempts | 1 |
| 2 | `agent/runner.py` | Accept skills, pass budget, remove simple query short-circuit | 1 |
| 3 | `agent/graph.py` | Wire execute→recover, add _route_after_execute, budget in routing | 1, 3 |
| 4 | `agent/nodes.py` | Add workflow generation + sandbox execution in execute node | 2 |
| 5 | `agent/planner.py` | Update prompt for workflow generation, accept failure context | 2, 3 |
| 6 | `agent/evaluate.py` | Accept workflow results, evaluate workflow-level sufficiency | 3 |
| 7 | `agent/recovery.py` | Add handle_workflow_failure(), workflow-level recovery | 3 |
| 8 | `agent/budget.py` | Accept budget from state, enforce in routing | 1, 3 |
| 9 | `schemas/agent_events.py` | Add WorkflowEvent, StepEvent, GENERATING_WORKFLOW | 1 |
| 10 | `schemas/chat.py` | Add skills to ThreadCreate/ThreadUpdate/ThreadSummary | 1 |
| 11 | `services/chat_engine.py` | Pass skills to agent, merge base+skill prompts, workflow events | 1, 2 |
| 12 | `services/chat_tools.py` | Add crawl4ai_scrape, parse_document; skill-aware catalog | 2 |
| 13 | `tools/executor.py` | Wire health_monitor, MCP bridge with real SDK | 1, 2 |
| 14 | `tools/permissions.py` | can_auto_execute(tool, mode, skills) | 1, 2 |
| 15 | `tools/ranking.py` | Skill boosts, search mode web boost | 1 |
| 16 | `tools/retrieval.py` | Skill-aware retrieval scoring | 1 |
| 17 | `tools/registry.py` | Add workflow-related built-in tools | 2 |
| 18 | `services/mcp/connection.py` | Real MCP SDK connect/list_tools/call_tool | 1 |
| 19 | `services/mcp/discovery.py` | Parallel discovery via asyncio.gather() | 1 |
| 20 | `services/mcp/health.py` | Already implemented, wiring done in #13 | 1 |
| 21 | `services/mcp/crawl4ai.py` | **New** — Crawl4AI adapter (persistent subprocess) | 2 |
| 22 | `services/docling_parser.py` | **New** — Docling parser utility | 2 |
| 23 | `services/parser.py` | **New** — Router: MarkItDown vs Docling | 2 |
| 24 | `services/job_scraper.py` | Register Crawl4AI adapter | 2 |
| 25 | `sandbox/__init__.py` | **New** | 2 |
| 26 | `sandbox/models.py` | **New** — Workflow, Step, Result models | 2 |
| 27 | `sandbox/manager.py` | **New** — Workflow orchestrator | 2 |
| 28 | `sandbox/executor.py` | **New** — Step executor | 2 |
| 29 | `sandbox/policy.py` | **New** — Security policies | 2 |
| 30 | `sandbox/workspace.py` | **New** — Isolated environment | 2 |
| 31 | `agent/workflow_generator.py` | **New** — LLM workflow generation | 2 |
| 32 | `prompts/templates.py` | Add CHAT_BASE_MODES, CHAT_SKILLS, get_merged_system_prompt() | 1 |
| 33 | `database.py` | Add skills to CRUD, migration | 1 |
| 34 | `db_engine.py` | Idempotent ALTER TABLE for skills column | 1 |
| 35 | `routers/chat.py` | Handle skills in create/update/list | 1 |
| 36 | `eval/trace.py` | **New** — AgentTrace model | 4 |
| 37 | `eval/metrics.py` | **New** — Evaluation metrics | 4 |
| 38 | `eval/inject.py` | **New** — Failure injection | 4 |
| 39 | `eval/ragas_eval.py` | **New** — RAGAS integration | 4 |
| 40 | `eval/cli.py` | **New** — CLI for running evals | 4 |
| 41 | `components/chat/mode-switcher.tsx` | Refactor to ModeSkillSelector | 5 |
| 42 | `components/chat/status-timeline.tsx` | Handle new event types | 5 |
| 43 | `components/chat/thread-sidebar.tsx` | Skill badges | 5 |
| 44 | `chat/[threadId]/page.tsx` | New MODES/SKILLS, pass skills, pause button | 5 |
| 45 | `lib/api/chat.ts` | Add skills to types, new event types | 5 |
| 46 | `components/chat/mcp-bar.tsx` | Merge adapter + DB status | 5 |

---

## Implementation Order

| Phase | Scope | Est. Hours |
|-------|-------|-----------|
| 1 | Foundation: State, runner, MCP connection, health wiring, events, DB migration, prompts | 3-4h |
| 2 | Execution: Sandbox module, workflow generator, Crawl4AI/Docling adapters, tool bridges | 4-5h |
| 3 | Autonomy: Recovery wiring, budget enforcement, re-planning | 2-3h |
| 4 | Evaluation: AgentTrace, metrics, failure injection, RAGAS, CLI | 3-4h |
| 5 | UX: Mode/skill selector, timeline updates, skill badges, MCP bar | 2-3h |
| **Total** | | **14-19h** |
