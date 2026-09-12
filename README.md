<p align="center">
  <img src="apps/frontend/public/logo.png" alt="Taylor logo" width="96" height="96" />
</p>

<h1 align="center">Taylor</h1>

<p align="center">AI-powered resume tailoring, cover letters, job scraping and application tracking.</p>

<p align="center"><strong>Taylor</strong> is a full-stack resume automation suite. Paste any job description, pick a master resume built by hand or assembled with the AI-guided wizard, and get a perfectly matched, ATS-friendly resume with a side-by-side diff preview you can review before committing. Beyond tailoring, it grows into your whole job-hunt command center: an AI-grounded cover-letter generator (with LinkedIn/GitHub context), a kanban application tracker, a company pipeline, a contact/recruiter CRM, a job scraper that pulls listings from remote, freelance and Tunisian boards, and a print-optimized PDF export pipeline. It ships with a template-based resume builder (with advanced typography and layout controls), multi-language support, and is LLM-agnostic — OpenAI, Anthropic, Gemini, OpenRouter, Ollama, DeepSeek, Groq and any OpenAI-compatible endpoint.</p>

## Screenshots

| Screenshot | Description |
| --- | --- |
| [Landing page](screenshots/01-landing.png) | Hero with the value proposition, feature highlights, a "how it works" band and the sign-in CTA panel. |
| [Dashboard](screenshots/02-dashboard.png) | Home view — master resume management, quick actions and the entry points for tailoring, the builder and the AI wizard. |
| [Builder](screenshots/03-builder.png) | Template-based resume editor with live preview, section reordering, formatting controls and AI regeneration. |
| [Tailor](screenshots/04-tailor.png) | Paste a job description, pick a master resume and review the side-by-side AI diff before committing the tailored version. |
| [Resume wizard](screenshots/05-resume-wizard.png) | AI-guided setup — answer focused prompts section by section while a live draft preview builds next to you. |
| [Application tracker](screenshots/06-tracker.png) | Kanban board tracking each application through saved → applied → response → interview → accepted/rejected. |
| [Job scraper](screenshots/07-job-scraper.png) | Pull job listings from external sources (RSS, remote boards, Tunisian boards) straight into your search. |
| [Settings](screenshots/08-settings.png) | LLM provider config with Save & Test, content-generation toggles, language, GitHub connection and the danger zone. |
| [Company pipeline](screenshots/09-companies.png) | Track target companies through watching → contacted → applied → interviewing → negotiating → won/lost, with CSV/XLSX import and consolidated filter bar. |
| [Contact CRM](screenshots/10-contacts.png) | Networking and recruiter contacts with goals, relationship types, follow-up dates and CSV/XLSX import. |
| [Interview Practice Hub](screenshots/11-interview-practice.png) | AI-generated interview questions based on your resume and the target job, with a practice mode to rehearse answers. |
| [AI Chat](screenshots/12-ai-chat.png) | Conversational assistant grounded in your resume context — ask questions, get tailoring advice, or brainstorm cover-letter angles. |
| [Profile](screenshots/13-profile.png) | User profile and account settings. |

## Features

- **AI tailoring & regeneration** — one-click resume rewrite against a job description
- **Diff preview** — see exactly what changed before you commit
- **Resume builder** — template-based editing with live preview, section reordering, advanced typography/layout controls and AI regeneration
- **ATS formatting** — clean, single-column, keyword-matched output
- **Application tracker** — kanban board for jobs, statuses, notes
- **Company pipeline** — track target companies through watching → contacted → applied → interviewing → negotiating → won/lost, with CSV/XLSX import
- **Contact CRM** — networking and recruiter contacts with goals, relationship types, follow-up dates and CSV/XLSX import
- **Freelance & scraper support** — pull jobs from external sources (RSS, remote-freelance, Tunisian boards)
- **Multi-language** — tuned for any language the master resume is written in
- **PDF export** — Playwright-rendered, print-optimized
- **MCP integrations** — Exa web search and LinkedIn data pulled straight into the tailoring context
- **LLM-agnostic** — OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, DeepSeek, Groq and any OpenAI-compatible endpoint

## Architecture

```
┌───────────────┐   HTTP/JSON    ┌────────────────────────────────┐
│ Next.js 16    │ ◄────────────► │ FastAPI backend (uvicorn)      │
│ Frontend      │  /api/v1/*     │ - LLM via litellm              │
│ (apps/frontend)│                │ - SQLite (tinydb migrate)     │
└───────────────┘                │ - Playwright parsing          │
                                 │ - Fernet-encrypted keys       │
                                 └──────────────┬─────────────────┘
                                        │ MCP / HTTP
                        ┌───────────────┴──────────────┐
                        │ Exa search      LinkedIn MCP  │
                        │ GitHub API                     │
                        └───────────────────────────────┘
```

Three components can be configured independently and are verified through the backend status endpoint (`GET /api/v1/status` → `llm_configured`, `llm_healthy`, `status: "ready" | "setup_required"`).

