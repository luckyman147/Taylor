"""Resume improve/tailor prompts, diff strategy, and skill target plan."""

IMPROVE_RESUME_PROMPT_NUDGE = """Lightly nudge this resume toward the job description. Output ONLY the JSON object, no other text.

{critical_truthfulness_rules}

IMPORTANT: Generate ALL text content (summary, descriptions, skills) in {output_language}.
Do NOT include personalInfo in your output - it will be preserved from the original resume.

Rules:
- Make minimal, conservative edits only where there is a clear existing match
- Do NOT change the candidate's role, industry, or seniority level
- Do NOT introduce new tools, technologies, or certifications not already present
- Do NOT add new bullet points or sections
- Preserve original bullet count and ordering within each section
- Preserve descriptionStyles arrays and keep them aligned one-to-one with description arrays
- Keep proper nouns (names, company names, locations) unchanged
- For customSections: preserve exact structure, item count, titles, subtitles, and years. If an item's description is an empty array [] in the original, keep it empty []. Do NOT generate descriptions for items that had none.
- Copy the "years" field values EXACTLY as they appear in the original resume (including any month prefixes like "Jan 2020 - Present"). Do not shorten, reformat, or drop months.
- If the resume is non-technical, do NOT add technical jargon
- Do NOT use em dash ("—") anywhere in the writing/output, even if it exists, remove it

Job Description:
{job_description}

Keywords to emphasize (only if already supported by resume content):
{job_keywords}

Original Resume:
{original_resume}

Output in this JSON format:
{schema}"""

IMPROVE_RESUME_PROMPT_KEYWORDS = """Enhance this resume with relevant keywords from the job description. Output ONLY the JSON object, no other text.

{critical_truthfulness_rules}

IMPORTANT: Generate ALL text content (summary, descriptions, skills) in {output_language}.
Do NOT include personalInfo in your output - it will be preserved from the original resume.

Rules:
- Strengthen alignment by weaving in relevant keywords where evidence already exists
- You may rephrase bullet points to include keyword phrasing using the STAR method with evidence validation: S (Situation) = brief context; T (Task) = what the candidate owned; A (Action) = what they actually did; R (Result) = what changed — ONLY if the original provides a concrete metric. When no result exists, write an action-focused bullet (A only). Do not use impact adverbs or vague claims ("significantly", "substantially", "seamless", "seamlessly", "optimize", "optimizing", "optimized", "minimize", "minimizing", "minimized", "enhance", "enhancing", "enhanced", "streamline", "streamlining", "streamlined"). Formula: Action verb + what you did + how you did it + [optional result].
- Do NOT introduce new skills, tools, or certifications not in the resume
- Do NOT change role, industry, or seniority level
- Preserve descriptionStyles arrays and keep them aligned one-to-one with description arrays
- For customSections: preserve exact structure, item count, titles, subtitles, and years. If an item's description is an empty array [] in the original, keep it empty []. Do NOT generate descriptions for items that had none.
- Copy the "years" field values EXACTLY as they appear in the original resume (including any month prefixes like "Jan 2020 - Present"). Do not shorten, reformat, or drop months.
- If resume is non-technical, keep language non-technical while still aligning keywords
- Do NOT use em dash ("—") anywhere in the writing/output, even if it exists, remove it

Job Description:
{job_description}

Keywords to emphasize:
{job_keywords}

Original Resume:
{original_resume}

Output in this JSON format:
{schema}"""

