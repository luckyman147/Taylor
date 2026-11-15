# LLM Integration Guide

> **Multi-provider AI support, JSON handling, and prompt guidelines.**

## Multi-Provider Support

Backend uses LiteLLM to support multiple providers through a unified API:

| Provider | Type | Notes |
|----------|------|-------|
| **Ollama** | Local | Free, runs on your machine |
| **OpenAI** | Cloud | GPT-5 Nano, GPT-4o |
| **Azure AI Foundry** | Cloud | Azure AI Inference / Foundry model endpoints |
| **Anthropic** | Cloud | Claude Haiku 4.5 |
| **Google Gemini** | Cloud | Gemini 3 Flash |
| **OpenRouter** | Cloud | Access to multiple models |
| **DeepSeek** | Cloud | DeepSeek Chat |

## API Key Handling

API keys are passed directly to `litellm.acompletion()` via the `api_key` parameter (not via `os.environ`) to avoid race conditions in async contexts.

```python
# Correct
await litellm.acompletion(
    model=model,
    messages=messages,
    api_key=api_key  # Direct parameter
)

# Incorrect - don't use os.environ in async code
os.environ["OPENAI_API_KEY"] = key  # Race condition risk
```

## JSON Mode

The `complete_json()` function automatically enables `response_format={"type": "json_object"}` for providers that support it:

- OpenAI
- Anthropic
- Gemini
- DeepSeek
- Major OpenRouter models

## Retry Logic

Retries are layered — **transport first, content second, callers last** — so a
429 never multiplies into a retry storm:

1. **Router (transport)** — `litellm.Router` in `_build_router()` retries 429 ×3,
   timeout/500 ×2, and never retries auth/bad-request/content-policy errors.
   Attempts are spaced `retry_after=8` s apart (litellm's default 0.5/1/2 s
   backoff fires all attempts inside ~4 s, which never rides out a Gemini
   "high demand" 503 spike; a provider `Retry-After` header still wins).
2. **`complete_json()` (content)** — up to 2 retries *only* for malformed /
   truncated JSON. A truncated response (`TruncatedJSONError`, unbalanced
   braces or `finish_reason="length"`) retries with a doubled output budget,
   clamped to the model's limit, plus a "return a shorter complete JSON" hint;
   Gemini truncation retries also drop `reasoning_effort` to `minimal` because
   its thinking tokens share `maxOutputTokens`. Transport errors re-raise
   immediately without a second attempt.
3. **Callers (deliberate extra attempt)** — agent steps (`planner`, `evaluate`,
   `generate_answer`, `workflow_generator`) may make **one** extra attempt on a
   rate-limit error via `app.llm.rate_limit_wait()`, which honours a
   `Retry-After` header when the provider sent one (default 15 s, capped 120 s).
   Never write a new multi-round 429 retry loop in a caller.
