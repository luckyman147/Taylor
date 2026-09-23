# Chat Gateway

Deterministic pre-planner layer for the Chat Command Center. Runs on every user
turn **before** any LLM call. Source: `apps/backend/app/services/chat_gateway.py`.

## Architecture contract

```
Gateway  = deterministic evidence + obvious routing (no LLM, no clarification-by-guessing)
Planner  = semantic interpretation (LLM) — receives GatewaySignals as advisory context
State    = conversation continuity (in-memory, per thread, single-worker)
Signals  = structured evidence (topics / actions / entities / follow-up) passed to the planner
```

The gateway never invents meaning. It either (a) routes an obvious, deterministic
request directly, or (b) returns `GENERAL`/`UNKNOWN` with signals for the planner.
Signals are **advisory only** — they never force a route.

## Data structures

| Type | Purpose |
|------|---------|
| `ChatIntent` | Routing label. Includes `UNKNOWN` = "not confidently mapped to a Taylor domain" — **always planner-bound, never clarification**. |
| `GatewayDecision` | Dataclass returned by `classify_intent`: intent, confidence, routing fields (`preferred_tools`, `force_preferred`, `slash_args`, `needs_selection`, …) **plus signal fields** (`topics`, `actions`, `entities`, `active_topic`, `has_followup_reference`, `topic_shift`). |
| `ConversationContext` | Input built by the engine from `ConversationState` each turn: active topic/entities, `last_intent`, `last_tools`, `recent_user_messages`, `topic_stack`, `turn`. |
| `TopicState` | One topic-stack entry `(topic, confidence, turn)` — recency/decay for continuity. |

## Routing (classify order)

1. Explicit `resume_id` (upload) → `RESUME_AUDIT` (forced).
2. `/slash` command → forced for read tools with ≤1 required param
   (`force_preferred=True`, remainder → `slash_args`); write/unknown tokens fall through.
3. Resume-ID-in-message / master-resume reference → `RESUME_AUDIT`.
4. Structured compare `[compare: …]`, compare-intent card, `@mention` → forced tools.
5. Audit / contextual-follow-up / job-search / sent-email / profile / applications /
   skills / market / own-data companies+contacts patterns → dedicated intents or
   forced tools (all carry signals now).
6. Broad question/topic pattern → `GENERAL` if career-domain topics hit, else `UNKNOWN`.
7. Explicit vague patterns (`_CLARIFY_PATTERNS`, e.g. bare `help`) → `CLARIFY`
   (the **only** auto-clarify path besides `not_enough_resumes` compare).
8. Conversational social messages → `GENERAL` (0.9), no clarification.
9. Fallback → `GENERAL` (0.6) when career topics present, else `UNKNOWN` (0.5).
   Short messages no longer auto-clarify (the ≤4-word branch was removed).

`UNKNOWN` and `GENERAL` both fall through the engine to the standard planner /
agent loop. Confidence bands: `< 0.60` planner-interpreted, `≥ 0.90` direct route.

## Signals (advisory)

Extracted per message via lexicons — they **never route**:

- **Topics** (15): `jobs`, `resume`, `career_profile`, `applications`, `skills`,
  `market`, `salary`, `companies`, `contacts`, `email`, `interviews`, `projects`,
  `learning`, `technology`, `general`.
- **Actions** (11): `search`, `analyze`, `compare`, `create`, `update`, `explain`,
  `recommend`, `summarize`, `retrieve`, `draft`, `debug`.
- **Entities**: technology keyword hits + locations (`in/to/near Germany` style +
  curated country list).
- **Follow-up reference** (`has_followup_reference`): reference phrases
  (`which ones`, `what about`, `those`, …) **and** prior context
  (active topic / last tools / topic stack).
- **Topic shift** (`topic_shift`): explicit reset phrases (`actually`,
  `forget that`, `let's talk about`, …) or a strong new-domain noun that doesn't
  overlap the active topic. Follow-up reference language suppresses shift
  detection (continuation beats pivot).

`format_gateway_signals(decision)` renders these into the
`{gateway_signals}` block of `CHAT_PLANNER_PROMPT` (see
`apps/backend/app/prompts/templates.py`). The prompt states they are advisory:
the planner may combine tools when evidence supports it and must still obey the
OWN-DATA rule (`get_companies`/`get_contacts`/`get_applications` never route to
`search_mcp_jobs`).

## Conversation state flow

Engine-side (`apps/backend/app/services/chat_engine.py`):

```
ConversationState ──build_gateway_context()──▶ ConversationContext ──▶ classify_intent(context=…)
        ▲                                              │
        └──── _persist_gateway_state() ◀── GatewayDecision (turn++, recent messages,
        │                                     previous_intent, active_topic/topic_stack)
        └──── _update_conversation_state(tool_results) ◀── after planner / direct-tool execution
              (active_job_id, active_company, last_tools, last_tool_results, intent)
```

- `_persist_gateway_state` runs right after each `classify_intent` call
  (main turn + clarification-resolve with `count_turn=False`).
- `_update_conversation_state` runs after tool execution — including
  `_handle_direct_tool` (forced/slash turns), so `last_tools`/`previous_intent`
  stay fresh on every path.
- `active_job_id` / `active_resume_id` feed `context_builder.build_chat_context`'s
  entity summary; `topic_stack`/`active_topic` feed next turn's follow-up and
  shift detectors.
- Contextual follow-up gate: existing job-list cards **or** `active_topic` set.
- State is in-memory per thread (single-worker assumption, same as config caches).

## Clarification policy

Auto-clarify **only** for:

1. Explicit vague patterns in `_CLARIFY_PATTERNS` (bare `help`,
   `what can you do`, …).
2. Compare intent with fewer than 2 resumes (`not_enough_resumes`).

Everything else — short messages, `UNKNOWN`, career questions — goes to the
planner with signals. The old `should_clarify()` threshold helper and the
≤4-word low-confidence branch were removed.

## Tests

- `apps/backend/tests/unit/test_chat_gateway.py` — routing (slash, own-data,
  job search) + signal extraction, UNKNOWN/GENERAL labelling, follow-up/shift
  detectors, `help`→clarify, `jobs?`→planner.
- `apps/backend/tests/unit/test_chat_gateway_state.py` — persist/context
  roundtrip, topic-shift stack reset, direct-tool state writes,
  `format_gateway_signals` rendering.
- `apps/backend/tests/unit/test_chat_prompts.py` — `{gateway_signals}`
  placeholder + full-format KeyError guard (engine kwarg contract), OWN-DATA
  planner rules.

Run: `uv run pytest -q tests/unit/test_chat_gateway.py tests/unit/test_chat_gateway_state.py tests/unit/test_chat_prompts.py`
