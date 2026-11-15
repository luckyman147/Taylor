"""Lead scraper LLM prompts — criteria recommendations and classification."""

LEAD_CRITERIA_SYSTEM_PROMPT = (
    "You are a B2B lead-research strategist. You propose precise, "
    "non-redundant search criteria for finding people, companies, and "
    "agencies. You never invent facts about the user."
)

# Literal JSON braces in the example must be doubled for str.format().
LEAD_CRITERIA_PROMPT = """Optimize search criteria for a lead-research run. The user wants to find people (potential contacts), companies, and agencies relevant to their profile and goal.

USER PROFILE SUMMARY:
{profile_summary}

GOAL (what they want the leads for, e.g. networking, hiring, partnership):
{goal}

OPTIONAL NICHE (industry/domain the user named):
{niche}

CURRENT SEARCH PARAMS (what the user already typed — optimize these rather than starting from scratch; keep what is good, sharpen what is vague, drop what will not retrieve; "none" means empty):
{current_params}

ALREADY TRACKED (names the user already has — do NOT suggest targeting these):
{tracked_names}

Respond with a JSON object with exactly these keys:
{{
  "keywords": ["3-8 short search keywords/phrases"],
  "titles": ["3-6 job titles worth targeting, e.g. 'Head of Talent'"],
  "industries": ["2-5 industry strings"],
  "locations": ["2-4 cities/countries, prefer ones from the profile or current params when present"],
  "company_types": ["e.g. startup, agency, enterprise, scaleup"],
  "lead_types": ["person", "company", "agency"],
  "seniorities": ["e.g. founder, director, manager, senior"],
  "target": "improved one-line target/persona statement (or null if none needed)",
  "purpose": "improved one-line purpose statement (or null if none needed)",
  "recency_hint": "optional short note about timing, e.g. 'companies hiring now' or null",
  "rationale": "one sentence explaining what changed and why"
}}

Rules:
- Respect the niche and goal when given; otherwise infer from the profile.
- When CURRENT PARAMS exist, treat them as the baseline: preserve intent, only improve precision.
- Lead types must only use values from: person, company, agency.
- Never suggest keywords that are only the already-tracked names.
- Answer in {output_language} for rationale/recency_hint/target/purpose text; keep keywords/titles/locations in their natural search language (English is fine)."""

LEAD_CLASSIFY_SYSTEM_PROMPT = (
    "You classify B2B research leads into exactly one bucket: contact "
    "(a person), company (a business), or agency (a recruiting/marketing/"
    "consulting agency). Be conservative; answer JSON only."
)

LEAD_CLASSIFY_PROMPT = """Classify each lead below. Each lead has an id, name, and optional title/company/description.

WHY THE USER IS SEARCHING (context only — prefer "contact" for people who fit this intent, but never force a fit):
{purpose}

LEADS (JSON):
{leads_json}

Respond with a JSON object mapping each lead id to one of: "contact", "company", "agency".
Use "unsure" only when the evidence truly supports neither. Answer in {output_language} is not required for the keys — keep keys as given and values as the English labels exactly."""

LEAD_QUERY_SYSTEM_PROMPT = (
    "You are a B2B lead-search query planner. You rewrite a user's rough "
    "keywords plus targeting context into one precise search string. "
    "Answer JSON only."
)

LEAD_QUERY_PROMPT = """Rewrite the user's lead-search keywords into ONE precise search string (max ~15 words) for LinkedIn/web search engines.

BASE KEYWORDS: {keywords}

EXACT TARGET (the persona/company to find, e.g. "CTOs at 10-50 person fintech startups"): {target}

PURPOSE (why they want these leads — use it to disambiguate the persona; never add pitch/sales words): {purpose}

Rules:
- Pack role titles, seniority, industry, and company-size traits from the TARGET into the string.
- Do NOT include product/pitch words from the PURPOSE — search engines match pages, not intent.
- Output a search query, not a sentence. No quotes unless essential.
- Respond with JSON: {{"keywords": "..."}}"""