4. **Endpoint error mapping** — when retries are exhausted,
   `app.llm.is_transient_llm_error()` classifies the failure (walks the
   `__cause__` chain, so `complete()`'s `ValueError` wrapper still classifies):
   transient provider errors (429/5xx/timeouts) become **HTTP 503** with a
   `Retry-After` header and a generic "busy" detail; everything else becomes a
   generic **HTTP 500**. See `_llm_http_error()` in
   `app/routers/enrichment.py` for the reference implementation — details
   stay in server logs only.

## Concurrency & Rate-Limit Protection

- **Global semaphore** (`LLM_MAX_CONCURRENCY = 3`): every upstream call
  (`complete`, `complete_json`, the health probe) runs under
  `async with _llm_semaphore`, so `asyncio.gather` bursts (rerank batches,
  confirm/regenerate fan-out) queue instead of stampeding into the provider's
  RPM/TPM limit. The slot is held across Router-internal retries/backoff.
- **Optional RPM pacing** (`LLM_RPM` env, default `0` = off): when set to your
  tier's per-minute request limit, the Router gets `litellm_params["rpm"]` and
  `enable_pre_call_checks=True`, so over-quota calls fail *locally* with a
  rate-limit error (then back off) instead of earning an upstream 429.

## Usage Accounting

Every completion records `response.usage` into in-memory per-tag counters
(`record_llm_usage` / `get_llm_usage`), keyed by the call site's
`metadata.trace_name` (fallback: `schema_type`/`"complete"`). Totals are
exposed on `GET /api/v1/status` as `llm_usage = {totals, by_tag}` and logged at
`DEBUG`. Counters are process-lifetime only (reset on restart) — see the
single-worker assumption in `apps/backend/CLAUDE.md`.

Email/correspondence call sites pass explicit trace names so they are
attributable in `by_tag`: `outreach_email`, `outreach_email_repair`,
`cover_letter`, `outreach_message`, `resume_title` (all also tagged
`["email", …]`). Company research (`POST /enrichment/research-company`)
makes **no LLM calls at all** — it only crawls and assembles
`research_summary` from the raw content.

## Outreach Email Language

`POST /enrichment/generate-outreach-email` normally writes in the configured
content language (`{output_language}`). Because a user's own template is the
strongest language signal, `app/prompts/language.py::detect_language()` runs a
lightweight heuristic (script ranges for zh/ja/ko; function words + accents
for en/fr/es/pt) over the `instruction` field (falling back to a custom
`custom_purpose`). When it clearly detects a non-English language that differs
from the configured one, that language replaces `{output_language}` and an
explicit override line is added to the instruction block — pasting a French
template produces a French email even when the content language is English.
English detections are ignored on purpose so short English meta-instructions
("keep it under 100 words") never flip a user who set a non-English content
language. Detection is heuristic: when unsure it returns `None` and the
configured language wins (the prompt still tells the model to follow the
language of the user's instructions when they specify one).

## Cover Letter / Outreach Grounding

`generate_cover_letter()` and `generate_outreach_message()` receive job
identity (`company_name`, `job_title`, `job_keywords`) from the router. The
service prepends deterministic context blocks before the resolved
custom/default prompt:

- **Job context**: company, role, industry, seniority, responsibilities,
  required/preferred skills, ATS keywords, plus a rule that ATS/assessment
  vendors are never the employer and platform names must not be invented.
- **Candidate context**: `additional` fields (technical skills, languages,
  certifications, awards, skill groups) and `customSections` — content the
  resume body often omits.

A user instruction is appended after the prompt as `## HIGHEST PRIORITY`, and
an output contract is appended last (letter: 250–350 words, no headings, no
ATS score/metadata; outreach: short, no resume attachment talk, never address
the candidate). This ordering keeps custom prompts verbatim while making the
new constraints win conflicts. Both call sites use
`resolve_correspondence_language(job_description)`: an explicitly configured
`content_language` (or legacy `language`) wins; when unset, the JD's language
is detected, falling back to English. Interview prep uses the same resolver.

## Response Caching

`app/llm_cache.py` provides a SHA-256 content-addressed TTL memo
(`get_or_compute`) with per-key locks so concurrent identical calls share one
upstream request. Use it **only** for deterministic calls (keyword extraction,
entity extraction, resume analysis over fixed text, health probes) — never for
free-form generation. `invalidate()` when prompts or model config change.

`llm_cache.coalesce(key, factory)` is the single-flight variant: concurrent
callers with the same key share one in-flight computation, and **nothing is
retained** afterwards — a later separate call always recomputes. Use it for
expensive user-visible generations where a double-click must not double-bill
the LLM but a deliberate "Regenerate" must produce a fresh result (e.g.
`POST /enrichment/generate-outreach-email`).

## JSON Extraction

Robust bracket-matching algorithm in `_extract_json()` handles:

- Malformed responses
- Markdown code blocks
- Edge cases
- Infinite recursion protection when content starts with `{` but matching fails

## Error Handling Pattern

LLM functions log detailed errors server-side but return generic messages to clients:

```python
except Exception as e:
    logger.error(f"LLM completion failed: {e}")
    raise ValueError("LLM completion failed. Please check your API configuration.")
```

## Adding Prompts

Add new prompt templates to the matching `apps/backend/app/prompts/*.py` SRP module (see the prompt-layout table in `apps/backend/CLAUDE.md`), and re-export any public name from `app/prompts/templates.py`.

### Prompt Guidelines

1. Use `{variable}` for substitution (single braces)
2. Include example JSON schemas for structured outputs
3. Keep instructions concise: "Output ONLY the JSON object, no other text"

### Example

```python
IMPROVE_BULLET = """
Improve this resume bullet point for a {job_title} position.

Current: {current_bullet}

Output ONLY the improved bullet point, no explanations.
"""
```

## Provider Configuration

Users configure their preferred AI provider via:

- Settings page: `/settings`
- API: `PUT /api/v1/config/llm-api-key`

Azure AI Foundry uses LiteLLM's `azure_ai/` route for generic Azure AI Inference endpoints. Foundry-hosted Azure OpenAI endpoints such as `https://<resource>.services.ai.azure.com/openai/v1/responses` are normalized to the service root and routed through LiteLLM's `azure/` provider automatically. Set `LLM_PROVIDER=azure_foundry`, `LLM_MODEL` to the Foundry model or deployment name, `LLM_API_BASE` to the Azure AI endpoint, and store the Foundry API key in the `azure_foundry` key slot.

## Health Checks

The `/api/v1/health` endpoint validates LLM connectivity.

> **Note**: Docker health checks must use `/api/v1/health` (not `/health`).

## Timeouts

All LLM calls have configurable timeouts:

| Operation | Timeout |
|-----------|---------|
| Health checks | 30s |
| Completions | 120s |
| JSON operations | 180s |

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/app/llm.py` | LiteLLM wrapper with JSON mode |
| `apps/backend/app/prompts/templates.py` | Re-export barrel for prompt modules (`improve`, `chat`, `career`, …) |
| `apps/backend/app/prompts/enrichment.py` | Enrichment-specific prompts |
| `apps/backend/app/config.py` | Provider configuration |
