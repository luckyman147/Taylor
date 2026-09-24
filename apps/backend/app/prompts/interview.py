"""Interview preparation and practice-feedback prompts."""

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
