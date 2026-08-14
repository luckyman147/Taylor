# API Flow Maps

> Request/response flows for all Resume Matcher endpoints.

## Resume Upload

```
POST /api/v1/resumes/upload
├── Validate file (PDF/DOCX, ≤4MB)
├── parse_document() → Markdown
├── db.create_resume(status="processing")
├── parse_resume_to_json() → LLM
│   ├── Success: status="ready"
│   └── Failure: status="failed"
└── Return {resume_id}
```

## Resume Improvement

```
POST /api/v1/resumes/improve
├── Fetch resume + job from DB
├── extract_job_keywords() → LLM
├── improve_resume() → LLM
├── [If enabled] generate_cover_letter() → LLM
├── [If enabled] generate_outreach_message() → LLM
├── [If enabled] generate_interview_prep() → LLM
├── db.create_resume(improved)
├── db.create_improvement()
└── Return {data, cover_letter, outreach_message, interview_prep}
```

## Interview Prep Generation

```
POST /api/v1/resumes/{id}/generate-interview-prep
├── Require tailored resume (parent_id)
├── Fetch improvement record and associated job description
├── Require processed resume data
├── generate_interview_prep() → LLM JSON
├── Validate InterviewPrepData
├── Save resumes.interview_prep as serialized JSON TEXT
└── Return {interview_prep, message}
```

## PDF Generation

```
GET /api/v1/resumes/{id}/pdf
├── Fetch resume from DB
├── Build URL: {frontend}/print/resumes/{id}?{params}
├── Playwright render (wait for .resume-print)
└── Return PDF bytes
```

## Health Check

```
GET /api/v1/health
└── Return {status: "healthy"}        # pure liveness — does NOT call the LLM
```

## System Status

```
GET /api/v1/status                    # each check isolated → 200 (partial/degraded), never 500
├── try: get_llm_config()
│   ├── llm_configured = api_key set OR provider ∈ {ollama, openai_compatible}
│   └── check_llm_health() → llm_healthy   # failure here degrades only this field
├── try: db.get_stats()                     # failure → empty stats, still 200
└── Return {status, llm_configured, llm_healthy, has_master_resume, database_stats}
```

## Configuration Update

```
PUT /api/v1/config/llm-api-key
├── _load_config()
├── Merge new NON-SECRET values (provider/model/base/...)
├── (no longer persists any key — keys go through /config/api-keys)
├── _save_config()
└── Return masked config
```

## API Keys (per-provider, encrypted)

```
GET /api/v1/config/api-keys
└── Return {providers: [{provider, configured, masked_key}]}   # always masked

POST /api/v1/config/api-keys
├── For each provided provider key:
│   └── Fernet-encrypt → upsert into SQLite `api_keys` table   # other providers' keys untouched
└── Return {message, updated_providers}

DELETE /api/v1/config/api-keys/{provider}      # remove one provider's key
DELETE /api/v1/config/api-keys?confirm=...     # clear all keys
```

## Job Upload

```
POST /api/v1/jobs/upload
├── For each description:
│   └── db.create_job()
└── Return {job_id[]}
```

## Resume Operations

| Endpoint | Flow |
|----------|------|
| `GET /resumes?id=` | db.get_resume() |
| `GET /resumes/list` | db.list_resumes() |
| `PATCH /resumes/{id}` | db.update_resume() |
| `DELETE /resumes/{id}` | db.delete_resume() |

## Application Tracker

```
GET /api/v1/applications
├── db.list_applications()
└── Return {columns}        # grouped by the 7 status keys (all present):
                            #   saved/applied/no_response/response/interview/accepted/rejected

POST /api/v1/applications   # manual add from a pasted JD
├── db.create_job(jd)
├── [If company/role missing] extract_job_keywords() → LLM   # one best-effort call
├── db.create_application(status default "applied")          # dedupes on (job_id, resume_id)
└── Return Application

GET /api/v1/applications/{id}
├── db.get_application() + embed job_content + applied resume
└── Return {..., job_content, resume}    # resume: null if it was deleted
```

| Endpoint | Flow |
|----------|------|
| `PATCH /applications/{id}` | db.update_application() — status/position/notes/company/role/applied_at; server renumbers `position` |
| `PATCH /applications/bulk` | db.bulk_update_status() — move many cards to one column |
| `DELETE /applications/{id}` | db.delete_application() |
| `POST /applications/bulk-delete` | db.bulk_delete_applications() |

> **Auto-create:** `POST /resumes/improve/confirm` (and legacy `POST /resumes/improve`) create an `applied` card after persisting the tailored resume — best-effort (a tracker failure never breaks tailoring); company/role reuse the cached keyword extraction, so no extra LLM call.

## Company Tracker

