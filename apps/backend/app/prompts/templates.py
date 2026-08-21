"""LLM prompt templates for resume processing."""

# Language code to full name mapping
LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "zh": "Chinese (Simplified)",
    "ja": "Japanese",
    "pt": "Brazilian Portuguese",
    "fr": "French",
    "ko": "Korean",
}


def get_language_name(code: str) -> str:
    """Get full language name from code."""
    return LANGUAGE_NAMES.get(code, "English")


# Schema with example values - used for prompts to show LLM expected format
RESUME_SCHEMA_EXAMPLE = """{
  "personalInfo": {
    "name": "John Doe",
    "title": "Software Engineer",
    "email": "john@example.com",
    "phone": "+1-555-0100",
    "location": "San Francisco, CA",
    "website": "https://johndoe.dev",
    "linkedin": "linkedin.com/in/johndoe",
    "github": "github.com/johndoe"
  },
  "summary": "Experienced software engineer with 5+ years...",
  "workExperience": [
    {
      "id": 1,
      "title": "Senior Software Engineer",
      "company": "Tech Corp",
      "location": "San Francisco, CA",
      "years": "Jan 2020 - Present",
      "description": [
        "Led development of microservices architecture",
        "Improved system performance by 40%"
      ],
      "descriptionStyles": ["bullet", "bullet"]
    }
  ],
  "education": [
    {
      "id": 1,
      "institution": "University of California",
      "degree": "B.S. Computer Science",
      "years": "2014 - 2018",
      "description": "Graduated with honors"
    }
  ],
  "personalProjects": [
    {
      "id": 1,
      "name": "Open Source Tool",
      "role": "Creator & Maintainer",
      "years": "Mar 2021 - Present",
      "description": [
        "Built CLI tool with 1000+ GitHub stars",
        "Used by 50+ companies worldwide"
      ],
      "descriptionStyles": ["bullet", "bullet"]
    }
  ],
  "additional": {
    "technicalSkills": ["Python", "JavaScript", "AWS", "Docker"],
    "languages": ["English (Native)", "Spanish (Conversational)"],
    "certificationsTraining": ["AWS Solutions Architect"],
    "awards": ["Employee of the Year 2022"]
  },
  "customSections": {
    "publications": {
      "sectionType": "itemList",
      "items": [
        {
          "id": 1,
          "title": "Paper Title",
          "subtitle": "Journal Name",
          "years": "Jun 2023",
          "description": ["Brief description of the publication"],
          "descriptionStyles": ["bullet"]
        }
      ]
    },
    "volunteer_work": {
      "sectionType": "text",
      "text": "Description of volunteer activities..."
    }
  }
}"""

# Schema for improve prompts - excludes personalInfo (preserved from original)
IMPROVE_SCHEMA_EXAMPLE = """{
  "summary": "Experienced software engineer with 5+ years...",
  "workExperience": [
    {
      "id": 1,
      "title": "Senior Software Engineer",
      "company": "Tech Corp",
      "location": "San Francisco, CA",
      "years": "Jan 2020 - Present",
      "description": [
        "Led development of microservices architecture",
        "Improved system performance by 40%"
      ],
      "descriptionStyles": ["bullet", "bullet"]
    }
  ],
  "education": [
    {
      "id": 1,
      "institution": "University of California",
      "degree": "B.S. Computer Science",
      "years": "2014 - 2018",
      "description": "Graduated with honors"
    }
  ],
  "personalProjects": [
    {
      "id": 1,
      "name": "Open Source Tool",
      "role": "Creator & Maintainer",
      "years": "Mar 2021 - Present",
      "description": [
        "Built CLI tool with 1000+ GitHub stars",
        "Used by 50+ companies worldwide"
      ],
      "descriptionStyles": ["bullet", "bullet"]
    }
  ],
  "additional": {
    "technicalSkills": ["Python", "JavaScript", "AWS", "Docker"],
    "languages": ["English (Native)", "Spanish (Conversational)"],
    "certificationsTraining": ["AWS Solutions Architect"],
    "awards": ["Employee of the Year 2022"]
  },
  "customSections": {
    "publications": {
      "sectionType": "itemList",
      "items": [
        {
          "id": 1,
          "title": "Paper Title",
          "subtitle": "Journal Name",
          "years": "Jun 2023",
          "description": ["Brief description of the publication"],
          "descriptionStyles": ["bullet"]
        }
      ]
    },
    "volunteer_work": {
      "sectionType": "text",
      "text": "Description of volunteer activities..."
    }
  }
}"""

