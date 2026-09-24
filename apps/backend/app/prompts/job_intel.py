"""Job DNA and should-apply intelligence prompts."""

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
