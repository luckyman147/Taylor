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
| `GatewayDecision` | Dataclass returned by `classify_intent`: intent, confidence, routing fields (`preferred_tools`, `force_preferred`, `slash_args`, `needs_selection`, …) **plus signal fields** (`topics`, `actions`, `entities`, `active_topic`, `has_followup_reference`, `topic_shift`, `topic_reset`, `topic_history`). |
| `ConversationContext` | Input built by the engine from `ConversationState` each turn: *effective* active topic/entities, `last_intent`, `last_tools`, `recent_user_messages`, `topic_stack`, `turn`. |
| `TopicState` | One topic-stack entry `(topic, confidence, turn, demoted)` — recency/decay. `demoted=True` marks superseded shift entries (kept for history, not active). |

## Routing (classify order)

Locked precedence — explicit user intent always beats topic detection:

1. Explicit `resume_id` (upload) → `RESUME_AUDIT` (forced).
2. `/slash` command → forced for read tools with ≤1 required param
   (`force_preferred=True`, remainder → `slash_args`); write/unknown tokens fall through.
3. Own-data companies/contacts pattern → forced `get_companies`/`get_contacts`
   (`force_preferred=True`) — never `search_mcp_jobs`.
4. Resume-ID-in-message / master-resume reference → `RESUME_AUDIT`.
5. Structured compare `[compare: …]` + compare-intent card → forced compare tools.
6. `@mention` → `search_entity_emails`.
7. Sent-email pattern → preferred `search_sent_emails` (conf 0.9).
8. **Multi-topic gate** — fires only when
   `len(topics ∩ career labels) ≥ 2 AND len(distinct actions) ≥ 2`
   (`_is_multi_topic`). Returns `GENERAL` (0.7) with full signals → planner.
   Two topics alone never fire it (protects the MARKET salary fast path);
   one action on two topics never fires it (protects AUDIT).
9. Single-topic deterministic: contextual-follow-up flag → audit → job-search →
   profile → applications → skills → market.
10. Broad question/topic pattern → `GENERAL` if career-domain topics hit, else `UNKNOWN`.
11. Explicit vague patterns (`_CLARIFY_PATTERNS`, e.g. bare `help`) → `CLARIFY`
    (the **only** auto-clarify path besides `not_enough_resumes` compare).
12. Conversational social messages → `GENERAL` (0.9), no clarification.
13. Fallback → `GENERAL` (0.6) when career topics present, else `UNKNOWN` (0.5).
    Short messages no longer auto-clarify (the ≤4-word branch was removed).

Worked examples:

| Message | Route | Why |
|---------|-------|-----|
| `Find React jobs and tell me whether my resume fits them` | planner | multi-topic gate (career `{jobs,resume}` + actions `{search,analyze,…}`) |
| `audit my resume against this job` | `AUDIT` | gate needs ≥2 actions; only `analyze` fires |
| `What salary can I expect for React jobs in Germany?` | `MARKET` | gate needs ≥2 actions |
| `Compare my resume with this job` | compare path | step 5 < gate |
| `/get_companies find react jobs and audit my resume` | slash force | step 2 < gate |

`UNKNOWN` and `GENERAL` both fall through the engine to the standard planner /
agent loop. Confidence bands: `< 0.60` planner-interpreted, `≥ 0.90` direct route.

## Follow-up routing (deterministic vs semantic)

`_should_handle_jobs_followup(gateway, message, has_job_context)` in
`chat_engine.py`:

```
job_list cards present
AND (
  contextual_follow_up flag          # "narrow down those", "tell me more about"
  OR (has_followup_reference         # "which ones", "what about", …
      AND structural job params      # role / location / remote / seniority only)
)
```

→ existing deterministic `_handle_contextual_follow_up` (job-list analysis,
no re-fetch). Everything else with follow-up signals falls through to the
**planner + gateway signals**.

- Skills-only params are **excluded** so `What about their tech stack?` never
  mutates a job search.
- A fresh `find remote go jobs` (no follow-up reference) stays a new search.
- `active_topic` alone is **not** sufficient — any active topic must not make
  the conversation behave like a job-search continuation.

Examples:

| With prior context | Route |
|--------------------|-------|
| job cards + `Which ones have remote positions?` | jobs follow-up handler |
| job cards + `What about their tech stack?` | planner |
| contact results + `Which of those contacts should I email?` | planner |
| job/resume results + `Can you compare these with my resume?` | planner |

## Signals (advisory)

Extracted per message via lexicons — they **never route** (except the
multi-topic gate, which only decides *planner vs deterministic*):

- **Topics** (15): `jobs`, `resume`, `career_profile`, `applications`, `skills`,
  `market`, `salary`, `companies`, `contacts`, `email`, `interviews`, `projects`,
  `learning`, `technology`, `general`.