PARSE_RESUME_PROMPT = """Parse this resume into JSON. Output ONLY the JSON object, no other text.

Map content to standard sections when possible. For non-standard sections (like Publications, Volunteer Work, Research, Hobbies), add them to customSections with an appropriate type.

Example output format:
{schema}

Custom section types:
- "text": Single text block (e.g., objective, statement)
- "itemList": List of items with title, subtitle, years, description (e.g., publications, research)
- "stringList": Simple list of strings (e.g., hobbies, interests)

Rules:
- Use "" for missing text fields, [] for missing arrays, null for optional fields
- Number IDs starting from 1
- For workExperience, personalProjects, and custom itemList items, include descriptionStyles with one value for each description row. Use "bullet" for normal bullet rows and "plain" for rows that should render without a bullet marker (for example subheadings or standalone labels).
- Format dates preserving the original precision. Keep months when present: "Jan 2020 - Dec 2023", "May 2021 - Present". Use "YYYY - YYYY" only when the source has no months.
- Use snake_case for custom section keys (e.g., "volunteer_work", "publications")
- Preserve the original section name as a descriptive key
- Normalize date separators: "2020-2021" → "2020 - 2021", "Current"/"Ongoing" → "Present". Do NOT discard months.
- For ambiguous dates like "3 years experience", infer approximate years from context or use "~YYYY"
- Flag overlapping dates (concurrent roles) by preserving both, don't merge
- Split comma-separated or semicolon-separated items in technicalSkills, languages, certificationsTraining, and awards into separate list entries, one per item (e.g. "Angular, React" becomes two entries). Do not split commas inside parentheses (e.g. keep "PHP (Laravel, Symfony)" as one entry).

Resume to parse:
{resume_text}"""

EXTRACT_KEYWORDS_PROMPT = """Extract job requirements as JSON. Output ONLY the JSON object, no other text.

Example format:
{{
  "company": "Acme Corp",
  "role": "Senior Backend Engineer",
  "required_skills": ["Python", "AWS"],
  "preferred_skills": ["Kubernetes"],
  "experience_requirements": ["5+ years"],
  "education_requirements": ["Bachelor's in CS"],
  "key_responsibilities": ["Lead team"],
  "keywords": ["microservices", "agile"],
  "experience_years": 5,
  "seniority_level": "senior"
}}

Extract numeric years (e.g., "5+ years" → 5) and infer seniority level.
Set "company" to the hiring company name and "role" to the job title exactly as
written in the posting; use an empty string for either if it is not stated.

Job description:
{job_description}"""

CRITICAL_TRUTHFULNESS_RULES_TEMPLATE = """CRITICAL TRUTHFULNESS RULES - NEVER VIOLATE:
1. DO NOT add any skill, tool, technology, or certification that is not explicitly mentioned in the original resume
2. DO NOT invent numeric achievements (e.g., "increased by 30%") unless they exist in original
3. DO NOT add company names, product names, or technical terms not in the original
4. DO NOT upgrade experience level (e.g., "Junior" -> "Senior")
5. DO NOT add languages, frameworks, or platforms the candidate hasn't used
6. DO NOT extend employment dates or change timelines. Copy date ranges exactly as they appear, including months.
7. {rule_7}
8. Preserve factual accuracy - only use information provided by the candidate
9. NEVER remove existing skills, certifications, languages, or awards. You may reorder by relevance, but every original item must remain.

Violation of these rules could cause serious problems for the candidate in job interviews.
"""


