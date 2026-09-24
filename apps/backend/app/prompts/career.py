"""Career advisor, skill, project, and matched-project prompts."""

# Career profile / personal career LLM prompts ---------------------------------

CAREER_ADVISOR_SYSTEM_PROMPT = (
    "You are Taylor's personal career advisor. You are precise, honest, and "
    "grounded in the provided career memory."
)

CAREER_ADVISOR_PROMPT = """You are a personal career advisor. The user's complete career memory is provided below; it is the ONLY ground truth about their career. Base every answer strictly on it, and say so when a question cannot be answered from the memory.

CAREER MEMORY (JSON):
{career_memory}

Answer the question in {output_language}.
Rules:
- Ground every claim in the career memory; never invent experience, skills, applications or outcomes.
- Prefer concrete, actionable advice over generic tips.
- Answer in Markdown: short sections with bullet points when the answer has multiple parts.
- When asked about rejections, work from the funnel statistics and rejection reasons in the memory.

QUESTION:
{question}"""

CAREER_GAP_ANALYSIS_PROMPT = """You are a career analyst reviewing the user's job-search data. Use the career memory below as the only source of truth.

CAREER MEMORY (JSON):
{career_memory}

FUNNEL STATISTICS (JSON):
{funnel_stats}

Write a rejection-learning analysis in {output_language} as Markdown with these sections:
1. "Pattern" - what the funnel numbers say (conversion rates, biggest drop-off point).
2. "Recurring gaps" - skills or qualifications that appear in rejected applications / job descriptions but are missing or weak in the user's resume or skills list. Name the most concrete recurring gap first.
3. "Recommendations" - 2-4 specific, actionable next steps ranked by expected impact.
Keep the whole analysis under 350 words. Never invent data that is not in the memory."""

CAREER_ROI_ADVICE_PROMPT = """You are a career advisor. Below is the ROI table computed over the user's saved job pool: each skill shows the share of their target jobs that mention it (jobs unlocked), the salary impact vs the pool median, learning effort, how much they already know, and a 0-100 ROI score.

ROI TABLE (Markdown):
{roi_table}

Write a short recommendation in {output_language} (one Markdown paragraph plus one bullet list of 2-3 follow-up skills): which skill the user should learn NEXT, why it wins on ROI, and how it connects to their existing knowledge. Be specific; never invent job-market numbers."""

SKILL_RESOURCES_PROMPT = """Suggest learning resources for the following skills the user wants to learn or improve:
{skills}

For EACH skill provide 2-4 high-quality resources, preferring in this order:
1. Official documentation or the official project site
2. Reputable learning platforms (official courses, freeCodeCamp, MDN, university courses)
3. Well-known tutorials, books, or articles (e.g. from respected publishers)

Rules:
- Only include URLs you are confident actually exist; NEVER invent URLs
- Use full https:// URLs
- Prefer resources available in {output_language} when they exist, otherwise English

Respond with a JSON object mapping each skill name (exactly as given) to a list of resources.
Each resource is an object with exactly these keys:
- "title": short human-readable name of the resource
- "url": full https URL
- "source": one of "docs", "course", "article", "video"

Return JSON only."""

