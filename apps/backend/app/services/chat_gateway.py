"""Gateway layer: context-aware signal extractor + deterministic router.

Runs BEFORE the planner. No LLM calls — pure keyword + heuristic matching.
Extracts conversation context, topics/actions/entities, and follow-up/topic-shift
signals; routes only when something is obvious and deterministic. Everything
else falls through to the planner WITH structured signals attached.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.database import db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Intent enum
# ---------------------------------------------------------------------------

class ChatIntent(str, Enum):
    GENERAL = "general"
    # Not confidently mapped to a known Taylor domain — ALWAYS planner-bound,
    # never clarification.
    UNKNOWN = "unknown"
    PROFILE = "profile"
    JOB_SEARCH = "job_search"
    RESUME_AUDIT = "resume_audit"
    APPLICATIONS = "applications"
    SKILLS = "skills"
    MARKET = "market"
    CLARIFY = "clarify"


# ---------------------------------------------------------------------------
# Conversation context (supplied by the engine each turn)
# ---------------------------------------------------------------------------

@dataclass
class TopicState:
    """One entry in the per-thread topic stack (recency / decay).

    ``demoted`` marks entries superseded by a topic shift — retained for
    history/observability but treated as inactive. Age (``current_turn -
    turn > 4``) is computed at read time, never by mutating the entry.
    """

    topic: str
    confidence: float
    turn: int
    demoted: bool = False


@dataclass
class ConversationContext:
    """Snapshot of conversation continuity passed into classify_intent()."""

    active_topic: str | None = None
    active_entity: str | None = None
    active_job_id: str | None = None
    active_resume_id: str | None = None
    active_company: str | None = None
    active_contact: str | None = None
    last_intent: ChatIntent | None = None
    last_tools: list[str] = field(default_factory=list)
    last_tool_results: list[dict[str, Any]] = field(default_factory=list)
    recent_user_messages: list[str] = field(default_factory=list)
    topic_stack: list[TopicState] = field(default_factory=list)
    turn: int = 0


# ---------------------------------------------------------------------------
# Clarification constants
# ---------------------------------------------------------------------------

_CLARIFY_PATTERNS = [
    re.compile(r"^\s*help\s*$", re.IGNORECASE),
    re.compile(r"\bwhat can you do\b", re.IGNORECASE),
    re.compile(r"\bi need advice\b", re.IGNORECASE),
    re.compile(r"\bwhat should i do\b", re.IGNORECASE),
    re.compile(r"\bcan you help me\b", re.IGNORECASE),
    re.compile(r"\bhelp me with my career\b", re.IGNORECASE),
    re.compile(r"\bwhat do you do\b", re.IGNORECASE),
    re.compile(r"\btell me what you can\b", re.IGNORECASE),
    re.compile(r"\bwhat are your features\b", re.IGNORECASE),
    re.compile(r"\bhow can you help\b", re.IGNORECASE),
]

DEFAULT_CLARIFICATION_OPTIONS = [
    "Search for jobs matching my skills",
    "Audit my resume against a job description",
    "Compare my resumes side by side",
    "Check my career profile and skills",
    "Analyze my application pipeline",
]


# ---------------------------------------------------------------------------
# Intent patterns
# ---------------------------------------------------------------------------

_AUDIT_KEYWORDS = re.compile(
    r"\b("
    r"ats\s*audit|audit\s*(my\s*)?resume|resume\s*audit|"
    r"score\s*(my\s*)?resume|resume\s*score|"
    r"how\s*(does|do)\s*(my\s*)?resume\s*look|"
    r"check\s*(my\s*)?resume|review\s*(my\s*)?resume|"
    r"resume\s*review|resume\s*check|"
    r"optimize\s*(my\s*)?resume|resume\s*optimization|"
    r"resume\s*feedback|improve\s*(my\s*)?resume|"
    r"dit\s*(my\s*)?resume|edit\s*(my\s*)?resume|"
    r"analyze\s*(my\s*)?resume|analysis\s*(of\s*)?(my\s*)?resume|"
    r"score\s*my\s*cv|cv\s*score|audit\s*my\s*cv|cv\s*audit|"
    r"review\s*my\s*cv|check\s*my\s*cv"
    r")\b",
    re.IGNORECASE,
)

_RESUME_ID_PATTERN = re.compile(
    r"\b(?:resume|cv)[_\s]*(?:id)?[:\s]+([a-f0-9-]{20,})\b",
    re.IGNORECASE,
)

# Compare resumes patterns
_COMPARE_RESUME_PATTERNS = re.compile(
    r"\b("
    r"compare\s+(my\s+)?resumes?|"
    r"comparison\s+(of\s+)?(my\s+)?resumes?|"
    r"diff\s+(my\s+)?resumes?|"
    r"side\s*by\s*side|"
    r"difference\s+between\s+(my\s+)?resumes?|"
    r"which\s+resume\s+(is\s+)?better|"
    r"resumes?\s+comparison"
    r")\b",
    re.IGNORECASE,
)

# Structured compare message from frontend: [compare: Name 1, Name 2]
_COMPARE_STRUCTURED_PATTERN = re.compile(
    r"^\[compare:\s*(.+?)\]\s*$",
    re.IGNORECASE,
)

_MASTER_PATTERN = re.compile(
    r"\b(master|base|primary|main)\s+resume\b",
    re.IGNORECASE,
)

_JOB_SEARCH_PATTERNS = re.compile(
    r"\b("
    r"find\b.*\bjobs?\b|search\b.*\bjobs?\b|"
    r"look\s+for\b.*\bpositions?\b|"
    r"openings?\b|vacancies?\b|"
    r"remote\b.*\b(role|position|job)s?\b|"
    r"hiring\b|"
    r"any\s+jobs?\b|"
    r"show\s+me\b.*\bjobs?\b"
    r")\b",
    re.IGNORECASE,
)

_PROFILE_PATTERNS = re.compile(
    r"\b(my\s+(profile|skills|experience|career)|"
    r"what\s+skills\s+do\s+i\s+have|"
    r"tell\s+me\s+about\s+my\s+profile|"
    r"career\s+summary)\b",
    re.IGNORECASE,
)

_APPLICATION_PATTERNS = re.compile(
    r"\b(my\s+applications?\b|"
    r"application\s+funnel\b|"
    r"where\s+did\s+i\s+apply|"
    r"how\s+many\s+applications?)\b",
    re.IGNORECASE,
)

# Market intent
_MARKET_PATTERNS = re.compile(
    r"\b(market\s+position|market\s+demand|"
    r"industry\s+trends|salary|compensation)\b",
    re.IGNORECASE,
)

# Explicit /slash command from the chat composer: "/toolName optional rest"
_SLASH_PATTERN = re.compile(r"^/([A-Za-z][A-Za-z0-9_]*)\b[\s:]*(.*)$")

# The user's OWN tracked companies / networking contacts (CRM-style saved
# data) — must route to get_companies/get_contacts, NEVER to search_mcp_jobs
# (which searches live external job boards).
_COMPANY_CONTACT_PATTERNS = re.compile(
    r"\b("
    r"(?:my|tracked|saved)\s+companies\b|"
    r"(?:list|show|get|fetch)\s+(?:me\s+)?(?:all\s+)?my\s+companies\b|"
    r"companies\s+(?:that\s+)?i\s+(?:did\s*n[o']?t|didn'?t|haven'?t|have\s*n[o']?t)\s+contact|"
    r"companies\s+(?:i\s+)?(?:was|were|am\s+yet)\s+not\s+contacted|"
    r"companies\s+not\s+(?:yet\s+)?contacted|"
    r"(?:my|the)\s+(?:networking\s+)?contacts\b|"
    r"(?:list|show|get)\s+(?:me\s+)?(?:all\s+)?my\s+contacts\b"
    r")",
    re.IGNORECASE,
)

_SKILLS_PATTERNS = re.compile(
    r"\b(skill\s+(gap|suggestion|roi|analysis)|"
    r"missing\s+skills?|forgotten\s+skills?|"
    r"suggest\w*\s+(some\s+)?skills?|"
    r"recommend\w*\s+(some\s+)?skills?|"
    r"what\s+skills\s+should\s+i\s+learn|"
    # Spanish
    r"sugerir\w*\s+.{0,15}habilidades|"
    r"recomendar\w*\s+.{0,15}habilidades|"
    r"habilidades?\s+faltantes|"
    # French
    r"sugg[eé]rer?\s+.{0,15}comp[eé]tences?|"
    r"recommander?\s+.{0,15}comp[eé]tences?|"
    r"comp[eé]tences?\s+manquantes|"
    # Japanese
    r"スキル.{0,8}(提案|おすすめ|教えて)|"
    # Korean
    r"(기술|스킬).{0,8}(추천|제안)|"
    r"부족한\s+(기술|스킬)|"
    # Chinese
    r"(推荐|建议).{0,6}技能|"
    r"(技能|技术).{0,4}(不足|缺少|缺口)|"
    # Portuguese
    r"sugerir\w*\s+.{0,15}habilidades|"
    r"recomendar\w*\s+.{0,15}habilidades|"
    r"habilidades?\s+faltantes)\b",
    re.IGNORECASE,
)

_CONTEXTUAL_FOLLOWUP_PATTERNS = re.compile(
    r"\b(from\s+those|of\s+that\b|of\s+those|from\s+the\s+list|"
    r"of\s+these|from\s+this|that\s+list|these\s+results|"
    r"tell\s+me\s+more\s+about|narrow\s+down|refine\s+those)\b",
    re.IGNORECASE,
)

# Sent email patterns — force search_sent_emails tool call
_SENT_EMAIL_PATTERNS = re.compile(
    r"\b("
    r"emails?\s+(i|that\s+i)\s+sent\b|"
    r"sent\s+(emails?|outreach|follow[\s-]ups?)\b|"
    r"analy[sz]e\s+emails?\b|"
    r"review\s+my\s+sent\b|"
    r"show\s+my\s+sent\b|"
    r"what\s+(did\s+)?i\s+send\b|"
    r"outreach\s+emails?\b|"
    r"follow[\s-]up\s+emails?\b|"
    r"emails?\s+(i\s+)?wrote\b|"
    r"emails?\s+to\s+\w+|"
    r"email\s+(i\s+)?sent\b"
    r")\b",
    re.IGNORECASE,
)

# General information queries that should go to the planner (not clarification)
_GENERAL_QUERY_PATTERNS = re.compile(
    r"\b("
    r"what\s+(is|are|was|were|do|does|did|has|have|had|should|would|could|will|can|'s|s)\b|"
    r"how\s+(do|does|did|is|are|was|were|can|could|should|would|much|many)\b|"
    r"why\s+(do|does|did|is|are|was|were|can|could|should|would)\b|"
    r"when\s+(do|does|did|is|are|was|were|can|could|should|would|did)\b|"
    r"where\s+(do|does|did|is|are|was|were|can|could|should|would)\b|"
    r"who\s+(is|are|was|were|do|does|did|has|have|had)\b|"
    r"search\b|"
    r"find\b|"
    r"look\s+(up|for)\b|"
    r"tell\s+me\s+about\b|"
    r"explain\b|"
    r"describe\b|"
    r"compare\b|"
    r"list\b|"
    r"show\s+me\b|"
    r"latest\b|"
    r"recent\b|"
    r"news\b|"
    r"happening\b|"
    r"trending\b|"
    r"trend\b|"
    r"best\b|"
    r"top\b|"
    r"difference\s+between\b|"
    r"pros?\s+and\s+cons?\b|"
    r"review\b|"
    r"analy[sz]e\b|"
    r"tutorial\b|"
    r"guide\b|"
    r"example\b|"
    r"sample\b|"
    r"code\b|"
    r"implement\b|"
    r"build\b|"
    r"create\b|"
    r"write\b|"
    r"generate\b|"
    r"design\b|"
    r"debug\b|"
    r"fix\b|"
    r"error\b|"
    r"issue\b|"
    r"problem\b|"
    r"solution\b|"
    r"approach\b|"
    r"recommend\b|"
    r"suggest\b|"
    r"advice\b|"
    r"opinion\b|"
    r"think\b|"
    r"feel\b|"
    r"prefer\b|"
    r"choose\b|"
    r"pick\b|"
    r"select\b|"
    r"decide\b"
    r")\b",
    re.IGNORECASE,
)

# @mention pattern — @Company or @"Contact Name"
_MENTION_PATTERN = re.compile(r'@(?:"([^"]+)"|(\w+(?:\s+\w+)*))')


# ---------------------------------------------------------------------------
# Topic / action lexicons + entity extraction (ADVISORY signals only —
# they never route; the planner interprets them)
# ---------------------------------------------------------------------------

_TOPIC_LEXICON: dict[str, tuple[str, ...]] = {
    "jobs": ("job", "jobs", "opening", "openings", "vacancy", "vacancies", "hiring", "position", "positions"),
    "resume": ("resume", "resumes", "cv", "cvs"),
    "career_profile": ("profile", "career", "experience", "background", "qualification", "qualifications"),
    "applications": ("application", "applications", "applied", "tracker", "pipeline", "funnel"),
    "skills": ("skill", "skills", "upskill", "skillset"),
    "market": ("market", "demand", "industry", "trend", "trends", "outlook"),
    "salary": ("salary", "salaries", "compensation", "wage", "wages", "earnings", "pay", "paid"),
    "companies": ("company", "companies", "employer", "employers", "startup", "startups"),
    "contacts": ("contact", "contacts", "referral", "referrals"),
    "email": ("email", "emails", "inbox", "gmail", "mailbox"),
    "interviews": ("interview", "interviews", "recruiter", "recruiters"),
    "projects": ("project", "projects", "portfolio"),
    "learning": ("learn", "learning", "course", "courses", "tutorial", "tutorials", "training", "bootcamp"),
    "technology": (
        "technology", "tech", "kubernetes", "docker", "postgres", "postgresql", "mysql", "redis", "nginx",
        "react", "vue", "angular", "flutter", "terraform", "linux",
        "python", "javascript", "typescript", "java", "golang", "nodejs", "node",
        "rust", "php", "ruby", "swift", "kotlin", "sql", "mongodb", "graphql",
        "aws", "azure", "gcp",
    ),
    "general": ("advice", "guidance", "opinion", "thoughts"),
}

# Career-domain topics → GENERAL; anything else (e.g. technology-only) → UNKNOWN.
_CAREER_TOPIC_LABELS: frozenset[str] = frozenset(_TOPIC_LEXICON) - {"technology"}

_ACTION_LEXICON: dict[str, tuple[str, ...]] = {
    "search": ("search", "find", "discover", "look for", "hunt"),
    "analyze": (
        "analyze", "analyse", "analysis", "assess", "evaluate", "review", "audit", "score",
        "fit", "fits", "match", "matches", "suitable", "suit",
    ),
    "compare": ("compare", "comparison", "versus", "diff", "side by side", "difference"),
    "create": ("create", "add", "insert"),
    "update": ("update", "edit", "modify", "change", "revise", "tweak"),
    "explain": (
        "explain", "describe", "understand", "walk me through",
        "how does", "how do", "why does", "why do", "what is", "what are",
    ),
    "recommend": ("recommend", "recommendation", "suggest", "advice", "should i", "which one should"),
    "summarize": ("summarize", "summarise", "summary", "recap", "overview", "tldr"),
    "retrieve": ("show", "list", "get", "fetch", "display", "pull", "give me", "tell me"),
    "draft": ("draft", "write", "compose", "generate"),
    "debug": (
        "debug", "fix", "repair", "troubleshoot", "broken", "error",
        "crash", "crashing", "failing", "stacktrace", "exception",
    ),
}

_LOCATION_RE = re.compile(
    r"\b(?:in|to|near|from|moving\s+to|based\s+in)\s+"
    r"([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)"
)

_LOCATION_NAMES: tuple[str, ...] = (
    "tunisia", "france", "germany", "italy", "spain", "portugal",
    "united kingdom", "uk", "united states", "usa", "canada",
    "netherlands", "belgium", "switzerland", "austria", "sweden",
    "norway", "denmark", "poland", "united arab emirates", "uae",
    "qatar", "saudi arabia", "turkey", "japan", "china", "india", "brazil",
)

# Follow-up / reference language ("this one", "which ones", ...) — only a
# signal when there is prior conversation to refer back to.
_FOLLOWUP_REF_PATTERNS = re.compile(
    r"\b(what about|how about|which (?:ones?|one)|those\b|these\b|that one|"
    r"the (?:first|second|third|last)(?: one)?|them\b|same (?:one|thing|for)|"
    r"for them|and (?:me|for me|for those)|"
    r"of (?:that|those|these)|from (?:this|that|those|the list))",
    re.IGNORECASE,
)

# Explicit topic-reset language.
_TOPIC_RESET_PATTERNS = re.compile(
    r"\b(actually|forget (?:that|it|this|the list)|new question|unrelated|"
    r"another thing|switching topics|switch (?:the )?topic|different topic|"
    r"moving on|let's talk about|let us talk about|change of subject)",
    re.IGNORECASE,
)

# Strong domain nouns used for topic-shift detection (curated, small).
_STRONG_TOPIC_NOUNS: dict[str, str] = {
    "technology": r"\b(kubernetes|docker|postgres(?:ql)?|mysql|redis|nginx|react|vue|angular|flutter|terraform|linux)\b",
    "jobs": r"\b(jobs?|openings?|hiring|vacanc(?:y|ies))\b",
    "resume": r"\b(resumes?|cv)\b",
    "salary": r"\b(salar(?:y|ies)|compensation)\b",
    "applications": r"\bapplications?\b",
    "interviews": r"\binterviews?\b",
    "skills": r"\bskills?\b",
    "companies": r"\b(companies|employers?)\b",
    "contacts": r"\bcontacts?\b",
    "email": r"\b(emails?|inbox|gmail)\b",
}


def _match_lexicon(msg_lower: str, lexicon: dict[str, tuple[str, ...]]) -> list[str]:
    """Return lexicon keys with at least one word-boundary keyword hit."""
    hits: list[str] = []
    for name, keywords in lexicon.items():
        for kw in keywords:
            if re.search(rf"\b{re.escape(kw)}\b", msg_lower):
                hits.append(name)
                break
    return hits


def _extract_entities(
    msg: str,
    tech_keywords: list[str],
    context: ConversationContext | None = None,
) -> dict[str, list[str]]:
    """Best-effort entity buckets: technology, locations, company, contact.

    Advisory only. Company/contact names are resolved **only** from known
    context (active entities + prior tool-result fields) when the value is
    actually mentioned in the message — never inferred from free text.
    """
    entities: dict[str, list[str]] = {}
    if tech_keywords:
        entities["technology"] = tech_keywords

    msg_lower = msg.lower()
    tech_lower = {t.lower() for t in tech_keywords}
    locations: list[str] = []
    seen: set[str] = set()

    def _add_location(name: str) -> None:
        key = name.lower()
        if len(name) < 3 or key in tech_lower or key in seen:
            return
        seen.add(key)
        locations.append(name)

    for match in _LOCATION_RE.finditer(msg):
        _add_location(match.group(1))
    for name in _LOCATION_NAMES:
        if re.search(rf"\b{re.escape(name)}\b", msg_lower):
            _add_location(name[0].upper() + name[1:])

    if locations:
        entities["locations"] = locations

    # --- company / contact: known context values mentioned in the message ---
    company_candidates: list[str] = []
    contact_candidates: list[str] = []
    if context is not None:
        if context.active_company:
            company_candidates.append(context.active_company)
        if context.active_contact:
            contact_candidates.append(context.active_contact)
        for result in context.last_tool_results:
            if not isinstance(result, dict):
                continue
            top_company = result.get("company")
            if isinstance(top_company, str) and top_company:
                company_candidates.append(top_company)
            for key in ("name", "full_name", "contact"):
                val = result.get(key)
                if isinstance(val, str) and val:
                    contact_candidates.append(val)
            nested = (
                ("jobs", ("company",), ("name", "full_name")),
                ("contacts", ("company",), ("name", "full_name")),
                ("companies", ("company", "name"), ()),
            )
            for list_key, company_keys, contact_keys in nested:
                items = result.get(list_key)
                if not isinstance(items, list):
                    continue
                for item in items[:50]:
                    if not isinstance(item, dict):
                        continue
                    for ck in company_keys:
                        cv = item.get(ck)
                        if isinstance(cv, str) and cv:
                            company_candidates.append(cv)
                    for nk in contact_keys:
                        nv = item.get(nk)
                        if isinstance(nv, str) and nv:
                            contact_candidates.append(nv)

    def _mentioned(name: str) -> bool:
        return len(name) >= 3 and re.search(
            rf"\b{re.escape(name)}\b", msg, re.IGNORECASE
        ) is not None

    companies: list[str] = []
    contacts: list[str] = []
    for name in company_candidates:
        if _mentioned(name) and name not in companies:
            companies.append(name)
    for name in contact_candidates:
        if _mentioned(name) and name not in contacts:
            contacts.append(name)
    if companies:
        entities["company"] = companies[:5]
    if contacts:
        entities["contact"] = contacts[:5]
    return entities


def _extract_signals(
    msg: str,
    context: ConversationContext | None = None,
) -> tuple[list[str], list[str], dict[str, list[str]]]:
    """Extract (topics, actions, entities) from a message — advisory only."""
    msg_lower = msg.lower()
    topics = _match_lexicon(msg_lower, _TOPIC_LEXICON)
    actions = _match_lexicon(msg_lower, _ACTION_LEXICON)
    tech_hits = [
        kw for kw in _TOPIC_LEXICON["technology"]
        if re.search(rf"\b{re.escape(kw)}\b", msg_lower)
    ]
    entities = _extract_entities(msg, tech_hits, context)
    return topics, actions, entities


def _label_general_or_unknown(topics: list[str]) -> ChatIntent:
    """GENERAL when career-domain topics are present; otherwise UNKNOWN."""
    if any(t in _CAREER_TOPIC_LABELS for t in topics):
        return ChatIntent.GENERAL
    return ChatIntent.UNKNOWN


def _is_multi_topic(topics: list[str], actions: list[str]) -> bool:
    """True for a compound multi-domain request that must reach the planner.

    Requires >= 2 distinct career-domain topics AND >= 2 distinct actions so
    single-topic fast paths (MARKET salary, AUDIT, compare) never get stolen —
    two topics alone are not enough.
    """
    career_topics = set(topics) & _CAREER_TOPIC_LABELS
    return len(career_topics) >= 2 and len(set(actions)) >= 2


def _detect_followup_reference(msg: str, context: ConversationContext | None) -> bool:
    """True when the message refers back to prior conversation results."""
    if context is None:
        return False
    if not (context.active_topic or context.last_tools or context.topic_stack):
        return False
    return bool(_FOLLOWUP_REF_PATTERNS.search(msg))


def _detect_topic_reset(
    msg: str,
    context: ConversationContext | None,
) -> bool:
    """True for explicit topic-reset language when an active topic exists."""
    if context is None:
        return False
    current = context.active_topic or (
        context.topic_stack[-1].topic if context.topic_stack else None
    )
    if current is None:
        return False
    return bool(_TOPIC_RESET_PATTERNS.search(msg))


def _detect_topic_shift(
    msg: str,
    context: ConversationContext | None,
    has_followup_ref: bool,
) -> bool:
    """True when the message pivots to a strong new-domain noun.

    Noun-based only — explicit reset phrases are ``_detect_topic_reset``.
    Follow-up reference language suppresses shift (continuation, not pivot).
    """
    if context is None:
        return False
    current = context.active_topic or (
        context.topic_stack[-1].topic if context.topic_stack else None
    )
    if current is None:
        return False
    if has_followup_ref:
        return False
    matched = {
        topic for topic, pattern in _STRONG_TOPIC_NOUNS.items()
        if re.search(pattern, msg, re.IGNORECASE)
    }
    if not matched:
        return False
    return current not in matched


# ---------------------------------------------------------------------------
# Gateway decision
# ---------------------------------------------------------------------------

@dataclass
class GatewayDecision:
    """Result of the gateway classification.

    Two jobs: (1) obvious deterministic routing, (2) structured evidence
    (signals) for the planner when interpretation is needed.
    """

    intent: ChatIntent
    resume_id: str | None = None
    needs_selection: bool = False
    resumes: list[dict[str, Any]] | None = None
    preferred_tools: list[str] = field(default_factory=list)
    confidence: float = 0.0
    contextual_follow_up: bool = False
    needs_clarification: bool = False
    clarification_reason: str | None = None
    suggested_intents: list[str] = field(default_factory=list)
    mentions: list[str] = field(default_factory=list)
    multi_select: bool = False
    max_select: int = 0
    # When True, the orchestrator must run preferred_tools directly and
    # must NOT let the planner substitute a different tool.
    force_preferred: bool = False
    # Args for a single forced tool (slash commands like /search_mcp_jobs q).
    slash_args: dict[str, Any] | None = None
    # Advisory signals passed to the planner (never used for routing).
    topics: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    entities: dict[str, list[str]] = field(default_factory=dict)
    active_topic: str | None = None
    has_followup_reference: bool = False
    topic_shift: bool = False
    topic_reset: bool = False
    topic_history: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Preserve the old `x or []` normalization for explicit None.
        self.preferred_tools = self.preferred_tools or []
        self.suggested_intents = self.suggested_intents or []
        self.mentions = self.mentions or []
        self.topics = self.topics or []
        self.actions = self.actions or []
        self.entities = self.entities or {}
        self.topic_history = self.topic_history or []


def format_gateway_signals(decision: GatewayDecision) -> str:
    """Render gateway signals as a compact text block for the planner prompt."""
    lines: list[str] = []
    if decision.topics:
        lines.append(f"- Detected topics: {', '.join(decision.topics)}")
    if decision.actions:
        lines.append(f"- Detected actions: {', '.join(decision.actions)}")
    for bucket, values in decision.entities.items():
        if values:
            lines.append(f"- {bucket}: {', '.join(values)}")
    if decision.active_topic:
        lines.append(f"- Active topic from previous turns: {decision.active_topic}")
    if decision.topic_history:
        lines.append(
            f"- Recent topic history: {', '.join(decision.topic_history)}"
        )
    if decision.topic_reset:
        lines.append(
            "- Topic reset detected: clear prior topic context and treat this "
            "as a fresh topic"
        )
    if decision.topic_shift:
        lines.append(
            "- Topic shift detected: treat this message as a NEW topic, "
            "not a continuation"
        )
    if decision.has_followup_reference:
        lines.append(
            "- Follow-up reference detected: the message refers to earlier "
            "results in this thread"
        )
    if decision.preferred_tools:
        lines.append(
            f"- Gateway suggested tools (advisory): {', '.join(decision.preferred_tools)}"
        )
    if decision.mentions:
        lines.append(f"- @mentions: {', '.join(decision.mentions)}")
    if decision.intent in (ChatIntent.GENERAL, ChatIntent.UNKNOWN):
        lines.append(
            f"- Gateway intent: {decision.intent.value} "
            f"(confidence {decision.confidence:.2f}) — not confidently routed; "
            "interpret the request yourself"
        )
    if not lines:
        return "(no gateway signals)"
    return "\n".join(lines)


def _check_clarify_patterns(msg: str) -> bool:
    """Check if the message matches known vague/ambiguous patterns."""
    return any(p.search(msg) for p in _CLARIFY_PATTERNS)


async def classify_intent(
    user_message: str,
    resume_id: str | None = None,
    context: ConversationContext | None = None,
) -> GatewayDecision:
    """Classify user intent, log decision evidence, return the decision.

    Thin public wrapper around ``_route_message`` so every path emits a single
    structured ``gateway_classification`` log (evidence only — no message text).
    """
    decision = await _route_message(user_message, resume_id, context)
    _log_gateway_classification(decision)
    return decision


def _log_gateway_classification(decision: GatewayDecision) -> None:
    """Emit structured decision evidence. Never log message/tool/resume content."""
    payload = {
        "event": "gateway_classification",
        "intent": decision.intent.value,
        "confidence": decision.confidence,
        "topics": decision.topics,
        "actions": decision.actions,
        "active_topic": decision.active_topic,
        "has_followup_reference": decision.has_followup_reference,
        "topic_shift": decision.topic_shift,
        "preferred_tools": decision.preferred_tools,
        "force_preferred": decision.force_preferred,
    }
    logger.info(
        "gateway_classification %s",
        json.dumps(payload, sort_keys=True, separators=(",", ":")),
    )


async def _route_message(
    user_message: str,
    resume_id: str | None = None,
    context: ConversationContext | None = None,
) -> GatewayDecision:
    """Classify user intent and determine routing.

    Fast, no LLM calls. Precedence: explicit routes (resume_id, slash,
    force-preferred own-data, resume ID, compare, @mention, sent-email) beat
    the multi-topic gate, which beats single-topic deterministic matchers.
    Returns advisory signals (topics/actions/entities/follow-up) on
    planner-bound paths.
    """
    msg = user_message.strip()

    # Advisory signals — extracted once, attached to planner-bound decisions.
    topics, actions, entities = _extract_signals(msg, context)
    has_followup_ref = _detect_followup_reference(msg, context)
    topic_reset = _detect_topic_reset(msg, context)
    topic_shift = _detect_topic_shift(msg, context, has_followup_ref)
    topic_history = (
        [t.topic for t in context.topic_stack][-5:] if context else []
    )
    signal_fields: dict[str, Any] = {
        "topics": topics,
        "actions": actions,
        "entities": entities,
        "active_topic": context.active_topic if context else None,
        "has_followup_reference": has_followup_ref,
        "topic_shift": topic_shift,
        "topic_reset": topic_reset,
        "topic_history": topic_history,
    }

    # If a resume_id was explicitly provided (e.g. from file upload), use it directly
    if resume_id:
        logger.info("Gateway: explicit resume_id from upload=%s", resume_id)
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id=resume_id,
            confidence=1.0,
        )

    # Explicit /slash tool command (frontend composer inserts "/toolName").
    # Force READ tools that take at most one required parameter; anything else
    # falls through so the planner can gather arguments (the /toolname text
    # still acts as a hint).
    slash_match = _SLASH_PATTERN.match(msg)
    if slash_match:
        from app.services.chat_tools import TOOL_CATALOG
        tool_name = slash_match.group(1)
        remainder = (slash_match.group(2) or "").strip()
        spec = TOOL_CATALOG.get(tool_name)
        if spec is not None:
            required = [p for p, s in spec.params.items() if s.get("required")]
            if not spec.write and len(required) <= 1 and (not required or remainder):
                slash_args: dict[str, Any] | None = (
                    {required[0]: remainder} if required else None
                )
                logger.info("Gateway: slash command /%s forced (args=%s)", tool_name, slash_args)
                return GatewayDecision(
                    intent=ChatIntent.GENERAL,
                    preferred_tools=[tool_name],
                    confidence=1.0,
                    force_preferred=True,
                    slash_args=slash_args,
                )
            logger.info(
                "Gateway: slash command /%s not forced (write=%s, required=%s)",
                tool_name, spec.write, required,
            )
            return GatewayDecision(
                intent=ChatIntent.GENERAL,
                confidence=0.8,
                **signal_fields,
            )
        # Unknown /token — fall through and treat as normal text

    # Explicit force-preferred own-data route (companies / contacts) —
    # must beat topic detection and every semantic matcher.
    if _COMPANY_CONTACT_PATTERNS.search(msg):
        logger.info("Gateway: companies/contacts intent detected")
        return GatewayDecision(
            intent=ChatIntent.GENERAL,
            preferred_tools=["get_companies", "get_contacts"],
            confidence=0.9,
            force_preferred=True,
        )

    # Check for explicit resume ID in message
    id_match = _RESUME_ID_PATTERN.search(msg)
    if id_match:
        logger.info("Gateway: explicit resume_id=%s", id_match.group(1))
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id=id_match.group(1),
            confidence=1.0,
        )

    # Check for master resume reference
    if _MASTER_PATTERN.search(msg):
        logger.info("Gateway: master resume reference detected")
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id="master",
            confidence=0.95,
        )

    # Structured compare message from frontend: [compare: Name 1, Name 2]
    compare_match = _COMPARE_STRUCTURED_PATTERN.match(msg)
    if compare_match:
        names_raw = compare_match.group(1)
        names = [n.strip() for n in names_raw.split(",") if n.strip()]
        if len(names) >= 2:
            logger.info("Gateway: structured compare message with %d resumes", len(names))
            return GatewayDecision(
                intent=ChatIntent.GENERAL,
                preferred_tools=["compare_resumes"],
                confidence=1.0,
                **signal_fields,
            )

    # Compare resumes intent — show multi-select card
    if _COMPARE_RESUME_PATTERNS.search(msg):
        logger.info("Gateway: compare resumes intent detected")
        return await _classify_compare_intent()

    # @mention detection — @Company or @"Contact Name" → search entity emails
    mention_matches = _MENTION_PATTERN.findall(msg)
    if mention_matches:
        mentions = [(g1 or g2).strip() for g1, g2 in mention_matches if g1 or g2]
        if mentions:
            logger.info("Gateway: @mention detected: %s", mentions)
            return GatewayDecision(
                intent=ChatIntent.GENERAL,
                preferred_tools=["search_entity_emails"],
                confidence=0.95,
                mentions=mentions,
                **signal_fields,
            )

    # Sent email queries — force search_sent_emails
    if _SENT_EMAIL_PATTERNS.search(msg):
        logger.info("Gateway: sent email intent detected")
        return GatewayDecision(
            intent=ChatIntent.GENERAL,
            preferred_tools=["search_sent_emails"],
            confidence=0.9,
            **signal_fields,
        )

    # Multi-topic gate — compound multi-domain request → planner with signals.
    # Runs AFTER every explicit/deterministic route, BEFORE single-topic
    # matchers, so AUDIT/JOB_SEARCH/etc. can't swallow mixed requests.
    if _is_multi_topic(topics, actions):
        logger.info(
            "Gateway: multi-topic request detected (topics=%s actions=%s), "
            "passing to planner",
            topics, actions,
        )
        return GatewayDecision(
            intent=ChatIntent.GENERAL,
            confidence=0.7,
            **signal_fields,
        )

    # Contextual follow-up — references to previous results (check before job search)
    if _CONTEXTUAL_FOLLOWUP_PATTERNS.search(msg):
        # Don't flag if it's also a new job search (e.g., "find the best jobs")
        is_new_search = bool(_JOB_SEARCH_PATTERNS.search(msg))
        if not is_new_search:
            logger.info("Gateway: contextual follow-up detected")
            return GatewayDecision(
                intent=ChatIntent.GENERAL,
                confidence=0.8,
                contextual_follow_up=True,
                **{**signal_fields, "has_followup_reference": True},
            )

    # Check if this is a resume audit intent
    if _AUDIT_KEYWORDS.search(msg):
        return await _classify_audit_intent()

    # Job search
    if _JOB_SEARCH_PATTERNS.search(msg):
        logger.info("Gateway: job search intent detected")
        return GatewayDecision(
            intent=ChatIntent.JOB_SEARCH,
            preferred_tools=["search_mcp_jobs"],
            confidence=0.95,
            **signal_fields,
        )

    # Profile
    if _PROFILE_PATTERNS.search(msg):
        logger.info("Gateway: profile intent detected")
        return GatewayDecision(
            intent=ChatIntent.PROFILE,
            preferred_tools=["get_career_summary"],
            confidence=0.9,
            **signal_fields,
        )

    # Applications
    if _APPLICATION_PATTERNS.search(msg):
        logger.info("Gateway: applications intent detected")
        return GatewayDecision(
            intent=ChatIntent.APPLICATIONS,
            preferred_tools=["get_applications", "get_funnel_stats"],
            confidence=0.9,
            **signal_fields,
        )

    # Skills
    if _SKILLS_PATTERNS.search(msg):
        logger.info("Gateway: skills intent detected")
        return GatewayDecision(
            intent=ChatIntent.SKILLS,
            preferred_tools=["get_skill_suggestions", "get_skill_roi"],
            confidence=0.85,
            **signal_fields,
        )

    # Market
    if _MARKET_PATTERNS.search(msg):
        logger.info("Gateway: market intent detected")
        return GatewayDecision(
            intent=ChatIntent.MARKET,
            preferred_tools=["get_market_position"],
            confidence=0.85,
            **signal_fields,
        )

    # General information query — has question words or topic keywords, let planner handle it
    # Checked BEFORE vague patterns so messages like "help me with my resume" route to planner
    if _GENERAL_QUERY_PATTERNS.search(msg):
        label = _label_general_or_unknown(topics)
        logger.info(
            "Gateway: general query detected (%s), passing to planner", label.value
        )
        return GatewayDecision(
            intent=label,
            confidence=0.7 if label is ChatIntent.GENERAL else 0.5,
            **signal_fields,
        )

    # Vague/ambiguous patterns — only if no specific intent or general query matched
    if _check_clarify_patterns(msg):
        logger.info("Gateway: clarify pattern matched (vague_pattern)")
        return GatewayDecision(
            intent=ChatIntent.CLARIFY,
            confidence=0.3,
            needs_clarification=True,
            clarification_reason="vague_pattern",
            suggested_intents=["job_search", "resume_audit", "profile", "market", "skills"],
            **signal_fields,
        )

    # Pure conversational / social messages — no clarification needed, just answer
    _CONVERSATIONAL = re.compile(
        r"^\s*(thanks?|thank\s*you|ok|okay|hello|hi|hey|bye|good\s*(morning|afternoon|evening)|"
        r"got\s*it|nice|cool|awesome|perfect|great|yes|no|sure|sounds?\s*good|"
        r"merci|bonjour|salut|au\s*revoir|illow|salam)\s*[!.?]*\s*$",
        re.IGNORECASE,
    )
    if _CONVERSATIONAL.search(msg):
        return GatewayDecision(
            intent=ChatIntent.GENERAL, confidence=0.9, **signal_fields
        )

    # No pattern matched — planner decides. Short messages no longer force
    # clarification: UNKNOWN = no career-domain signal confidently detected,
    # GENERAL = career topics present. Vague _CLARIFY_PATTERNS above still
    # auto-clarify explicitly ambiguous messages (e.g. "help").
    label = _label_general_or_unknown(topics)
    logger.info(
        "Gateway: no pattern matched (%s), passing to planner", label.value
    )
    return GatewayDecision(
        intent=label,
        confidence=0.6 if label is ChatIntent.GENERAL else 0.5,
        **signal_fields,
    )


async def _classify_audit_intent() -> GatewayDecision:
    """Classify resume audit intent and determine if selection is needed."""
    resumes = await db.list_resumes()
    master_resumes = [r for r in resumes if r.get("is_master", False)]

    if not master_resumes:
        # No master — if only one resume overall, auto-select it
        if len(resumes) == 1:
            return GatewayDecision(
                intent=ChatIntent.RESUME_AUDIT,
                resume_id=resumes[0].get("resume_id"),
                confidence=0.9,
            )
        return GatewayDecision(intent=ChatIntent.RESUME_AUDIT, confidence=0.7)

    if len(master_resumes) == 1:
        return GatewayDecision(
            intent=ChatIntent.RESUME_AUDIT,
            resume_id=master_resumes[0].get("resume_id"),
            confidence=0.95,
        )

    # Multiple master resumes — show selection card
    return GatewayDecision(
        intent=ChatIntent.RESUME_AUDIT,
        needs_selection=True,
        confidence=0.8,
        resumes=[
            {
                "resume_id": r.get("resume_id"),
                "title": r.get("title") or r.get("filename") or "Untitled",
                "is_master": True,
                "has_data": bool(r.get("processed_data")),
            }
            for r in master_resumes
        ],
    )


async def _classify_compare_intent() -> GatewayDecision:
    """Show multi-select card for comparing resumes (pick 2)."""
    resumes = await db.list_resumes()
    if len(resumes) < 2:
        return GatewayDecision(
            intent=ChatIntent.GENERAL,
            confidence=0.5,
            needs_clarification=True,
            clarification_reason="not_enough_resumes",
        )

    return GatewayDecision(
        intent=ChatIntent.GENERAL,
        needs_selection=True,
        multi_select=True,
        max_select=2,
        confidence=0.9,
        preferred_tools=["compare_resumes"],
        resumes=[
            {
                "resume_id": r.get("resume_id"),
                "title": r.get("title") or r.get("filename") or "Untitled",
                "is_master": r.get("is_master", False),
                "has_data": bool(r.get("processed_data")),
            }
            for r in resumes
        ],
    )