def _build_truthfulness_rules(rule_7: str) -> str:
    return CRITICAL_TRUTHFULNESS_RULES_TEMPLATE.format(rule_7=rule_7)


CRITICAL_TRUTHFULNESS_RULES = {
    "nudge": _build_truthfulness_rules(
        "DO NOT add new bullet points or content - only rephrase existing content"
    ),
    "keywords": _build_truthfulness_rules(
        "You may rephrase existing bullet points to include keywords, but do NOT add new bullet points"
    ),
    "full": _build_truthfulness_rules(
        "You may expand existing bullet points or add new ones that elaborate on existing work, but DO NOT invent entirely new responsibilities"
    ),
    "recruiter": _build_truthfulness_rules(
        "You may expand existing bullet points or add new ones that elaborate on existing work, but DO NOT invent entirely new responsibilities"
    ),
}

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
- You may rephrase bullet points to include keyword phrasing
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
- DO NOT invent new information
- Preserve existing action verbs. Do not invent quantifiable achievements not in the original.
- Keep proper nouns (names, company names, locations) unchanged
- Translate job titles, descriptions, and skills to {output_language}
- Preserve descriptionStyles arrays and keep them aligned one-to-one with description arrays
- For customSections: preserve exact structure, item count, titles, subtitles, and years. If an item's description is an empty array [] in the original, keep it empty []. Do NOT generate descriptions for items that had none.
- Improve custom section content the same way as standard sections
- Copy the "years" field values EXACTLY as they appear in the original resume (including any month prefixes like "Jan 2020 - Present"). Do not shorten, reformat, or drop months.
- Calculate and emphasize total relevant experience duration when it matches requirements
- When writing or rewriting the summary, build it with the C-WHAT formula and cover all four elements in 2-3 concise sentences: WHO = the candidate's professional identity (title, seniority, years of experience); WHAT = their specialization and the job-relevant skills; RESULT = measurable impact or evidence of results (only facts present in the original resume — never invented); HOW = the technologies and methodologies they use.
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

Create a concise summary using the C-WHAT formula (2-3 concise sentences):
- WHO: Professional identity / target role (title, seniority, years)
- WHAT: Most relevant technical specialization and job-relevant skills
- RESULT: Measurable impact or evidence of results (only facts present in the original resume - never invented)
- HOW: Technologies and methodologies used

Do not use: "passionate", "motivated", "results-driven", "dynamic", "innovative", "highly skilled", "proven track record", "detail-oriented", "team player", "tech enthusiast", "leveraging cutting-edge technologies", "committed to excellence" - unless genuinely supported.
Prefer concrete technical language.

# 5. EXPERIENCE BULLETS

Rewrite using: ACTION -> CONTEXT -> RESULT
Each bullet: What the candidate did, what they worked on, how they did it, what changed because of it.
Prefer measurable evidence when available. Do not force a metric - a strong non-quantified bullet is better than an invented number.

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

COVER_LETTER_PROMPT = """Write a brief cover letter for this job application.

IMPORTANT: Write in {output_language}.

Job Description:
{job_description}

Candidate Resume (JSON):
{resume_data}

Requirements:
- 100-150 words maximum
- 3-4 short paragraphs
- Opening: Reference ONE specific thing from the job description (product, tech stack, or problem they're solving) - not generic excitement about "the role"
- Middle: Pick 1-2 qualifications from resume that DIRECTLY match stated requirements, and reframe them in the job's language/terminology where the candidate's proven experience supports it (e.g., if the resume shows "built automated data pipelines" and the job says "ETL," describe that real work as ETL) - prioritize relevance over impressiveness
- Closing: Simple availability to discuss, no desperate enthusiasm
- If resume shows career transition, frame the pivot as intentional and relevant
- Extract company name from job description - do not use placeholders
- Do NOT invent information not in the resume
- Tone: Confident peer, not eager applicant
- Do NOT use em dash ("—") anywhere in the writing/output, even if it exists, remove it
- Do NOT add any "ATS Match Analysis", "ATS Score", match analysis, or similar meta section after the letter - the letter ends with the signature and nothing else
- No headings or section titles anywhere in the output

Output plain text only. No JSON, no markdown formatting."""