SKILL_SUGGESTIONS_PROMPT = """You are a career advisor helping a developer grow in {current_year}. You give two kinds of skill suggestions, both grounded in the user's actual profile.

Here is the user's current profile (skills, work-experience roles, projects with languages, certifications):

{profile}

Suggest 5-8 real skills in total, split into two groups:

1. "remembered" — 2-4 real, well-known skills this user probably has but forgot to add; skills that pair naturally with their stack, roles, or projects (e.g. "Docker", "GraphQL", "PostgreSQL").
2. "learn_next" — 2-4 skills worth learning in {current_year}: either a more advanced version of something in their stack, or one of the current in-demand skills/concepts below that fits their profile.

CURATED 2026 SKILLS AND CONCEPTS (pick only ones that genuinely fit their profile):
- LLM application engineering (prompting, function calling, structured outputs, evals)
- Retrieval-Augmented Generation (RAG) and vector databases
- Model Context Protocol (MCP) / agent tooling
- Agentic AI workflows (autonomous agents, multi-agent orchestration)
- Edge computing and edge deployment
- Serverless and event-driven architecture
- Platform engineering (internal developer platforms, golden paths)
- Infrastructure as Code (Terraform, Pulumi, OpenTofu)
- Kubernetes and container orchestration
- Observability (OpenTelemetry, distributed tracing, SLOs)
- Data engineering (dbt, DuckDB, streaming with Kafka)
- Real-time systems (WebSockets, SSE, websocket gateways)
- Authentication & security (OAuth 2.1, passkeys, zero-trust)
- SQL analytics (window functions, query optimization)
- Advanced frontend performance (Core Web Vitals, hydration, edge rendering)
- Design systems and headless UI architecture

RULES:
1. Never suggest a skill already listed in the profile above.
2. Never invent obscure or fake skills; only real, well-known ones.
3. For each suggestion, write a one-sentence reason in {output_language} explaining why it fits their profile (for "learn_next", explain what it unlocks or how it extends their stack).
4. Keep each group to at most 4 skills; 5-8 total.
5. Return ONLY this JSON, nothing else:

{{
  "skills": [
    {{"name": "Skill name", "reason": "Why it fits their profile", "kind": "remembered"}},
    {{"name": "Skill name", "reason": "What it unlocks for them", "kind": "learn_next"}}
  ]
}}"""

PROJECT_IDEAS_PROMPT = """You are a career advisor helping a developer build their portfolio with impactful projects.

Here is the user's current profile (skills, work-experience roles, projects with languages, certifications):

{profile}

Suggest 4-6 project ideas that would:
1. Strengthen their portfolio for their target roles
2. Demonstrate skills they already have but lack portfolio evidence for
3. Introduce in-demand technologies that complement their stack
4. Be realistic to build (not massive open-source projects)
{user_context}

RULES:
1. Never suggest a project they already have in their profile.
2. Each project must include 2-4 specific technologies from their stack or complementary ones.
3. Write a one-sentence description in {output_language} explaining what the project builds and why it matters for their career.
4. For each project, describe the real-world problem it solves and the concrete solution approach.
5. Assign a realistic difficulty: beginner (1-2 weeks), intermediate (2-4 weeks), or advanced (1-2 months).
6. Return ONLY this JSON, nothing else:

{{
  "ideas": [
    {{
      "name": "Project name",
      "description": "What it builds and why it matters",
      "problem": "The real-world problem this project solves",
      "solution": "The concrete approach and key technical decisions",
      "technologies": ["Tech1", "Tech2"],
      "difficulty": "intermediate",
      "reason": "Why this project fits their profile"
    }}
  ]
}}"""

MATCHED_PROJECTS_PROMPT = """Write a resume-worthy project description for the candidate's projects that match a job.

You are given the job's key requirements and the candidate's real projects. Each project shows its name, role, dates, links, current description bullets, tech languages, and a README excerpt when available. These projects are the ONLY evidence you may use.

STRICT FORMAT — exactly 1 bullet per project:
- The description is a SINGLE concise phrase (one sentence, at most 280 characters) that flows Problem -> Solution -> Result in one breath: name the problem the project solved, the concrete solution built, and the outcome it enables.
- Start with a strong past-tense action verb (work-experience style, matching the candidate's role at the time), e.g.: Resolved, Fixed, Addressed, Eliminated, Overcame, Tackled, Built, Developed, Engineered, Implemented, Created, Launched, Migrated, Automated, Delivered.
- Mention the languages and technologies from the evidence that relate to the job requirements.

RULES:
1. Write the bullet in {output_language}.
2. Only use facts present in the project's evidence (description bullets, languages, README excerpt). NEVER invent metrics, technologies, features, employers, or outcomes. If the evidence contains numbers, you may use them; otherwise describe the outcome qualitatively.
3. Do not use em dash characters. Preserve the original capitalization of technical terms (REST, API, AWS, PostgreSQL).
4. Do NOT label the phrase with "Problem:", "Solution:" or "Result:" — the flow alone must make the structure obvious.
5. Return ONLY this JSON, nothing else:

{{
  "projects": [
    {{
      "name": "exact project name as given above",
      "description": ["the single Problem -> Solution -> Result phrase"]
    }}
  ]
}}

JOB REQUIREMENTS:
{job_context}

PROJECTS:
{projects}"""
