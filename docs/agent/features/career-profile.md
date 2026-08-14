# Career Profile (Personal Career LLM)

> **A dedicated "My Profile" page: career memory, skill ROI engine, and an AI career advisor that answers questions about your actual job-search data.**

## Overview

`/profile` (sidebar entry after Contact Tracker, `UserRound` icon) is a four-tab page:

| Tab | Purpose |
|-----|---------|
| **Overview** | Funnel stats (rejection rate, applied→interview, interview→accepted, median days to interview) + optional LLM rejection-learning narrative |
| **Profile** | Career profile CRUD (contact info, summary, goals, target roles/locations/salary), skills, certifications |
| **Skill ROI** | Deterministic "what to learn next" table scored over the user's saved job descriptions; optional LLM recommendation |
| **AI Chat** | Ask anything about your career; the advisor answers over an aggregated memory bundle |

## Key Design Decisions

- **Local-first, no external data sources.** ROI is computed from job descriptions saved via the Job Scraper (plus skills/proficiency the user tracks in the profile). Nothing is fetched from the web at request time (GitHub repo summaries reuse the existing optional GitHub token).
- **Career memory bundle.** Every LLM feature runs over one aggregated JSON snapshot (`build_career_memory()`) with hard caps so prompt size stays bounded (~35k chars): master resume ≤6000 chars, job descriptions ≤1500 chars each, 20 rejected applications, 25 scraped jobs, 50 contacts, 10 GitHub repos.
- **Funnel math is deterministic and null-safe.** Rates are `null` when the denominator is 0; `median_days_to_interview` is computed only from interview-stage cards (`applied_at` → `updated_at`).
- **ROI formula (weighted, 0–100):** `0.35 × jobs-unlocked% + 0.25 × salary + 0.20 × learning ease + 0.20 × existing knowledge`. Salary impact only counts when ≥3 matching jobs have parsable salary strings (`$80,000 - 100,000`, `$80k-$100k`, `€60K`); learning effort is `low`/`medium`/`high` from the skill catalog. By default the table lists catalog skills present in the job pool that the user doesn't track yet.
- **Chat is non-streaming** request/response with the last ≤8 turns as history; answers render as Markdown.
- **Prompt-injection hygiene:** user questions are run through `_sanitize_user_input` (same guard as the improver pipeline); memory content is truncated before prompt assembly.
- **Tracker enrichment:** applications gain optional `rejection_reason` + `interview_rounds` (editable in the card detail modal, used by memory + gap analysis). The columns are added to existing databases via an idempotent `ALTER TABLE` migration.
- **LLM-optional:** insights narrative, ROI advice and chat answers degrade gracefully (`null` narrative/advice, 503 on `/ask`) when no LLM key is configured; the rest of the page works fully offline.
- **Comma-separated extraction:** skills, languages, certifications and awards extracted from a resume are split on commas/semicolons (commas inside parentheses preserved) and deduped case-insensitively — at parse time in `AdditionalInfo._normalize_string_fields` (see `app/schemas/models.py`) and again in `seed-from-master` (`_merge_resume_skills` / `_string_list_from_resume`) so previously-parsed resumes also get clean, individual entries.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /profile` | Bundle: `{profile, skills, certifications}` (auto-creates the profile row) |
| `PUT /profile` | Upsert profile (contact, summary, goals, targets, salary) |
| `POST /profile/seed-from-master` | Copy personal info from the master resume (`404` without one) |
| `POST /profile/skills` | Add skill (`201`; `409` case-insensitive duplicate) |
| `PATCH /profile/skills/{id}` | Update skill (`409` rename-onto-duplicate, `404` unknown) |
| `DELETE /profile/skills/{id}` | Delete skill |
| `POST /profile/certifications` | Add certification (`201`) |
| `PATCH /profile/certifications/{id}` | Update certification |
| `DELETE /profile/certifications/{id}` | Delete certification |
| `GET /profile/memory` | Career memory bundle (debug/reuse) |
| `POST /profile/ask` | Career advisor chat (`503` when LLM off) |
| `GET /profile/insights` | Funnel stats + optional LLM narrative |
| `POST /profile/skill-roi` | ROI table (+ optional LLM advice) |
| `GET /profile/suggestions?field=` | Tag suggestions (`career_goals`/`target_roles`/`target_locations`) from scraped jobs + work history; goals are role-derived templates localized to the content language |

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/app/services/career_profile.py` | Memory bundle, funnel, ROI, chat, gap analysis |
| `apps/backend/app/routers/profile.py` | All `/profile` endpoints |
| `apps/backend/app/schemas/profile.py` | Pydantic request/response models |
| `apps/backend/app/prompts/templates.py` | `CAREER_ADVISOR_*`, `CAREER_GAP_ANALYSIS_PROMPT`, `CAREER_ROI_ADVICE_PROMPT` |
| `apps/backend/app/models.py` / `app/database.py` | `career_profiles` / `career_skills` / `career_certifications` tables + facade |
| `apps/frontend/app/(default)/profile/page.tsx` | Page shell (SidebarNav + ProfilePage) |
| `apps/frontend/app/(default)/chat/page.tsx` | AI chat page shell (SidebarNav + CareerChatTab) |
| `apps/frontend/components/profile/*.tsx` | Overview / Profile / Skill ROI tabs + chat + dialogs |
| `apps/frontend/lib/api/profile.ts` | API client + types |
| `apps/frontend/components/tracker/card-detail-modal.tsx` | Rejection reason + interview rounds fields |
| `apps/frontend/messages/{en,fr,es,zh,ko,ja,pt-BR}.json` | `nav.profile` + `profile` namespace |

## Testing

- Backend: `tests/integration/test_profile_api.py` (38 tests, real isolated DB) — CRUD, dedupe, seed-from-master (incl. comma-split of merged skills/languages), memory shape, deterministic ROI (incl. profile-skill rows), suggestions, chat 503/200 with mocked LLM. Plus `tests/unit/test_additional_info_split.py` (7 tests) for the comma/semicolon splitting + case-insensitive dedupe of additional fields.
- Frontend: `tests/api-profile.test.ts` (14 tests) — method/URL/payload contracts + error detail surfacing.
- Suite state: backend 623 passed (1 known Windows-only crypto perms failure), frontend 241 passed incl. locale parity.