OUTREACH_MESSAGE_PROMPT = """Generate a cold outreach message for LinkedIn or email about this job opportunity.

IMPORTANT: Write in {output_language}.

Job Description:
{job_description}

Candidate Resume (JSON):
{resume_data}

Guidelines:
- 70-100 words maximum (shorter than a cover letter)
- First sentence: Reference specific detail from job description (team, product, technical challenge) - never open with "I'm reaching out" or "I saw your posting"
- One sentence on strongest matching qualification with a concrete metric if available
- End with low-friction ask: "Worth a quick chat?" not "I'd love the opportunity to discuss"
- Tone: How you'd message a former colleague, not a stranger
- Do NOT include placeholder brackets
- Do NOT use phrases like "excited about" or "passionate about"
- Do NOT use em dash ("—") anywhere in the writing/output, even if it exists, remove it

Output plain text only. No JSON, no markdown formatting."""

INTERVIEW_PREP_PROMPT = """Generate structured interview preparation for this tailored resume and job.

IMPORTANT: Write in {output_language}.
Do NOT translate JSON property names. Keep every JSON key exactly as shown in the schema; translate only string values.

Job Description:
{job_description}

Candidate Resume (JSON):
{resume_data}

Truthfulness guardrails:
- Use only evidence from the resume JSON and job description.
- Do NOT invent experience, tools, employers, metrics, certifications, skills, responsibilities, education, projects, or claims beyond the provided evidence.
- Do NOT imply the candidate has a skill or background unless it is present in the resume.
- Skill gaps are preparation targets only. They are not claimed candidate skills.
- If a job requirement is not evidenced by the resume, present it as something to prepare for or explain honestly.

Return ONLY a valid JSON object with exactly these top-level keys:
{{
  "role_fit_analysis": ["Short evidence-based role-fit observation"],
  "resume_questions": [
    {{
      "question": "Interview question grounded in the resume and job",
      "focus_area": "Resume evidence or job requirement being tested",
      "suggested_answer_points": ["Truthful point based on resume evidence"]
    }}
  ],
  "project_follow_ups": [
    {{
      "question": "Follow-up question about a real resume project or experience",
      "focus_area": "Project, impact, tradeoff, or implementation detail",
      "suggested_answer_points": ["Truthful point based on resume evidence"]
    }}
  ],
  "skill_gaps": [
    {{
      "skill": "Job-relevant skill or topic to prepare",
      "why_it_matters": "Why this topic may come up for this role",
      "preparation_suggestion": "How to prepare without claiming unsupported experience"
    }}
  ],
  "talking_points": ["Concise role-specific talking point grounded in the resume"]
}}

Content requirements:
- role_fit_analysis: 3-5 bullets.
- resume_questions: 5-8 questions.
- project_follow_ups: 3-6 questions.
- skill_gaps: 3-5 preparation targets.
- talking_points: 5-8 concise points.
- Keep all suggested answer points factual and resume-grounded.
- Do NOT use markdown fences or commentary outside the JSON."""

