"""LLM prompt templates for resume processing."""

# Language code to full name mapping
LANGUAGE_NAMES = {
    "en": "English",
    "fr": "French",
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
]

IMPROVE_RESUME_PROMPTS = {
    "nudge": IMPROVE_RESUME_PROMPT_NUDGE,
    "keywords": IMPROVE_RESUME_PROMPT_KEYWORDS,
    "full": IMPROVE_RESUME_PROMPT_FULL,
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

DIFF_IMPROVE_PROMPT = """You are an expert ATS resume optimizer, technical recruiter, and resume editor.

Your task is to produce a MINIMAL, EVIDENCE-GROUNDED set of diff changes that makes the candidate's resume more relevant to the target job description.

The resume is the source of truth.

The job description determines what should be emphasized, prioritized, and reframed.

The goal is NOT to rewrite the entire resume.
The goal is to identify the strongest existing evidence in the candidate's profile and make that evidence easier for both ATS systems and recruiters to recognize.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE PRINCIPLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Optimize the PRESENTATION of the candidate's existing evidence, never the FACTS.

Think:

JOB REQUIREMENT
→ candidate evidence
→ strongest resume location
→ targeted wording improvement

Do not think:

JOB REQUIREMENT
→ invent experience
→ add unsupported technology
→ rewrite everything

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRUTHFULNESS RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Only modify content; never change:

   * names
   * companies
   * dates
   * institutions
   * degrees
   * job titles
   * project names
   * GitHub URLs

2. Never invent:

   * metrics
   * achievements
   * responsibilities
   * technologies
   * tools
   * certifications
   * projects
   * work experience
   * seniority
   * years of experience
   * production experience
   * business impact

Do not invent metrics or achievements not supported by the original resume.

3. Do not add new work entries, education entries, or project entries.

   EXCEPTION:
   Repositories explicitly provided under
   "Selected GitHub repositories to add"
   MUST be added as new personalProjects entries,
   REPLACING outdated or less-relevant existing projects
   (one removed project per added repository).

4. A technology or skill may only be added when:

   * it already appears in the original resume, OR
   * it appears in "Verified skill targets", OR
   * it is directly and explicitly evidenced by a selected GitHub repository.

5. Never infer expertise from the job description alone.

6. Never upgrade:

   * "familiar with" → "expert"
   * "used" → "led"
   * "academic project" → "professional experience"
   * "implemented" → "architected" unless the original evidence supports architecture ownership

7. Do not invent metrics.

   If the original resume contains:
   "reduced response time by 30%"

   you may preserve "30%".

   If no metric exists, do not create one.

8. Never remove an existing experience, certification, skill, or education item unless the system explicitly allows removal.

   EXCEPTION:
   Existing personalProjects entries MAY be removed (action "remove_project")
   ONLY when they are replaced by a repository from
   "Selected GitHub repositories to add".
   Never remove an entry with the same name as a selected repository.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TAILORING STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

9. {strategy_instruction}

10. Prioritize the requirements that matter most to the target role.

Rank evidence using:

REQUIRED JD SKILLS

>

CORE RESPONSIBILITIES

>

PREFERRED SKILLS

>

DOMAIN KNOWLEDGE

>

GENERAL SKILLS

11. Do not optimize for keyword count.

Optimize for:

relevance + evidence + clarity + natural terminology.

12. If a keyword already appears in a strong and relevant context, do not modify it merely to repeat it.

13. By DEFAULT, scan the summary and every work, project, and education description for content that already demonstrates a job-description keyword or skill, and reframe that content using the job description's terminology where it is not already phrased that way, while preserving the candidate's actual accomplishment. Do NOT add new work, metrics, or responsibilities; only restate existing content in the JD's language, and verify every reframe stays factually accurate.

Example:

Resume:
"Built backend services with NestJS."

JD:
"Develop and maintain REST APIs."

If the surrounding evidence supports REST APIs, a valid improvement may be:

"Developed and maintained REST APIs using NestJS."

Do NOT make this change if REST API development is not supported by the original evidence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVIDENCE MATCHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

14. Before generating changes, internally map each important JD requirement to candidate evidence from:

* summary
* work experience
* projects
* technical skills
* certifications
* education
* verified skill targets
* selected GitHub repositories

15. For every important JD requirement, determine:

DIRECT_MATCH
TRANSFERABLE_MATCH
PARTIAL_MATCH
NO_EVIDENCE

16. Only modify the resume when there is evidence.

17. Prefer stronger evidence over weaker evidence.

For example:

JD requirement:
"React and REST API development"

Candidate evidence:

Project A:
"Built React frontend and REST APIs with NestJS."

Project B:
"Used JavaScript."

Prioritize Project A.

18. A project demonstrating the required technology through implementation is stronger evidence than simply listing the technology in Skills.

19. A professional experience demonstrating a skill is generally stronger than a personal project.

20. A substantial project is generally stronger than a certification for demonstrating practical technical ability.

Certifications should support credibility, not replace practical evidence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

21. Scan the summary for opportunities to align it with the target role.

22. The summary should emphasize the candidate's strongest relevant:

* technical capabilities
* engineering focus
* domain experience
* responsibilities
* outcomes

23. Do not turn the summary into a keyword list.

24. Do not add a technology to the summary unless supported elsewhere in the candidate's evidence.

25. Do not mention years of experience unless explicitly present in the original resume.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPERIENCE OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

26. Scan EVERY work experience description.

27. For each bullet, ask:

* Does this demonstrate a JD requirement?
* Is the relevant technology visible?
* Is the responsibility expressed using terminology similar to the JD?
* Is the outcome clear?
* Is there unnecessary generic wording?

28. Rewrite only when the change materially improves relevance or clarity.

29. Preserve the original accomplishment.

30. Prefer:

ACTION + TECHNOLOGY + RESPONSIBILITY + RESULT

when all four are supported.

31. Do not add a result if none exists.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BULLET CRAFT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

B1. When a metric exists in the original bullet, prefer:

RESULT → ACTION → TECHNOLOGY/METHOD → PURPOSE

Example:
"Reduced project setup time by 80% by automating repetitive development workflows with Python and AI agents."

Without a metric, use:

ACTION → TECHNICAL WORK → PURPOSE

Example:
"Implemented role-based access control across five user types to ensure appropriate permissions and data visibility."

B2. Every rewritten bullet must show scope or purpose. Never leave a bare action like "Developed REST APIs using Node.js." Prefer "Developed 25+ REST API endpoints using Node.js to support marketplace operations and business workflows."

B3. Do NOT start every bullet with the same verb. Vary the story across the bullets of one entry:
* an achievement (the biggest measurable result first)
* technical depth (a challenging component, data modeling, authentication, API design)
* scale (users, APIs, features, repositories, data)
* architecture or ownership (design decisions, systems, integrations, security)
* efficiency (automation, optimization, process improvement)

B4. Describe the candidate's contribution, not the company. Avoid "Worked on a marketplace platform for customers"; prefer "Built and maintained backend APIs supporting marketplace operations and business workflows."

B5. Make technical complexity visible: surface API design, authentication, data modeling, deployment, performance, observability, and failure handling when the original evidence supports them.

B6. Preserve original facts, metrics, and scale. Never invent, reword, or relocate a number.

B7. Keep bullets concise (one or two printed lines).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROJECT OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

32. Scan EVERY personal project.

33. Projects may be particularly important when they provide evidence for requirements not strongly represented in professional experience.

34. For relevant projects, emphasize:

* technologies
* architecture
* engineering practices
* APIs
* databases
* cloud
* DevOps
* testing
* AI/ML
* security
* scalability
* collaboration
* measurable outcomes

ONLY when these are supported by the original project information.

35. When rewriting project descriptions, use terminology from the JD when factually accurate.

36. When GitHub repository evidence is available, use it to improve the project's technical specificity.

37. Do not claim functionality merely because a technology appears in the repository.

38. Repository evidence must support the statement being added.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SKILLS OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

39. Reorder skills so the most relevant skills appear first.

40. Prioritize:

* Required JD skills
* Strongly relevant skills
* Skills demonstrated by experience/projects
* Other existing skills

41. Only add a skill using action "add_skill" when it appears in "Verified skill targets".

42. Never add a skill merely because it appears in the job description.

43. Avoid duplicate skills and unnecessary repetition.

Never remove an existing skill: reorder the current list (job-relevant skills first) and deduplicate only. Any removal is rejected by the pipeline's safety net, so a reorder-only output is mandatory.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CERTIFICATION OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

44. Scan certifications/training for relevance to the target role.

45. Reorder certifications when a relevant certification should appear earlier.

46. Never modify the certification name or issuer.

47. Do not treat a certification as proof of professional experience.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EDUCATION OPTIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

48. Education descriptions may only be replaced when the existing description contains relevant evidence that can be better aligned with the JD.

49. Never change:

* degree
* institution
* dates
* academic title

50. Do not invent coursework, achievements, or academic responsibilities.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GITHUB REPOSITORIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

51. GitHub repositories are supporting evidence, not permission to invent functionality.

52. Only use repository information supplied in:

"GitHub repos matching this job"
and
"Selected GitHub repositories to add"

53. For selected repositories, output EXACTLY ONE add change per repository with:

path: "personalProjects"
action: "add_project"

54. Every selected repository MUST replace an existing project: remove the
    project from personalProjects (action "remove_project") that is the LEAST
    relevant to the target role or the most outdated, then add the selected
    repository in its place. Prefer a 1:1 swap: one removed project per added
    repository, unless the resume has no project worth replacing — then add
    without removing.

    remove_project change contract:

    path: "personalProjects"
    action: "remove_project"
    value: the EXACT name of the existing project to remove
    reason: why that project is the weakest fit for this JD

55. Removing a project and adding a repository count as ONE replacement: do
not output remove_project for a project unless you also add_project a
selected repository in the same result.

56. Never remove a project whose name matches a selected repository.

57. The value MUST be:

{{
  "name": "...",
  "github": "...",
  "role": "",
  "years": "",
  "description": [...]
}}

58. Repository descriptions must be evidence-grounded.

59. Do not copy README marketing language blindly.

60. Prefer concrete technical implementation details.

61. Do not invent metrics from GitHub repository information.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHANGE MINIMIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

62. Keep changes minimal and targeted.

63. Do not rewrite a sentence simply because it could sound better.

64. Make a change only when at least one of these is true:

* It improves ATS keyword alignment.
* It makes existing relevant evidence clearer.
* It better connects the candidate's experience to a JD responsibility.
* It exposes an important technology already demonstrated.
* It improves the relevance of the summary.
* It improves ordering of relevant skills/certifications.
* It adds an explicitly selected GitHub project.

65. If existing content already aligns well, leave it unchanged.

66. Prefer modifying an existing relevant bullet over appending a new bullet.

67. Do not create multiple changes that communicate the same improvement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHANGE VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

68. EVERY replace/rewrite change MUST include the exact original text.

69. The "original" field must be a DIRECT copy from the resume, never a paraphrase.

70. Every change MUST include a concise reason explaining why it improves alignment with the JD.

71. The reason must reference a concrete JD requirement, responsibility, skill, or keyword.

72. Do not use generic reasons such as:

"This makes the resume better."

Prefer:

"Aligns the existing backend API experience with the JD's REST API development requirement."

73. Do not use first-person pronouns unless the original resume already uses them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE AND STYLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

74. Generate all new text in {output_language}.

75. Preserve original capitalization, especially for proper nouns and technical terms:

* REST
* API
* AWS
* Azure
* PostgreSQL
* React
* Next.js
* TypeScript
* Docker
* Kubernetes
* GitHub Actions

76. Do not use em dash characters.

77. Keep professional language concise.

78. Avoid buzzwords unless they are relevant to the JD.

79. Do not keyword-stuff sentences.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATHS YOU CAN TARGET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

* "summary"

* "workExperience[i].description[j]"

* "workExperience[i].description"
  action: "append"

* "personalProjects[i].description[j]"

* "personalProjects[i].description"
  action: "append"

* "personalProjects"
  action: "add_project"

* "personalProjects"
  action: "remove_project"
  value: the EXACT name of the existing project to remove

* "education[i].description"

* "additional.technicalSkills"

* "additional.languages"

* "additional.certificationsTraining"

* "additional.awards"

Allowed actions:

* replace
* append
* reorder
* add_skill
* add_project
* remove_project

Do NOT target:

* personalInfo
* dates/years
* company names
* education degree
* education institution
* education years
* customSections

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL QUALITY CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before producing the JSON, internally verify:

1. Every new claim is supported by resume or repo evidence.
2. Every changed sentence has an exact original.
3. No names/dates/institutions/degrees were modified.
4. No unsupported technology was introduced.
5. No fake metrics were introduced.
6. No seniority was inflated.
7. Every change improves job relevance.
8. Existing strong content was left untouched.
9. Important JD requirements are represented where evidence exists.
10. Missing requirements were NOT fabricated.
11. Selected GitHub repositories are added exactly once.
12. Every removed project is replaced by a selected GitHub repository (never removed without a replacement).
13. The output contains valid JSON only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INPUT DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Keywords to emphasize (only if already supported by resume content):
{job_keywords}

Verified skill targets:
{skill_targets}

GitHub repos matching this job:
{github_repos}

Selected GitHub repositories to add as new personalProjects entries (add ALL of these via add_project):
{selected_repos}

Job Description:
{job_description}

Original Resume:
{original_resume}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Output this exact JSON format and NOTHING ELSE:

{{
  "changes": [
    {{
      "path": "summary",
      "action": "replace",
      "original": "the exact original text at this path",
      "value": "the improved text",
      "reason": "concise reason tied to a concrete JD requirement"
    }},
    {{
      "path": "workExperience[0].description[1]",
      "action": "replace",
      "original": "the exact original bullet text",
      "value": "the reframed bullet",
      "reason": "restates the existing work in the JD's terminology"
    }},
    {{
      "path": "workExperience[0].description",
      "action": "append",
      "original": null,
      "value": "new bullet elaborating existing, evidenced work",
      "reason": "why this change helps"
    }},
    {{
      "path": "additional.technicalSkills",
      "action": "reorder",
      "original": null,
      "value": ["most relevant skill first", "then next", "then the rest in original order"],
      "reason": "reordered to prioritize JD-relevant skills"
    }},
    {{
      "path": "additional.technicalSkills",
      "action": "add_skill",
      "original": null,
      "value": "verified skill target missing from the skills list",
      "reason": "added verified JD skill for review"
    }},
    {{
      "path": "personalProjects",
      "action": "add_project",
      "original": null,
      "value": {{
        "name": "repo-name",
        "github": "https://github.com/owner/repo-name",
        "role": "",
        "years": "",
        "description": ["bullet grounded in the repo README/languages"]
      }},
      "reason": "added user-selected GitHub repo as a project"
    }}
  ],
  "strategy_notes": "brief summary of the tailoring approach"
}}"""

DIFF_PROJECT_BULLETS_PROMPT = """Write one short description paragraph (about 2 lines) for a GitHub repository, for use on a resume.

RULES:
1. Write exactly ONE flowing paragraph of 2 sentences max — no bullet lists, no dashes, no line breaks
2. State what the project is AND why it exists: where the repository facts support it, phrase the purpose explicitly ("built to...", "designed to...", "to ..." / "for ...") instead of only naming the project. Example: "AI-powered resume tailoring that transforms natural language into keyword-optimized PDFs." not just "An AI resume app."
3. Describe WHAT the project does — its main purpose and what it is for. Do NOT describe how it was developed (no "built with", no tech-stack or language mention unless the repository's own description leads with it)
4. Read like a person explaining the idea simply — skill tags may appear naturally only when the repository facts mention them as part of the purpose
5. Only use facts that appear in the repository facts below (README excerpt, description, languages, topics)
6. Never invent metrics, users, downloads, or impact numbers not stated in the facts
7. All text must be in {output_language}

Repository facts:
{repo_facts}

Job description context (use its terminology where it fits the facts):
{job_description}

Output a JSON object, nothing else:
{{
  "bullets": ["paragraph text"]
}}"""


SUMMARY_REWRITE_PROMPT = """You are an expert CV/resume writer specializing in concise, ATS-friendly professional summaries.

Rewrite the candidate's summary below as a short professional narrative — NOT a technology list — using this 5-part mental model:

IDENTITY → PROBLEM → WORK → APPROACH → VALUE

That is: WHO ARE YOU? → WHAT PROBLEMS DO YOU SOLVE? → WHAT DO YOU BUILD? → HOW DO YOU BUILD IT? → WHAT VALUE DO YOU BRING?

Write EXACTLY THREE sentences:

Sentence 1 — Identity + Problem
"Software Engineer focused on [type of problems/business challenges]."
Start with the professional identity from the resume (e.g. "Software Engineer", "Full-Stack Developer") followed by the kind of problems they solve. Never open with a generic "passionate about technology" or "results-driven".

Sentence 2 — What they build
"Builds [systems/applications/APIs] across [relevant technical area]."
Say what they actually build and where (frontend applications, backend services, REST APIs, automation tools). Be specific. Do NOT start with a list of technologies — the recruiter needs to know what the candidate does with them first.

Sentence 3 — How + Value
"Applies [engineering approach] to [type of value/outcome]."
Ground the engineering approach in the resume (clean architecture, automation, reusable modules, role-based access, analytics dashboards, CI/CD...) and close with the type of value it creates (reliable, maintainable, scalable software; operational efficiency; teams that ship faster).

HARD RULES:
- Exactly 3 sentences — no list, no bullet points.
- Do NOT mention years of experience.
- NEVER use these low-signal phrases: "Passionate about...", "Results-driven...", "Experienced in React, Node.js, Python..." as a technology dump, "Seeking a challenging position...", "team player", "proven track record", "highly motivated", "strong problem solver and team player".
- Do NOT list more than a couple of technologies, and only when they carry meaning (e.g. "React frontends on Node.js and PostgreSQL backends").
- Do NOT repeat the experience section ("built X at company A, then Y at company B") or the skills list.
- No generic claims the resume does not demonstrate.
- Factual accuracy only: no technologies, companies, industries, or achievements that are not in the resume data.
- Metrics only when they appear in the resume data; never invent numbers.
- Be specific rather than general, active rather than passive, factual rather than embellished, and easy to scan.
- Where the job description uses terminology the candidate's facts support, prefer that terminology (natural ATS keyword use — no keyword stuffing).
- All text must be in {output_language}.

Resume data (only factual source):
{resume_data}

Job description context (use its terminology only where it fits the candidate's facts):
{job_description}

Output a JSON object, nothing else:
{{
  "summary": "rewritten summary text"
}}"""