IMPROVE_RESUME_PROMPT_FULL = """Tailor this resume for the job. Output ONLY the JSON object, no other text.

{critical_truthfulness_rules}

IMPORTANT: Generate ALL text content (summary, descriptions, skills) in {output_language}.
Do NOT include personalInfo in your output - it will be preserved from the original resume.

Rules:
- Make targeted adjustments to bullet points to align with job description phrasing. Preserve the candidate's original details and voice - adjust wording, do not rewrite entirely.
- When rewriting bullets, use the STAR method with evidence validation: S (Situation) = brief context; T (Task) = what the candidate owned; A (Action) = what they actually did using precise verbs; R (Result) = what changed — ONLY if the original provides a concrete metric. When no result exists, write an action-focused bullet (A only). Do not use impact adverbs or vague claims ("significantly", "substantially", "seamless", "seamlessly", "optimize", "optimizing", "optimized", "minimize", "minimizing", "minimized", "enhance", "enhancing", "enhanced", "streamline", "streamlining", "streamlined"). Use leadership verbs (Spearheaded, Architected) only when the original shows full ownership. Formula: Action verb + what you did + how you did it + [optional result].
- DO NOT invent new information
- Preserve existing action verbs. Do not invent quantifiable achievements not in the original.
- Keep proper nouns (names, company names, locations) unchanged
- Translate job titles, descriptions, and skills to {output_language}
- Preserve descriptionStyles arrays and keep them aligned one-to-one with description arrays
- For customSections: preserve exact structure, item count, titles, subtitles, and years. If an item's description is an empty array [] in the original, keep it empty []. Do NOT generate descriptions for items that had none.
- Improve custom section content the same way as standard sections
- Copy the "years" field values EXACTLY as they appear in the original resume (including any month prefixes like "Jan 2020 - Present"). Do not shorten, reformat, or drop months.
- Calculate and emphasize total relevant experience duration when it matches requirements
- When writing or rewriting the summary, use the formula-based approach:
  STEP 1 — Identify the Engineer: Determine professional identity (Junior Software Engineer, Full-Stack Developer, Frontend Developer, Backend Developer, Mobile Developer, Software Engineering Graduate). Do not assign seniority not supported by experience.
  STEP 2 — Extract Relevant Evidence: Technologies from JD, demonstrated in experience, verified metrics. Do not invent.
  STEP 3 — Select Formula: A (Junior): hands-on + projects + seeking to contribute. B (Full-Stack): frontend + backend + application types. C (Achievement): expertise + delivered achievement. D (Experience): experience + developed contributions.
  STEP 4 — Write: 3-4 sentences, ~50-80 words, ATS-friendly, use JD keywords naturally. Do not use "passionate", "results-driven", "highly motivated" unless supported.
  STEP 5 — Validate: every skill supported by profile or JD, every achievement verified, no unsupported metrics, strongest qualifications first.
- Do NOT use em dash ("—") anywhere in the writing/output, even if it exists, remove it

Job Description:
{job_description}

Keywords to emphasize:
{job_keywords}

Original Resume:
{original_resume}

Output in this JSON format:
{schema}"""

IMPROVE_PROMPT_OPTIONS = [
    {
        "id": "nudge",
        "label": "Light nudge",
        "description": "Minimal edits to better align existing experience.",
    },
    {
        "id": "keywords",
        "label": "Keyword enhance",
        "description": "Blend in relevant keywords without changing role or scope.",
    },
    {
        "id": "full",
        "label": "Full tailor",
        "description": "Comprehensive tailoring using the job description.",
    },
    {
        "id": "recruiter",
        "label": "Recruiter tailor",
        "description": "Recruiter-grade tailoring with evidence mapping and ATS readability.",
    },
]