INTERVIEW_PRACTICE_FEEDBACK_PROMPT = """You are a supportive but honest interview coach. Evaluate the candidate's practice answer for the scenario below and give concrete, actionable feedback.

IMPORTANT: Write in {output_language}.
Do NOT translate JSON property names. Keep every JSON key exactly as shown in the schema; translate only string values.

Scenario title:
{scenario_title}

Scenario description:
{scenario_description}

Candidate's practice answer:
{answer}

Candidate resume (JSON) — use it as the ONLY source of truth for what the candidate has actually done:
{resume_data}

Truthfulness guardrails:
- Base every recommendation on evidence in the resume JSON. Never credit the candidate with experience, tools, employers, metrics, certifications, skills, or projects absent from the resume.
- If the resume is empty or unavailable, coach on structure and delivery rather than inventing experience.
- Do not invent facts about the candidate in the recommended answer points.

Scoring rubric for "score" (integer 1-10):
- 9-10: Directly answers the question, uses strong concrete resume evidence, clear structure, confident tone.
- 7-8: Good answer with mostly relevant evidence; some room to tighten structure or add specifics.
- 5-6: Covers the topic but lacks specific evidence or structure; generic phrasing.
- 1-4: Off-topic, very brief, vague, or contradicts the resume.

"level" must be exactly one of: "strong", "good", "needs_work" (a stable key; map score 9-10 -> strong, 6-8 -> good, 1-5 -> needs_work).

Return ONLY a valid JSON object with exactly these top-level keys:
{{
  "score": 7,
  "level": "good",
  "strengths": ["What the candidate did well (2-4 items)"],
  "improvements": ["Concrete, actionable ways to improve (2-4 items)"],
  "recommended_answer_points": ["A stronger answer outline grounded in the resume (3-6 bullets)"],
  "follow_ups": ["Likely follow-up questions an interviewer would ask (2-4 items)"]
}}

Do NOT use markdown fences or commentary outside the JSON."""

GENERATE_TITLE_PROMPT = """Extract the job title and company name from this job description.

IMPORTANT: Write in {output_language}.

Job Description:
{job_description}

Rules:
- Format: "Role @ Company" (e.g., "Senior Frontend Engineer @ Stripe")
- If the company name is not found, return just the role (e.g., "Senior Frontend Engineer")
- Maximum 60 characters
- Use the most specific role title mentioned
- Do not add any other text, quotes, or formatting

Output the title only, nothing else."""

# Alias for backward compatibility
RESUME_SCHEMA = RESUME_SCHEMA_EXAMPLE

# Diff-based improvement: outputs targeted changes instead of full resume

DIFF_STRATEGY_INSTRUCTIONS = {
    "nudge": "Make minimal edits. Only rephrase where there is a clear match. Do not add new bullet points.",
    "keywords": "Weave in relevant keywords where evidence already exists. You may rephrase bullets but do not add new ones.",
    "full": "Make targeted adjustments. You may rephrase bullets, add verified JD skills, and add new bullets that elaborate on existing work, but do not invent new responsibilities.",
}
DIFF_STRATEGY_INSTRUCTIONS["recruiter"] = "Make targeted adjustments. You may rephrase bullets, add verified JD skills, and add new bullets that elaborate on existing work, but do not invent new responsibilities. Apply the recruiter-grade tailoring approach: evidence mapping, factual accuracy, technical specificity, and ATS optimization."

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
14. When the summary is rewritten (path "summary"), build it with the C-WHAT formula and cover all four elements in 2-3 concise sentences: WHO = the candidate's professional identity (title, seniority, years of experience); WHAT = their specialization and the job-relevant skills; RESULT = measurable impact or evidence of results (only facts present in the original resume — never invented); HOW = the technologies and methodologies they use.

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


# ---------------------------------------------------------------------------
# Job Intelligence prompts
# ---------------------------------------------------------------------------

