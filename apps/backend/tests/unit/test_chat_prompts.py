from app.prompts import (
    CHAT_THINKING_PROMPT,
    CHAT_ANSWER_PROMPT,
    CHAT_PLANNER_PROMPT,
    CHAT_BASE_MODES,
    get_merged_system_prompt,
)

def test_thinking_prompt_has_history_placeholder():
    assert "{conversation_history}" in CHAT_THINKING_PROMPT

def test_answer_prompt_has_history_placeholder():
    assert "{conversation_history}" in CHAT_ANSWER_PROMPT

def test_planner_prompt_has_minimization_rules():
    assert "DO NOT USE TOOLS UNNECESSARILY" in CHAT_PLANNER_PROMPT

def test_answer_prompt_requires_tnd_currency():
    """Salaries must be estimated natively in TND — no USD-first conversion."""
    assert "Tunisian Dinar (TND)" in CHAT_ANSWER_PROMPT
    assert "exchange-rate tool" in CHAT_ANSWER_PROMPT

def test_thinking_prompt_requires_tnd_currency():
    assert "Tunisian Dinar (TND)" in CHAT_THINKING_PROMPT

def test_every_system_prompt_requires_tnd_currency():
    for mode, config in CHAT_BASE_MODES.items():
        assert "Tunisian Dinar (TND)" in config["system"], mode
    for mode in CHAT_BASE_MODES:
        assert "Tunisian Dinar (TND)" in get_merged_system_prompt(mode), mode

def test_planner_prompt_routes_own_company_queries_to_get_companies():
    """Own saved companies/contacts must go to get_companies/get_contacts,
    never search_mcp_jobs (live external job boards)."""
    assert "get_companies" in CHAT_PLANNER_PROMPT
    assert "get_contacts" in CHAT_PLANNER_PROMPT
    assert "NEVER search_mcp_jobs" in CHAT_PLANNER_PROMPT

def test_planner_prompt_declares_gateway_signals_placeholder():
    assert "{gateway_signals}" in CHAT_PLANNER_PROMPT

def test_planner_prompt_formats_with_all_engine_placeholders():
    """The exact kwarg set the engine passes must satisfy every placeholder.

    Adding a placeholder to CHAT_PLANNER_PROMPT without updating both this
    contract and chat_engine's format() call fails here with a KeyError.
    """
    rendered = CHAT_PLANNER_PROMPT.format(
        active_memories="memories",
        history="history",
        tool_catalog="tools",
        output_language="English",
        gateway_signals="- Detected topics: jobs",
    )
    assert "{gateway_signals}" not in rendered
    assert "Detected topics: jobs" in rendered
    assert "{active_memories}" not in rendered
    assert "{history}" not in rendered
    assert "{tool_catalog}" not in rendered
    assert "{output_language}" not in rendered