IMPROVE_RESUME_PROMPT_RECRUITER = """You are an experienced technical recruiter and resume editor specializing in software engineering hiring. Your task is to tailor the candidate's resume to the target job description while preserving factual accuracy, making the resume sound human-written, and optimizing it for both ATS systems and recruiters.

{critical_truthfulness_rules}

IMPORTANT: Generate ALL text content (summary, descriptions, skills) in {output_language}.
Do NOT include personalInfo in your output - it will be preserved from the original resume.

# CORE PRINCIPLE

Do NOT rewrite the resume simply to make it "sound better."
Rewrite it to make the candidate's existing evidence more relevant, specific, credible, and easy to scan for this particular role.

The final resume must answer:
1. What role is this candidate targeting?
2. What technologies and skills does the candidate actually have?
3. Where has the candidate demonstrated those skills?
4. What results or outcomes did the candidate achieve?
5. Why should a recruiter interview this candidate for THIS job?

# 1. FACTUAL ACCURACY

Never invent technologies, frameworks, programming languages, databases, cloud platforms, certifications, responsibilities, job titles, employers, dates, metrics, achievements, users, revenue, performance improvements, team sizes, project scale, production usage, architecture, methodologies, or tools.
Never upgrade a skill from "used" to "expert" unless the source explicitly supports that level.
Never create a metric.
Never convert an assumption into a fact.
If a job requirement is missing from the candidate's evidence, DO NOT add it merely because it appears in the job description.

# 2. JOB DESCRIPTION ANALYSIS

Before modifying the resume, extract:
- Target job title, required/preferred technical skills, programming languages, frameworks, databases, cloud/DevOps technologies, architecture concepts, development methodologies, domain knowledge, soft skills explicitly requested, seniority expectations, most important recurring keywords, responsibilities, evidence the employer appears to value most

Rank requirements:
- Tier 1 (Critical): Requirements explicitly emphasized or repeated
- Tier 2 (Important): Requirements directly related to the role
- Tier 3 (Supporting): Useful but secondary

Do not treat every keyword as equally important.

# 3. EVIDENCE MAPPING

For every important requirement, search the candidate's resume and supplied project/GitHub evidence for proof.
Create: Requirement -> Candidate evidence -> Strength
Do NOT strengthen weak evidence by inventing experience.

# 4. PROFESSIONAL SUMMARY

Write a concise, ATS-friendly summary tailored to the target job.

STEP 1 — Identify the Engineer: Determine professional identity (Junior Software Engineer, Full-Stack Developer, Frontend Developer, Backend Developer, Mobile Developer, Software Engineering Graduate). Do not assign seniority not supported by experience.

STEP 2 — Extract Relevant Evidence: Technologies from JD, demonstrated in experience, verified metrics. Do not invent.

STEP 3 — Select Formula: A (Junior): hands-on + projects + seeking to contribute. B (Full-Stack): frontend + backend + application types. C (Achievement): expertise + delivered achievement. D (Experience): experience + developed contributions.

STEP 4 — Write: 3-4 sentences, ~50-80 words, ATS-friendly, use JD keywords naturally. Do not use "passionate", "results-driven", "highly motivated" unless supported.

STEP 5 — Validate: every skill supported by profile or JD, every achievement verified, no unsupported metrics, strongest qualifications first.

# 5. EXPERIENCE BULLETS — STAR METHOD

Rewrite each bullet using the STAR method with evidence validation:
- S (Situation): Brief context or problem (one clause)
- T (Task): What the candidate was responsible for
- A (Action): What they actually did — use precise verbs (Built, Developed, Implemented, Designed, Integrated, Automated, Deployed, Refactored, Delivered)
- R (Result): What changed — ONLY if the original provides a concrete metric or outcome

When no result is available, write an action-focused bullet (A only) and skip R entirely.
Do not use impact adverbs or vague claims ("significantly", "substantially", "greatly", "dramatically", "seamless", "seamlessly", "optimize", "optimizing", "optimized", "minimize", "minimizing", "minimized", "enhance", "enhancing", "enhanced", "streamline", "streamlining", "streamlined").
Use leadership verbs (Spearheaded, Architected, Led) only when the original shows full system or team ownership.
Formula: Action verb + what you did + how you did it + [optional result].
Example: "Built 15+ end-to-end features using Flutter and Clean Architecture for a 50+ member organization."
Preserve the candidate's original details and voice.

# 6. TECHNICAL SPECIFICITY

Prefer: "Developed REST APIs using ASP.NET Core and SQL Server"
Over: "Developed backend solutions."

Prefer: "Implemented role-based authorization for five user types"
Over: "Implemented secure access."

# 7. PROJECTS

For each relevant project:
1. Show the project name
2. Show the relevant technology stack
3. Explain what was actually built
4. Highlight technically relevant functionality
5. Include measurable results only when supported
6. Prioritize projects relevant to the target role

ONLY include technologies supported by the candidate's evidence.

# 8. SKILLS SECTION

Create a clean, ATS-readable technical skills section using categories:
Languages, Frontend, Backend, Databases, Cloud & DevOps, Tools, Architecture

Keep EVERY original skill from the candidate's source material. Do NOT remove or re-categorize skills - the pipeline handles categorization and prioritization downstream.

Prioritize skills that are:
1. Explicitly required by the job
2. Strongly supported by candidate evidence
3. Relevant to the target role

Do not add a technology solely because it appears in the job description.

# 9. ATS KEYWORD OPTIMIZATION

Use the terminology from the job description when it accurately describes the candidate's experience.
Use natural keyword placement across: Summary, Skills, Experience, Projects.
Do not repeat the same keyword unnaturally.
ATS optimization means improving terminology and discoverability, NOT keyword stuffing.

# 10. HUMAN-LIKE WRITING

Avoid repetitive AI-generated verbs. Do not begin every bullet with: Streamlined, Enhanced, Leveraged, Spearheaded, Optimized, Revolutionized, Transformed, Utilized.
Use precise verbs: Built, Developed, Implemented, Designed, Integrated, Automated, Deployed, Refactored, Configured, Maintained, Migrated, Tested, Reduced, Increased, Delivered, Established.
Choose the verb that accurately describes the work - do not artificially vary verbs.

# 11. REMOVE GENERIC CORPORATE LANGUAGE

Avoid: "reliable backend services", "strong cloud-based capabilities", "seamless user experience", "robust solutions", "innovative solutions", "cutting-edge technologies", "high-quality software", "efficient workflows", "business-critical applications" - unless the surrounding content explains specifically what makes them so.
Replace vague phrases with technical or measurable evidence.

# 12. PRESERVE STRONG EXISTING METRICS

If the original resume contains credible metrics (40% reduction, 20+ features, 25+ API endpoints, 50+ users), preserve them when relevant.
Do not remove useful metrics. Do not invent new metrics.

# 13. RELEVANCE OVER COMPLETENESS

The resume is NOT a database of everything the candidate has ever done.
Emphasize experiences most relevant to the target role.
Less relevant experience may be shortened but must remain factually accurate.
Do not delete a major experience unless explicitly instructed.

# 14. RECRUITER TEST

After rewriting, evaluate as a recruiter with 10-20 seconds to scan.
Ask: Can I identify the target role? Strongest technical skills? Technologies easy to find? Evidence of actual use? Strongest achievements visible? Projects technically specific? Anything exaggerated? Anything AI-generated? Unnecessary buzzwords? Easy to skim?
If not, revise.

# 15. ATS SAFETY

Use: standard section headings, plain text, one-column structure, conventional job titles, conventional date formats, simple bullet points, clearly labeled technical skills.
Avoid: tables, text boxes, skill bars, excessive icons, graphics, decorative elements, multi-column layouts, important info hidden in headers/footers.

# 16. FINAL VALIDATION

Before producing the final resume:
- Accuracy: Every claim supported by source material
- Relevance: Strongest content corresponds to target job
- ATS: JD terminology appears naturally where supported
- Human quality: Remove generic AI language and buzzwords
- Evidence: Technical claims have evidence in Experience or Projects
- Consistency: No contradictions in dates, titles, technologies
- Interview defensibility: Candidate can explain every technical claim

Rules:
- Preserve descriptionStyles arrays and keep them aligned one-to-one with description arrays
- For customSections: preserve exact structure, item count, titles, subtitles, and years. If an item's description is an empty array [] in the original, keep it empty []. Do NOT generate descriptions for items that had none.
- Improve custom section content the same way as standard sections
- Copy the "years" field values EXACTLY as they appear in the original resume (including any month prefixes like "Jan 2020 - Present"). Do not shorten, reformat, or drop months.
- Keep proper nouns (names, company names, locations) unchanged
- Preserve original capitalization of technical terms (REST, API, AWS)
- Translate job titles, descriptions, and skills to {output_language}
- Preserve original action verbs; do not invent quantifiable achievements
- Do NOT use em dash ("\u2014") anywhere in the writing/output, even if it exists, remove it

GitHub / Project Evidence:
{github_context}

Job Description:
{job_description}

Keywords to emphasize (only if already supported by resume content):
{job_keywords}

Original Resume:
{original_resume}

Output in this JSON format:
{schema}

Return the tailored resume ONLY as the JSON object matching the schema.
Do not include additional fields like target_role, missing_or_weak_requirements, changes_made, or recruiter_concerns - those are computed separately by the pipeline.
Output ONLY the JSON."""