JOB_DNA_PROMPT = """Extract the job's technical and experience requirements into a structured DNA profile.

JOB DESCRIPTION:
{job_description}

OUTPUT JSON (nothing else):
{{
  "technical": [
    {{"skill": "React", "weight": 10}},
    {{"skill": "TypeScript", "weight": 8}}
  ],
  "experience": [
    {{"domain": "backend", "level": "high"}},
    {{"domain": "leadership", "level": "medium"}}
  ],
  "company": ["startup", "remote", "fast_growth", "international"]
}}

Rules:
- weight: 10 = critical/required, 7 = preferred/important, 5 = mentioned/bonus
- domain: one of "backend", "frontend", "fullstack", "mobile", "data", "devops", "architecture", "leadership", "design"
- level: "high" = explicitly required, "medium" = preferred, "low" = nice-to-have
- company tags: pick from ["startup", "remote", "fast_growth", "international", "enterprise", "established"]
- Generate ALL text in {output_language}.
- Only include skills/domains with evidence in the job description.
"""


SHOULD_APPLY_PROMPT = """You are a career advisor. A job analysis has been computed with the following data:

Job: {job_role} at {company}
Match: {match_percent}%
Career relevance: {career_relevance}%
Salary potential: {salary_potential}
Competition: {competition}
Ghost-job risk: {ghost_risk}%
Red flags: {red_flags}

Write a brief recommendation (2-3 sentences) for whether the candidate should apply.
- main_weakness: the single biggest gap between the candidate and this role (be specific, not generic)
- recommendation: a concrete, actionable recommendation grounded in the numbers

Rules:
- Ground every claim in the provided numbers
- Never invent facts
- Write in {output_language}
- Be concise and specific

Return JSON:
{{
  "main_weakness": "specific weakness",
  "recommendation": "actionable recommendation"
}}"""


# Chat Command Center prompts ------------------------------------------------

CHAT_PLANNER_SYSTEM_PROMPTS: dict[str, str] = {
    "ask": (
        "You are Taylor's career assistant. You are precise, honest, and "
        "grounded in the user's career data. You have access to tools that "
        "read their career information and write to their tracker. Always "
        "use tools when the question requires specific data."
    ),
    "coach": (
        "You are Taylor's career coach. You focus on strategic career "
        "advice, skill development, and job-search optimization. Use the "
        "user's career data to give personalized, actionable guidance."
    ),
    "recruiter": (
        "You are Taylor's recruiter advisor. You evaluate the user's "
        "resume and application materials from a recruiter's perspective. "
        "Be honest about strengths and gaps. When the user asks for an ATS "
        "audit or resume analysis and no specific resume is mentioned, call "
        "get_ats_audit() without a resume_id first — it will return available "
        "resumes for the user to choose from. Only run the audit after they "
        "pick one. If they have only one resume, it audits automatically."
    ),
    "resume_analyst": (
        "You are Taylor's resume analyst. You provide data-driven "
        "analysis of the user's resume structure, content, and market "
        "alignment. Always back up observations with concrete evidence "
        "from the career data. When the user asks for an audit and no "
        "specific resume is mentioned, call get_ats_audit() without a "
        "resume_id — it returns available resumes for selection. If the "
        "user says 'my resume' or 'the master resume', pass resume_id='master'."
    ),
}

CHAT_PLANNER_PROMPT = """You are a career assistant. Given the user's career memory and conversation history, plan how to handle their message.

ACTIVE MEMORIES (user preferences):
{active_memories}

CONVERSATION HISTORY:
{history}

AVAILABLE TOOLS:
{tool_catalog}

Answer in {output_language}.

RULES:
1. Return ONLY a valid JSON object with these keys:
   - "intent": "query" (general question), "stat" (wants numbers/stats), or "action" (wants to create/update something)
   - "tool_calls": list of tool calls as {{"tool": "name", "args": {{...}}}} (empty list if none needed)
   - "narrative": brief plan of how you'll answer
   - "title": short conversation title (3-6 words, e.g. "ATS Resume Audit", "Skill Gap Analysis", "Job Search Strategy")
   - "followups": 2-3 suggested follow-up questions the user might ask
   - "memory_candidates": list of {{"statement": "..."}} for durable preferences the user expressed (empty list if none)

2. For READ tools (get_*): include them in tool_calls.
3. For WRITE tools (create_*, update_*): set intent="action", include the tool call, and set "summary" describing what would be written.
4. For STAT questions (how many, what rate, etc.): set intent="stat" and do NOT call any tools — the backend computes stats.
5. If no tool is needed, set tool_calls=[].
6. Never fabricate data. Only use tools that exist in the catalog.
7. For resume audits: call get_ats_audit() with resume_id='master'. The gateway handles resume selection.

Return JSON only (no markdown fences):"""