- **Actions** (11): `search`, `analyze` (incl. `fit/fits/match/matches/suitable/suit`),
  `compare`, `create`, `update`, `explain`, `recommend`, `summarize`, `retrieve`,
  `draft`, `debug`.
- **Entities**: technology keyword hits, locations (`in/to/near Germany` style +
  curated country list), plus `company` / `contact` resolved **only** from known
  context (`active_company`, `active_contact`, `last_tool_results` fields
  `company`/`name`/`full_name` and nested `jobs`/`contacts`/`companies` lists)
  when the value is actually mentioned in the message — never free-text name
  inference.
- **Follow-up reference** (`has_followup_reference`): reference phrases
  (`which ones`, `what about`, `those`, …) **and** prior context
  (active topic / last tools / topic stack).
- **Topic shift** (`topic_shift`): a strong new-domain noun that doesn't
  overlap the active topic. Follow-up reference language suppresses shift
  detection (continuation beats pivot).
- **Topic reset** (`topic_reset`): explicit reset language (`actually`,
  `forget that`, `moving on`, …) when an active topic exists — detected by
  `_detect_topic_reset`, independent of noun-based shift.
- **Topic history** (`topic_history`): last ≤5 stack topics for the current
  message — lets the planner honor “go back to the resume question”.

`format_gateway_signals(decision)` renders these into the
`{gateway_signals}` block of `CHAT_PLANNER_PROMPT` (see
`apps/backend/app/prompts/templates.py`) and into the **agent-loop context**
(`context["gateway_signals"]`, same serialized string). The agent tool
planner (`app/agent/planner.py`) surfaces that block in its prompt. The
prompt states signals are advisory: the planner may combine tools when
evidence supports it and must still obey the OWN-DATA rule
(`get_companies`/`get_contacts`/`get_applications` never route to
`search_mcp_jobs`).

## Observability

`classify_intent` is a thin wrapper over `_route_message` that logs one
structured line per classification:

```
gateway_classification {"event":"gateway_classification","intent":"…","confidence":…,"topics":[…],"actions":[…],"active_topic":…,"has_followup_reference":…,"topic_shift":…,"preferred_tools":[…],"force_preferred":…}
```

Evidence only — no message text, no entity values, no tool results. Clarify
logs use a pattern tag (`vague_pattern`), never a message excerpt.

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
  (main turn + clarification-resolve with `count_turn=False`):
  - `topic_reset` → clear `topic_stack`, `active_topic=None`, then push the
    new primary topic if present.
  - `topic_shift` (noun-based) → mark stack entries `demoted=True` (retain
    for history), do **not** clear; push the new primary topic when present.
  - Stack cap **10** entries (oldest trimmed).
  - Age (`current_turn - entry.turn > 4`) is computed at read time by
    `build_gateway_context` → effective `active_topic` is `None` for
    demoted/aged-out entries (no mutation).
- `_update_conversation_state` runs after tool execution — including
  `_handle_direct_tool` (forced/slash turns), so `last_tools`/`previous_intent`
  stay fresh on every path.
- `active_job_id` / `active_resume_id` feed `context_builder.build_chat_context`'s
  entity summary; `topic_stack`/effective `active_topic` feed next turn's
  follow-up, shift/reset detectors, and `topic_history` signals.
- Contextual follow-up gate: `_should_handle_jobs_followup` — job-list cards
  **plus** contextual flag or structural job params with a follow-up reference
  (never `active_topic` alone).
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
  detectors, `help`→clarify, `jobs?`→planner; **Phase 2 matrix**: multi-topic
  gate (planner / AUDIT / MARKET / compare / slash precedence), follow-up
  boundary cases (remote-positions → jobs, tech-stack/contacts/compare →
  planner), context-only company/contact entities; **Phase 3**: split
  `_detect_topic_reset` vs noun-based `_detect_topic_shift`, `topic_history`
  on planner-bound decisions.
- `apps/backend/tests/unit/test_chat_gateway_state.py` — persist/context
  roundtrip, topic **demote-on-shift** (stack retained), topic **reset-clears**,
  effective active-topic age-out (turn−entry>4) and demoted-read-as-None,
  stack **cap 10**, direct-tool state writes, `format_gateway_signals`
  (shift/follow-up/history/reset lines), **`_should_handle_jobs_followup` gate**
  (job cards required, skills-only rejected, fresh search rejected).
- `apps/backend/tests/unit/test_chat_gateway_phase3.py` — agent-loop +
  stream context injects `gateway_signals`; agent planner prompt renders the
  block (or `(none)`); `gateway_classification` JSON evidence fields; clarify
  log has no message text.
- `apps/backend/tests/unit/test_chat_prompts.py` — `{gateway_signals}`
  placeholder + full-format KeyError guard (engine kwarg contract), OWN-DATA
  planner rules.

Run: `uv run pytest -q tests/unit/test_chat_gateway.py tests/unit/test_chat_gateway_state.py tests/unit/test_chat_gateway_phase3.py tests/unit/test_chat_prompts.py`