IMPROVE_RESUME_PROMPTS = {
    "nudge": IMPROVE_RESUME_PROMPT_NUDGE,
    "keywords": IMPROVE_RESUME_PROMPT_KEYWORDS,
    "full": IMPROVE_RESUME_PROMPT_FULL,
    "recruiter": IMPROVE_RESUME_PROMPT_RECRUITER,
}

DEFAULT_IMPROVE_PROMPT_ID = "keywords"

# Backward-compatible alias
IMPROVE_RESUME_PROMPT = IMPROVE_RESUME_PROMPT_FULL
# Diff-based improvement: outputs targeted changes instead of full resume

DIFF_STRATEGY_INSTRUCTIONS = {
    "nudge": "Make minimal edits. Only rephrase where there is a clear match. Do not add new bullet points.",
    "keywords": "Weave in relevant keywords where evidence already exists. You may rephrase bullets using the STAR method (Action + Result) but do not add new ones.",
    "full": "Make targeted adjustments. You may rephrase bullets using the STAR method (Situation -> Task -> Action -> Result), add verified JD skills, and add new bullets that elaborate on existing work, but do not invent new responsibilities.",
}
DIFF_STRATEGY_INSTRUCTIONS["recruiter"] = "Make targeted adjustments. You may rephrase bullets using the STAR method (Situation -> Task -> Action -> Result), add verified JD skills, and add new bullets that elaborate on existing work, but do not invent new responsibilities. Apply the recruiter-grade tailoring approach: evidence mapping, factual accuracy, technical specificity, and ATS optimization."

