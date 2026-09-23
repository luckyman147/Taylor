"""Gateway routing + context-aware signal extraction.

Regression: "/get_companies get all companies that i didnt contact yet" fell
through to the LLM planner, which picked search_mcp_jobs (live job boards)
instead of the user's own get_companies/get_contacts data.

Also covers Phase 1 refactor signals: UNKNOWN vs GENERAL labelling,
follow-up reference detection, and topic-shift detection.
"""

from app.services.chat_gateway import (
    ChatIntent,
    ConversationContext,
    _detect_followup_reference,
    _detect_topic_shift,
    _extract_signals,
    classify_intent,
)


async def test_slash_read_tool_is_forced():
    decision = await classify_intent(
        "/get_companies get all companies that i didnt contact yet"
    )
    assert decision.force_preferred is True
    assert decision.preferred_tools == ["get_companies"]
    assert decision.confidence == 1.0
    assert decision.slash_args is None


async def test_slash_tool_with_required_param_extracts_query():
    decision = await classify_intent("/search_mcp_jobs remote python developer")
    assert decision.force_preferred is True
    assert decision.preferred_tools == ["search_mcp_jobs"]
    assert decision.slash_args == {"query": "remote python developer"}


async def test_slash_tool_missing_required_arg_is_not_forced():
    decision = await classify_intent("/search_mcp_jobs")
    assert decision.force_preferred is False
    assert decision.preferred_tools == []


async def test_slash_write_tool_is_not_forced():
    decision = await classify_intent("/create_contact add John Doe from Google")
    assert decision.force_preferred is False
    assert decision.intent == ChatIntent.GENERAL


async def test_slash_unknown_token_falls_through():
    decision = await classify_intent("/definitely_not_a_tool do something please")
    assert decision.force_preferred is False
    assert decision.preferred_tools == []


async def test_companies_not_contacted_routes_to_own_data_tools():
    decision = await classify_intent(
        "get all companies that i didnt contact yet"
    )
    assert decision.force_preferred is True
    assert decision.preferred_tools == ["get_companies", "get_contacts"]
    assert decision.intent == ChatIntent.GENERAL
    assert decision.confidence >= 0.7


async def test_my_tracked_companies_routes_to_get_companies():
    decision = await classify_intent("show me my tracked companies")
    assert decision.force_preferred is True
    assert "get_companies" in decision.preferred_tools


async def test_plain_job_search_still_routes_to_job_search():
    decision = await classify_intent("find me python jobs")
    assert decision.intent == ChatIntent.JOB_SEARCH
    assert decision.preferred_tools == ["search_mcp_jobs"]
    assert decision.force_preferred is False


async def test_short_jobs_question_routes_to_planner_not_clarify():
    """Regression: short messages used to auto-clarify (≤4-word branch)."""
    decision = await classify_intent("jobs?")
    assert decision.needs_clarification is False
    assert decision.intent == ChatIntent.GENERAL
    assert "jobs" in decision.topics


async def test_help_still_auto_clarifies():
    decision = await classify_intent("help")
    assert decision.needs_clarification is True
    assert decision.intent == ChatIntent.CLARIFY


# ---------------------------------------------------------------------------
# Signal extraction (advisory topics / actions / entities)
# ---------------------------------------------------------------------------

def test_extract_signals_salary_job_location():
    topics, actions, entities = _extract_signals(
        "What salary can I expect for React Native jobs in Germany?"
    )
    assert "salary" in topics
    assert "jobs" in topics
    assert "Germany" in entities.get("locations", [])
    assert "react" in entities.get("technology", [])


def test_extract_signals_docker_question():
    topics, actions, entities = _extract_signals(
        "How does Docker networking work?"
    )
    assert "technology" in topics
    assert "explain" in actions
    # No career-domain topics on a pure tech explanation query.
    assert "jobs" not in topics
    assert "resume" not in topics


# ---------------------------------------------------------------------------
# UNKNOWN vs GENERAL labelling
# ---------------------------------------------------------------------------

async def test_docker_question_is_unknown_not_clarify():
    decision = await classify_intent("How does Docker networking work?")
    assert decision.intent == ChatIntent.UNKNOWN
    assert decision.confidence == 0.5
    assert decision.needs_clarification is False
    assert decision.force_preferred is False


async def test_career_question_stays_general_with_signals():
    decision = await classify_intent(
        "How much do React Native jobs pay in Germany?"
    )
    assert decision.intent == ChatIntent.GENERAL
    assert decision.needs_clarification is False
    assert "salary" in decision.topics
    assert "jobs" in decision.topics
    assert "Germany" in decision.entities.get("locations", [])


async def test_market_fast_path_still_carries_signals():
    # "salary" is a pre-existing MARKET fast path — signals must ride along.
    decision = await classify_intent(
        "What salary can I expect for React Native jobs in Germany?"
    )
    assert decision.intent == ChatIntent.MARKET
    assert "salary" in decision.topics
    assert "jobs" in decision.topics
    assert "Germany" in decision.entities.get("locations", [])


async def test_conversational_message_stays_general():
    decision = await classify_intent("thanks!")
    assert decision.intent == ChatIntent.GENERAL
    assert decision.needs_clarification is False


# ---------------------------------------------------------------------------
# Follow-up reference detection
# ---------------------------------------------------------------------------

def test_followup_reference_needs_context():
    assert _detect_followup_reference("which ones pay the most?", None) is False
    bare = ConversationContext()
    assert _detect_followup_reference("which ones pay the most?", bare) is False


def test_followup_reference_with_active_context():
    ctx = ConversationContext(
        active_topic="jobs", last_tools=["search_mcp_jobs"]
    )
    assert _detect_followup_reference("which ones pay the most?", ctx) is True
    assert _detect_followup_reference("what about the salary?", ctx) is True
    assert _detect_followup_reference("find remote go jobs", ctx) is False


async def test_followup_signal_reaches_planner_bound_decision():
    ctx = ConversationContext(
        active_topic="jobs", last_tools=["search_mcp_jobs"]
    )
    decision = await classify_intent(
        "which ones pay the most?", context=ctx
    )
    assert decision.has_followup_reference is True
    assert decision.topic_shift is False
    assert decision.needs_clarification is False
    assert decision.intent is not ChatIntent.CLARIFY


# ---------------------------------------------------------------------------
# Topic-shift detection
# ---------------------------------------------------------------------------

def test_topic_shift_reset_phrase():
    ctx = ConversationContext(active_topic="jobs")
    assert _detect_topic_shift(
        "Actually forget that — explain Kubernetes", ctx, False
    ) is True


def test_topic_shift_new_domain_noun():
    ctx = ConversationContext(active_topic="jobs")
    assert _detect_topic_shift("Explain Kubernetes", ctx, False) is True
    assert _detect_topic_shift("find go jobs", ctx, False) is False


def test_topic_shift_needs_active_topic():
    assert _detect_topic_shift("Explain Kubernetes", None, False) is False
    assert _detect_topic_shift(
        "Explain Kubernetes", ConversationContext(), False
    ) is False


def test_followup_reference_suppresses_topic_shift():
    ctx = ConversationContext(active_topic="jobs")
    assert _detect_topic_shift("what about the salary?", ctx, True) is False


async def test_topic_shift_signal_in_classify():
    ctx = ConversationContext(active_topic="jobs")
    decision = await classify_intent(
        "Actually forget that — explain Kubernetes", context=ctx
    )
    assert decision.topic_shift is True
    assert decision.has_followup_reference is False
    assert decision.intent == ChatIntent.UNKNOWN
    assert decision.needs_clarification is False