CHAT_ANSWER_PROMPT = """You are Taylor's career assistant. Generate a helpful, grounded answer based on the career data and tool results.

USER MESSAGE: {user_message}

TOOL RESULTS:
{tool_stats}

RELEVANT CONTEXT:
{rag_context}

ACTIVE MEMORIES (user preferences):
{active_memories}

MODE: {mode}
OUTPUT LANGUAGE: {output_language}

RULES:
1. Answer in Markdown (short sections, bullet points).
2. Every claim must be grounded in the provided data or tool results.
3. When you have tool results, incorporate them naturally (e.g. "Based on your 12 applications...").
4. For pending actions (write tools), describe what would happen and the user will confirm.
5. Be concise, specific, and actionable.
6. Never invent numbers, skills, or experiences not in the data."""

CHAT_MODE_CONFIGS: dict[str, dict[str, list[str]]] = {
    "ask": {"allowlist": []},  # empty = all tools
    "coach": {
        "allowlist": [
            "get_career_summary",
            "get_funnel_stats",
            "get_skill_roi",
            "get_market_position",
            "get_skill_suggestions",
            "get_applications",
            "get_rejections",
            "get_evidence",
            "search_jobs",
            "get_job_verdict",
            "get_contacts",
            "get_companies",
            "create_application",
            "create_contact",
            "create_followup",
        ]
    },
    "recruiter": {
        "system": "You are Taylor's career strategist. You help users manage applications, "
        "track outreach, and prepare for interviews. Be concise and actionable. "
        "When the user asks for an ATS audit, call get_ats_audit() with resume_id='master'.",
        "allowlist": [
            "get_ats_audit",
            "get_evidence",
            "get_applications",
            "get_rejections",
            "get_market_position",
        ]
    },
    "resume_analyst": {
        "system": "You are Taylor's resume analyst. You provide data-driven "
        "analysis of the user's resume structure, content, and market "
        "alignment. Always back up observations with concrete evidence "
        "from the career data. When the user asks for an audit, call "
        "get_ats_audit() with resume_id='master'.",
        "allowlist": [
            "get_ats_audit",
            "get_evidence",
            "get_skill_suggestions",
            "get_market_position",
            "get_skill_roi",
            "get_funnel_stats",
        ]
    },
}

CHAT_AUDIT_PROMPT = """You are a resume analyst. Given the resume data and deterministic ATS scores, produce a prioritized list of improvement issues.

RESUME DATA:
{resume_data}

ATS SCORES:
- Overall: {overall_score}/100
- Skills coverage: {skills_coverage}/100
- Section completeness: {section_completeness}/100
- Quantification: {quantification}/100
- Action verbs: {action_verbs}/100
- Market alignment: {market_alignment}%

OUTPUT JSON (nothing else):
{{
  "issues": [
    {{
      "priority": "high|medium|low",
      "section": "section name",
      "entry": "specific entry or null",
      "current": "current text if applicable",
      "problem": "specific problem description",
      "suggested": "suggested improvement text"
    }}
  ]
}}

RULES:
- Maximum 10 issues, ordered by priority (high → medium → low).
- Every issue must reference a real section/entry from the resume data.
- Problems must be specific (not "improve this bullet" but "bullet lacks quantified results").
- Suggestions must be concrete rewrite examples grounded in the resume data.
- Ground every suggestion in the user's actual experience (never invent metrics).
- Write in {output_language}."""