SKILL_TARGET_PLAN_PROMPT = """Build a concise skill target plan for tailoring this resume to the job.

Return ONLY a JSON object. Do not rewrite the resume.

Rules:
1. Prefer required and preferred JD skills.
2. Include existing resume skills that are highly relevant to the JD.
3. You may include JD skills that are missing from the resume skills list.
4. Do not include skills unrelated to the JD.
5. Do not include certifications.
6. Generate reasons in {output_language}.

Existing resume skills:
{existing_skills}

JD keywords and skills:
{job_keywords}

Job Description:
{job_description}

Resume JSON:
{original_resume}

Output this exact JSON format:
{{
  "target_skills": [
    {{
      "skill": "skill name",
      "reason": "why this skill should be emphasized"
    }}
  ],
  "strategy_notes": "brief notes for the next editing pass"
}}"""

DIFF_IMPROVE_PROMPT = """Given this resume and job description, output a JSON object with targeted changes to better align the resume with the job.

RULES:
1. Only modify content; never change names, companies, dates, institutions, or degrees
2. Do not invent metrics or achievements not supported by the original resume text
3. Do not add new work entries, education entries, or project entries
4. {strategy_instruction}
5. Each change MUST include the original text (copied exactly) so it can be verified
6. For each change, explain WHY it helps match the job description
7. Generate all new text in {output_language}
8. Do not use em dash characters
9. Keep changes minimal and targeted; do not rewrite content that already aligns well
10. Exception to rule 2: you may add a skill only if it appears in the verified skill targets below
11. By DEFAULT, scan the summary and every work, project, and education description for content that already demonstrates a job-description keyword or skill, and reframe that text using the job description's terminology where it is not already phrased that way (per rule 9, leave content that already aligns well), while preserving the candidate's actual accomplishment. Do NOT add new work, metrics, or responsibilities; only restate existing content in the JD's language, and verify every reframe stays factually accurate.
12. Preserve original capitalization, especially for proper nouns, technical terms (e.g., REST, API, AWS), and acronyms. Do not change the casing of words that were capitalized in the original.
13. When rewriting project descriptions, reference technologies and patterns from the GitHub repos listed above if they relate to the job description. Use repo languages, topics, and descriptions as evidence of skills, but do not add new project entries.
14. When the summary is rewritten (path "summary"), use the formula-based approach:
  STEP 1 — Identify the Engineer: Determine professional identity (Junior Software Engineer, Full-Stack Developer, Frontend Developer, Backend Developer, Mobile Developer, Software Engineering Graduate). Do not assign seniority not supported by experience.
  STEP 2 — Extract Relevant Evidence: Technologies from JD, demonstrated in experience, verified metrics. Do not invent.
  STEP 3 — Select Formula: A (Junior): hands-on + projects + seeking to contribute. B (Full-Stack): frontend + backend + application types. C (Achievement): expertise + delivered achievement. D (Experience): experience + developed contributions.
  STEP 4 — Write: 3-4 sentences, ~50-80 words, ATS-friendly, use JD keywords naturally. Do not use "passionate", "results-driven", "highly motivated" unless supported.
  STEP 5 — Validate: every skill supported by profile or JD, every achievement verified, no unsupported metrics, strongest qualifications first.
15. When rewriting experience or project bullet points, apply the STAR method with evidence validation: S (Situation) = brief context; T (Task) = what the candidate owned; A (Action) = what they actually did using precise verbs (Built, Developed, Implemented, Designed, Integrated, Automated, Delivered); R (Result) = what changed — ONLY if the original provides a concrete metric or outcome. When no result is available, write an action-focused bullet (A only) and skip R. Do not use impact adverbs or vague claims ("significantly", "substantially", "greatly", "seamless", "seamlessly", "optimize", "optimizing", "optimized", "minimize", "minimizing", "minimized", "enhance", "enhancing", "enhanced", "streamline", "streamlining", "streamlined"). Use leadership verbs (Spearheaded, Architected, Led) only when the original shows full system or team ownership. Formula: Action verb + what you did + how you did it + [optional result].

PATHS you can target:
- "summary" — the resume summary text
- "workExperience[i].description[j]" — a specific bullet (i = entry index, j = bullet index)
- "workExperience[i].description" — append a new bullet (action: "append")
- "personalProjects[i].description[j]" — a specific project bullet
- "personalProjects[i].description" — append a new project bullet (action: "append")
- "education[i].description" — the education entry's description text (replace only; it is a single string, not a list)
- "additional.technicalSkills" — reorder the skills list (action: "reorder") or add one verified skill (action: "add_skill")
- "additional.languages" — reorder the languages list (action: "reorder")
- "additional.certificationsTraining" — reorder the certifications list (action: "reorder")
- "additional.awards" — reorder the awards list (action: "reorder")

Do NOT target: personalInfo, dates/years, company names, education degree/institution/years, customSections.

Keywords to emphasize (only if already supported by resume content):
{job_keywords}

Verified skill targets:
{skill_targets}

GitHub repos matching this job (use as context for enriching existing project descriptions only):
{github_repos}

Job Description:
{job_description}

Original Resume:
{original_resume}

Output this exact JSON format, nothing else:
{{
  "changes": [
    {{
      "path": "workExperience[0].description[1]",
      "action": "replace",
      "original": "the exact original text at this path",
      "value": "the improved text",
      "reason": "why this change helps"
    }},
    {{
      "path": "summary",
      "action": "replace",
      "original": "the current summary text",
      "value": "the improved summary",
      "reason": "why this change helps"
    }},
    {{
      "path": "additional.technicalSkills",
      "action": "reorder",
      "original": null,
      "value": ["most relevant skill first", "then next", "..."],
      "reason": "reordered to prioritize JD-relevant skills"
    }},
    {{
      "path": "additional.technicalSkills",
      "action": "add_skill",
      "original": null,
      "value": "verified skill target missing from the skills list",
      "reason": "added verified JD skill for review"
    }}
  ],
  "strategy_notes": "brief summary of the tailoring approach"
}}"""
