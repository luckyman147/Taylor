"""Cover letter, outreach message, and job-title prompts."""

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

Required structure (multi-line, real blank lines):
1. A short greeting line on its own line (e.g. "Hi Hiring Team,").
2. ONE blank line.
3. Body paragraphs, each separated by ONE blank line.
4. A short sign-off on its own line ("Best," / "Regards,"), then your name on the next line.

Never collapse the message into a single line. Never skip the greeting.

Guidelines:
- 70-100 words maximum (shorter than a cover letter)
- First body sentence: Reference specific detail from job description (team, product, technical challenge) - never open with "I'm reaching out" or "I saw your posting"
- One sentence on strongest matching qualification with a concrete metric if available
- End with low-friction ask: "Worth a quick chat?" not "I'd love the opportunity to discuss"
- Tone: How you'd message a former colleague, not a stranger
- Do NOT include placeholder brackets
- Do NOT use phrases like "excited about" or "passionate about"
- Do NOT use em dash ("—") anywhere in the writing/output, even if it exists, remove it

Output plain text only. No JSON, no markdown formatting."""
GENERATE_TITLE_PROMPT = """Extract the job title and company name from this job description.

IMPORTANT: Write in {output_language}.

Job Description:
{job_description}

Candidate Name: {candidate_name}

Rules:
- Format: "Candidate Name - Role @ Company" (e.g., "John Doe - Senior Frontend Engineer @ Stripe")
- If the company name is not found, return "Candidate Name - Role" (e.g., "John Doe - Senior Frontend Engineer")
- If candidate name is not provided, use just "Role @ Company"
- Maximum 100 characters
- Use the most specific role title mentioned
- Do not add any other text, quotes, or formatting

Output the title only, nothing else."""