## Local development

### 1. Start the backend

```bash
cd apps/backend

# Install (once)
uv sync

# Configure secrets — never commit the real .env
cp .env.example .env

# Run the API server (loads LLM/GitHub/CORS config from .env)
uv run uvicorn app.main:app --reload --port 8002
```

Health check: <http://127.0.0.1:8002/api/v1/health>.

### 2. Start the frontend

```bash
cd apps/frontend
npm install
npm run dev
```

Open <http://localhost:3000>. The frontend proxies `/api/*` to the backend. If you run the backend on a different host/port, set `BACKEND_ORIGIN=http://127.0.0.1:8002` in `apps/frontend/.env` (copy from `.env.sample`).

## 3. Initialize the LLM provider

Pick **one** of these two paths:

**Option A — environment variables** (`apps/backend/.env`):

```env
LLM_PROVIDER=gemini
LLM_MODEL=gemini/gemini-3-flash-preview
LLM_API_KEY=...
LLM_API_BASE=            # leave empty unless your provider requires it
```

Supported values for `LLM_PROVIDER`: `openai`, `openai_compatible`, `anthropic`, `google`/`gemini`, `openrouter`, `deepseek`, `groq`, `ollama`, `azure_foundry`. Model names follow the litellm shorthand — a Gemini model is `gemini/<model-id>`.

`LLM_API_BASE` is only needed for OpenAI-compatible proxies or Ollama (e.g. `http://localhost:11434/v1`).

**Option B — the Settings UI** (no env file needed):

