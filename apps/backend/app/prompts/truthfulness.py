"""Anti-fabrication truthfulness rules and STAR bullet guide."""

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


STAR_BULLET_GUIDE = """STAR METHOD for experience bullet points — EVIDENCE-BASED RULES:
Each bullet must follow the STAR formula to produce achievement-focused, specific descriptions:
- S (Situation): Brief context or problem (one clause max)
- T (Task): What the candidate was responsible for
- A (Action): What they actually did — use precise verbs (Built, Developed, Implemented, Designed, Integrated, Automated, Deployed, Refactored, Configured, Migrated, Reduced, Increased, Delivered)
- R (Result): What changed because of their work — ONLY if the original resume provides a concrete metric or outcome

FORMULA: Action verb + what you did + how you did it + [optional result]

CRITICAL RULES:
- R is OPTIONAL. When no measurable result exists in the original, write an action-focused bullet (A only) and skip R entirely. Do not invent impact language ("significantly enhancing", "substantially reducing").
- VERB SAFETY: Use leadership verbs (Spearheaded, Architected, Led, Directed, Pioneered) ONLY when the original shows full ownership of the system or team. Use action verbs (Built, Implemented, Delivered, Developed) for individual contribution.
- NO IMPACT ADVERBS OR VAGUE CLAIMS: Never use "significantly", "substantially", "greatly", "dramatically", "seamless", "seamlessly", "optimize", "optimizing", "optimized", "minimize", "minimizing", "minimized", "enhance", "enhancing", "enhanced", "streamline", "streamlining", "streamlined" — these are unverifiable filler. State the concrete change or omit the result.
- VALIDATION STEP: Before writing each bullet, verify: (1) the action is stated or implied in the original, (2) any metric comes from the original, (3) the verb matches the scope of work. If any check fails, rewrite with a safer verb and drop the unsupported claim.
- Keep Situation/Task to one short clause; the emphasis should be on Action and Result
- Preserve the candidate's original details and voice
- Do not use em dash characters

GOOD EXAMPLES:
- "Developed REST APIs with Node.js and integrated database operations to support car listings and user interactions in a vehicle marketplace."
- "Implemented role-based authorization for five user types using ASP.NET Core and SQL Server."
- "Built 15+ end-to-end features using Flutter and Clean Architecture for a 50+ member organization."

BAD EXAMPLES (invented metrics, inflated verbs):
- "Spearheaded a revolutionary platform transformation, significantly boosting efficiency."
- "Architected a comprehensive solution that substantially reduced operational costs."
- "Dramatically enhanced user engagement through innovative feature development."
"""