```
GET /api/v1/companies
├── db.list_companies()
└── Return {companies}        # ordered by name (case-insensitive)

POST /api/v1/companies        # create — only name required
├── db.create_company()       # dedupes on name (case-insensitive): returns existing row
└── Return Company

POST /api/v1/companies/import # CSV or Excel (.xlsx) upload
├── db.get_company_by_name()  # skip rows whose name already exists
├── db.create_company()       # per valid row
└── Return {created, skipped, errors: [{row, name, error}]}
    # headers matched flexibly (name/email/phone/address/website/size/type/
    # linkedin/industry/founded aliases)
    # optional `mapping` form field (JSON {field: exact header}) pins columns:
    # only mapped fields are imported (no alias fallback)
    # size accepts friendly forms ("51-200 employees"); bad rows are
    # reported, never fatal

POST /api/v1/companies/import/headers # read columns of a CSV/Excel file
└── Return {headers: [..], detected: {field: header}}  # no DB writes

GET /api/v1/companies/{id}    # db.get_company()
PATCH /api/v1/companies/{id}  # db.update_company() — partial; 409 on duplicate rename
DELETE /api/v1/companies/{id} # db.delete_company()
```

| Field | Type | Notes |
|-------|------|-------|
| `company_size` | string enum | `1-10 \| 11-50 \| 51-200 \| 201-1000 \| 1000+` |
| `company_type` | string enum | `startup \| agency \| enterprise \| nonprofit \| education \| government \| other` |
| `year_founded` | int | validated 1600–2100 |
| `email`/`website`/`linkedin_url` | string | stored plain; linked client-side |

## Career Profile (`/profile`)

```
GET /api/v1/profile
├── db.get_career_profile()    # auto-creates an empty row on first visit
├── db.list_career_skills() / db.list_career_certifications()
└── Return {profile, skills, certifications}

PUT /api/v1/profile            # upsert; creates the row when absent
└── db.update_career_profile() # editable: contact fields, summary, career_goals,
                               #   target_roles/locations, target_salary_min/max

POST /api/v1/profile/seed-from-master
├── db.get_master_resume()     # 404 without a master
└── db.update_career_profile() # copies name/title/email/phone/location/website/
                               #   linkedin/github from processed_data.personalInfo

POST /api/v1/profile/skills    # 201; 409 on case-insensitive duplicate name
└── db.create_career_skill()
PATCH /api/v1/profile/skills/{id}   # db.update_career_skill(); 409 rename-onto-duplicate; 404 unknown
DELETE /api/v1/profile/skills/{id}  # db.delete_career_skill() → {message, affected}

POST /api/v1/profile/certifications       # 201; db.create_career_certification()
PATCH /api/v1/profile/certifications/{id} # db.update_career_certification(); 404 unknown
DELETE /api/v1/profile/certifications/{id}# db.delete_career_certification() → {message, affected}

GET /api/v1/profile/memory
├── services/career_profile.build_career_memory()   # no LLM; pure aggregation
│   ├── master resume (≤6000 chars) + profile + skills + certifications
│   ├── compute_funnel_stats(applications)          # deterministic
│   ├── last 20 rejected applications (company/role/reason)
│   ├── ≤25 non-archived scraped jobs (title/company/location/url)
│   ├── ≤50 contacts
│   └── ≤10 GitHub repos via routers.github._get_token()/_github_api()
└── Return {profile, master_resume, skills, certifications, funnel,
            rejected_applications, scraped_jobs, contacts, github_repos}

POST /api/v1/profile/ask      # {question, history ≤8}
├── [503 if no LLM key configured]
├── CAREER_ADVISOR_PROMPT.format(career_memory ≤35k chars, sanitized question, output_language)
├── complete(system_prompt=CAREER_ADVISOR_SYSTEM_PROMPT, max_tokens=4096)
└── Return {answer}           # Markdown

GET /api/v1/profile/insights
├── build_career_memory() → funnel stats (always)
├── [LLM off → narrative: null] generate_gap_analysis() → CAREER_GAP_ANALYSIS_PROMPT
└── Return {stats, narrative}

POST /api/v1/profile/skill-roi  # {skills?, include_advice?} — no LLM required
├── db.list_scraped_jobs_for_analysis()   # non-archived jobs with descriptions
├── compute_skill_roi(jobs, profile_skills, skills)   # pure, deterministic
│   ├── default: catalog skills in the job pool missing from the profile
│   ├── ROI = 0.35·jobs_unlocked% + 0.25·salary + 0.20·learning ease + 0.20·existing
│   └── salary impact only when ≥3 matching jobs with parsable salary strings
├── [include_advice and LLM on] generate_roi_advice(top 10 rows)
└── Return {results, advice, note}
```

> **Funnel stats** (drives Overview + insights): `rejection_rate = rejected ÷ (applied+no_response+response+interview+accepted+rejected)`; `applied_to_interview_rate = interviewed ÷ applied`; `interview_to_accepted_rate = accepted ÷ interviewed`; `median_days_to_interview` = median `applied_at→updated_at` across interview-stage cards. Null when a denominator is 0.
>
> **Tracker enrichment:** applications carry optional `rejection_reason` (text) and `interview_rounds` (int) — set via `PATCH /applications/{id}` (null clears), consumed by the memory bundle and gap analysis. The columns are added on existing databases by an idempotent `ALTER TABLE` migration in `init_models_sync`.
