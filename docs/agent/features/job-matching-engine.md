# Job Matching Engine (TAYLOR)

> **Profile-driven job discovery**: the user's tracked career skills **and** work
> experience decide what jobs get fetched, how they are scored, and which ones
> are worth seeing.

## Overview

The job scraper used to fetch jobs from static keywords and show everything it
found. Now a deterministic matching engine (TAYLOR) builds a **profile snapshot**
from the user's career skills + work experience and:

1. **Decides what to fetch** — generates search queries from role families and
   top skills (Q1..Q5, capped at 5) used to fan out to the job sources.
2. **Scores every job** — skills (45%) + experience (25%) + seniority (15%) +
   fit (15%) + small bonuses (remote / recency / easy-apply).
3. **Filters the results** — hides irrelevant jobs, keeps stretch jobs, reports
   "X jobs found, Y relevant".
4. **Extracts JD metadata at save time** — role family, seniority, required /
   preferred skills stored on each saved draft (deterministic pass; an LLM
   upgrade can run on-demand via job-intel).

## How It Works

### 1. Profile snapshot (`build_profile_snapshot`)

Deterministic view of the user used by the engine:

- `skill_names` / `skill_terms` — tracked career skills, category-grouped
- `role_families` — from career-profile work experience, target roles, and
  market-position recommended roles (resume work experience is the fallback
  when the career profile has none)
- `seniority_band` — intern / mid / senior from the market-position role
- `experience_years` — summed from work-experience date ranges
- `target_locations` — used for the remote bonus

The snapshot is empty (and the engine falls back to resume-derived keywords +
substring scoring) when the user has no tracked skills.

### 2. Tiered skill matching (`match_skills`)

| Tier | Score | Meaning |
|------|-------|---------|
| EXACT | 1.00 | Skill (or alias) appears in the JD |
| RELATED | 0.85 | A strongly-related skill (relationship >= 0.8) appears |
| ECOSYSTEM | 0.70 | Same category/domain skill appears, or weak relationship |
| UNRELATED | 0.20 | No relationship |

Word-boundary matching (e.g. "NestJS" never counts as "JS", "PostgreSQL" never
counts as "SQL"). The ontology lives in
`app/services/skill_ontology.py::_ONTOLOGY` (aliases, category, weight, related).

### 3. Title taxonomy & seniority

- 7 role families (`TITLE_TAXONOMY`): Software Engineer, Backend Engineer,
  Frontend Engineer, Mobile Developer, DevOps Engineer, Data Engineer,
  Full Stack Developer. Token-set matching handles reordered titles
  ("Full Stack Software Engineer" => Full Stack Developer family).
- Seniority bands (intern / mid / senior): equal band = 1.0; each band the job
  demands **above** the profile costs 0.35; under-levelled jobs cost 0.15/band.
- Negative keywords per family (sales, HR, etc.) penalize the fit score.

### 4. Search queries (`build_search_queries`)

- Q1/Q2: `"<family>" <top-2 skills>` for the primary + secondary role family
- Q3: top-5 skills
- Q4: most populated skill category
- Capped at 5, deduped. Q1 pre-fills the search box / drives the fetch.

### 5. Scoring & filtering (`_score_jobs`)

```
overall = 0.45*skills + 0.25*experience + 0.15*seniority + 0.15*fit + bonus
```

- **>= 0.55** — shown as a match
- **0.35–0.55** — shown only when the title matches the **primary** role
  family, flagged `is_stretch: true` (stretch job)
- **< 0.35** — hidden

`JobSearchResponse.total_found` reports the raw count before filtering, so the
UI can show "X jobs found, Y relevant".

### 6. Save-time metadata

`save_scraped_jobs` runs `extract_requirements` on each description
(deterministic): role family, seniority level, required / preferred /
contextual skills (sentence-scoped context: "must have" = required,
"preferred/plus" = preferred, "exposure to / knowledge of" = familiarity,
which dominates "plus"), and years-of-experience. Stored in
`scraped_jobs.metadata_json` (idempotent ALTER in `db_engine.init_models_sync`).

## API

| Endpoint | Change |
|----------|--------|
| `GET /job-scraper/profile-keywords/{resume_id}` | `suggested_keywords` is now the generated Q1 query (profile-driven); resume-parsed skills are only the fallback |
| `POST /job-scraper/search` | Results filtered by relevance; `total_found` = raw count; `is_stretch` flag per job |
| `GET /job-scraper/drafts/{resume_id}` | Each draft now includes `metadata` (the extracted JD requirements) |

## Key Files

| File | Purpose |
|------|---------|
| `app/services/skill_ontology.py` | The engine: ontology, taxonomy, tiers, context, negatives, queries, extraction (dependency-free, purely unit-testable) |
| `app/services/job_scraper.py` | `_load_profile_snapshot`, `_generated_keywords`, `_score_jobs`, `_score_relevance` (fallback) |
| `app/routers/job_scraper.py` | Endpoints: profile-keywords, search, drafts |
| `app/schemas/job_scraper.py` | `JobSearchResponse.total_found`, `JobListing.is_stretch`, `ScrapedJobResponse.metadata` |
| `app/database.py` | `save_scraped_jobs` metadata extraction; `get_scraped_jobs` returns `metadata` |
| `app/models.py` / `app/db_engine.py` | `ScrapedJob.metadata_json` column + idempotent migration |
| `tests/unit/test_skill_ontology.py` | Table-driven engine tests (tiers, titles, seniority, context, negatives, queries, extraction) |
| `tests/service/test_job_scraper_scoring.py` | Match / stretch / hidden filtering + fallback tests |

## Design Notes

- The engine is **deterministic** — same profile + JD always scores the same;
  no LLM call on the hot path. LLM-based JD analysis remains available on-demand
  via job-intel.
- `app/services/skill_ontology.py` must stay **dependency-free** (no db/LLM
  imports) to keep the unit tests pure.
- The isolated-DB test fixture patches `app.services.job_scraper.db` (it binds
  `db` at import time, like career-graph / career-profile).
- Thresholds (`_MATCH_THRESHOLD = 0.55`, `_STRETCH_THRESHOLD = 0.35`) and the
  scoring weights live at the top of `_score_jobs` in `job_scraper.py` — the
  natural tuning knobs.