1. Create a master resume in the app (or use the wizard).
2. Go to **Settings → LLM Provider**.
3. Pick your provider, paste the model and API key, hit **Save & Test** (uses the provider's `/chat/completions`).

The UI stores the key **encrypted** in the SQLite database using a Fernet key in `apps/backend/data/.secret_key`. This is the trade-off: you can manage providers at runtime without touching `.env`, but if the `data/` volume is deleted (or you re-clone without `data/`), the stored keys are unrecoverable and you must re-enter them.

**Verify:** `GET http://127.0.0.1:8002/api/v1/status` → `"llm_configured": true` and `"llm_healthy": true`.

## 4. Connect GitHub (from the Settings page)

`Settings → GitHub Repositories` connects your GitHub account so the app can load your repos (used when tailoring resumes for open-source contributions).

**Option A — OAuth button (requires backend config):**

1. Register a GitHub OAuth app at `https://github.com/settings/developers/apps`, with the callback URL set to your frontend URL: `<FRONTEND_BASE_URL>/settings`.
2. Add to `apps/backend/.env`:

   ```env
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

3. Restart the backend, then in **Settings → GitHub Repositories → Connect GitHub**. After authorization the token is stored server-side.

**Option B — Personal Access Token (recommended, no backend config):**

1. Create a token at `https://github.com/settings/tokens/new?scopes=repo,user`.
2. In **Settings → GitHub Repositories → Use Personal Access Token**, paste the `github_pat_...`/`ghp_...` value and connect.

After connecting, the status row shows the authenticated user and the repository list is populated (name, visibility, language, topics, stars). Token persistence note: the credential is stored **only** in `apps/backend/data/github_token.json` (gitignored, stays on the server, removable with Disconnect).

## 5. One-paste AI setup prompt

Paste the block below into any coding assistant (opencode, Claude Code, Cursor, …) and it will walk you through configuring credentials and starting every server automatically. It asks you for each key the moment it is needed and never writes a secret into tracked files.

```text
Set up my Resume Matcher project locally and configure everything. Read ./README.md,
apps/backend/.env.example and apps/backend/.env.sample first. Treat any file in apps/backend/.env,
apps/frontend/.env, config/mcporter.json and apps/backend/data/ as SECRET — write real keys
ONLY there, never into tracked files or commit/push them.

1. BACKEND
   - cd apps/backend && uv sync
   - Copy .env.example to .env if it does not already exist.
   - Ask me for my LLM provider (one of: openai, anthropic, gemini, openrouter, deepseek,
     groq, ollama, openai_compatible), the model id (e.g. gemini/gemini-3-flash-preview), and
     the API key. Fill LLM_PROVIDER, LLM_MODEL and LLM_API_KEY in apps/backend/.env. Leave the
     placeholders untouched in .env.example.
   - Start it: uv run uvicorn app.main:app --reload --port 8002

2. FRONTEND
   - In another terminal: cd apps/frontend && npm install && npm run dev  (serves :3000)
   - If the backend runs somewhere other than 127.0.0.1:8002, set BACKEND_ORIGIN in
     apps/frontend/.env accordingly.

3. VERIFY
   - curl http://127.0.0.1:8002/api/v1/status and confirm "llm_configured": true and
     "llm_healthy": true. If not, ask me for the correct key/model and retry.

4. GITHUB CONNECT (Settings → GitHub Repositories)
   - Offer me two options:
     a) OAuth app: ask for GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, help me register an OAuth
        app at github.com/settings/developers/apps with the callback URL <frontend>/settings,
        add the two vars to apps/backend/.env, restart the backend, then open the app's
        "Connect GitHub" button so the browser flow completes.
     b) Personal Access Token: tell me to create one at
        github.com/settings/tokens/new?scopes=repo,user and paste it into
        Settings → GitHub Repositories → Use Personal Access Token.
   - Verify the connect worked (status shows the user, repo list is populated).

5. EXA MCP
   - Ask me for my Exa API key (dashboard.exa.ai). Install exa-mcp-server
     (npm i -g exa-mcp-server) and register it in config/mcporter.json with the key.

6. LINKEDIN MCP — OPEN THE LOGIN PAGE
   - pip install mcp-server-linkedin, then run the first-login flow:
     npx fastmcp run mcp-server-linkedin --login --no-headless
   - When the browser opens the LinkedIn login page, tell me to sign in there; after I do,
     verify the session with the server's status command (--status) and register the linkedin
     entry in config/mcporter.json.

7. OPEN EVERYTHING
   - Open http://localhost:3000 in the browser.
   - Open the LinkedIn connect/login page and the MCP configuration section of the Settings UI.
   - Confirm both servers stay running (uvicorn :8002 and Next.js :3000) and report the full
     /api/v1/status at the end.
```

## 6. Docker / production

A multi-stage `Dockerfile` builds the Next.js standalone output plus the Python backend and serves both behind a single Node `server.js`:

```bash
docker build -t resume-matcher .
docker run -p 3000:3000 \
  -v resume-data:/app/backend/data \
  -e LLM_PROVIDER=gemini \
  -e LLM_MODEL=gemini/gemini-3-flash-preview \
  -e LLM_API_KEY=... \
  resume-matcher
```

Or with Compose — `docker-compose.yml` already maps the env vars (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_API_BASE`, `FRONTEND_BASE_URL`, `CORS_ORIGINS`), exposes port 3000 and mounts the `resume-data` volume:

```bash
docker compose up --build
```

> Data note: all app state (SQLite DB, uploaded resumes, encrypted keys, `github_token.json`) lives under `apps/backend/data`. Keep that volume backed up.

## 7. Initialize MCP servers

MCP servers (Exa search + LinkedIn) enrich the app's context during tailoring. Both are configured in `config/mcporter.json` — which contains real API keys and must never be committed.

**Exa (web search):**

```bash
npm i -g exa-mcp-server
# get a key at https://dashboard.exa.ai/ → "API Keys"
export EXA_API_KEY=...            # or put in config/mcporter.json
config/mcporter add exa --command exa-mcp-server
```

**LinkedIn:**

```bash
pip install mcp-server-linkedin
```

The LinkedIn MCP needs an interactive, non-headless login on first use — run it **once** as a standalone server to approve the browser login and store the session token:

```bash
# First login — a visible browser opens for the OAuth/SIMple OTP flow
npx fastmcp run mcp-server-linkedin --login --no-headless
```

After the login succeeds, run it so the token is picked up by the app, and register it:

```bash
npx fastmcp run mcp-server-linkedin --profile linkedin --no-headless
config/mcporter.json  add the "linkedin" entry
```

Once registered, the app surfaces MCP state in **Settings** and through the API:

- `GET /api/v1/mcp/status` — per-server status
- `POST /api/v1/mcp/configure` — apply stored configuration
- `POST /api/v1/mcp/restart` — restart registered servers

## 8. Security checklist

Secrets are **never** part of this repository. `.gitignore` protects them, so verify you're not force-adding anything:

| Path | Content | Keep out of git |
| --- | --- | --- |
| `apps/backend/.env` | LLM/GitHub/CORS secrets | ✔ (ignored via `.env*`) |
| `.env`, `.env.local`, `.env.*` | any runtime env | ✔ (use `.env.sample`/`.env.example` as tracked templates) |
| `config/mcporter.json` | MCP API keys (e.g. EXA) | ✔ |
| `apps/backend/data/` | SQLite, `.secret_key`, `github_token.json` | ✔ (only `.gitkeep` is tracked) |
| `*.log` | runtime logs (incl. linkedin-mcp.log) | ✔ |

## Troubleshooting

- **Status shows `setup_required`** → no `LLM_API_KEY`/provider set, or no master resume yet. Check `/api/v1/status` and the two bullet points above (LLM init, master resume creation).
- **Frontend can't reach the API** → confirm the backend runs on port 8002 and `BACKEND_ORIGIN` in `apps/frontend/.env` matches; restart both dev servers.
- **Gemini model not found** → the `LLM_PROVIDER` id is `gemini` (so the model id reads `gemini/…`), not `google`.
- **Settings can't connect GitHub** → use the PAT flow (Option B), or set the OAuth app's callback URL exactly to `<frontend>/settings` and restart the backend.
- **Ollama / local models** → set `LLM_PROVIDER=ollama` and `LLM_API_BASE=http://localhost:11434/v1`.
```