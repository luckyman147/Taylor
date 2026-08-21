"""Unit tests for the AI skill-suggestions normalization and prompt."""

import json

from app.prompts.templates import SKILL_SUGGESTIONS_PROMPT
from app.services.career_profile import (
    _MAX_SKILL_SUGGESTIONS,
    _normalize_skill_suggestions,
)


class TestNormalizeSkillSuggestions:
    def test_keeps_valid_entries_in_order(self):
        raw = {
            "skills": [
                {"name": "Docker", "reason": "Your projects run in containers."},
                {"name": "GraphQL", "reason": "Pairs with React."},
            ]
        }
        assert _normalize_skill_suggestions(raw, set()) == [
            {"name": "Docker", "reason": "Your projects run in containers.", "kind": "remembered"},
            {"name": "GraphQL", "reason": "Pairs with React.", "kind": "remembered"},
        ]

    def test_keeps_learn_next_kind(self):
        raw = {
            "skills": [
                {"name": "RAG", "reason": "Unlocks LLM apps.", "kind": "learn_next"},
            ]
        }
        assert _normalize_skill_suggestions(raw, set()) == [
            {"name": "RAG", "reason": "Unlocks LLM apps.", "kind": "learn_next"}
        ]

    def test_coerces_invalid_kind_to_remembered(self):
        raw = {
            "skills": [
                {"name": "MCP", "reason": "Agent tooling.", "kind": "tbd"},
                {"name": "Kafka", "reason": "Streaming.", "kind": "LEARN_NEXT"},
            ]
        }
        result = _normalize_skill_suggestions(raw, set())
        assert result[0]["kind"] == "remembered"
        assert result[1]["kind"] == "learn_next"

    def test_drops_skills_already_in_profile_case_insensitive(self):
        raw = {
            "skills": [
                {"name": "python", "reason": "Already there."},
                {"name": "Docker", "reason": "Missing."},
            ]
        }
        assert _normalize_skill_suggestions(raw, {"Python"}) == [
            {"name": "Docker", "reason": "Missing.", "kind": "remembered"}
        ]

    def test_drops_duplicates_case_insensitive_across_kinds(self):
        raw = {
            "skills": [
                {"name": "Docker", "reason": "First.", "kind": "remembered"},
                {"name": "docker", "reason": "Second.", "kind": "learn_next"},
                {"name": "GraphQL", "reason": "Third.", "kind": "learn_next"},
            ]
        }
        assert [s["name"] for s in _normalize_skill_suggestions(raw, set())] == [
            "Docker",
            "GraphQL",
        ]

    def test_caps_at_max_suggestions(self):
        raw = {
            "skills": [
                {"name": f"Skill {i}", "reason": "r"} for i in range(20)
            ]
        }
        result = _normalize_skill_suggestions(raw, set())
        assert len(result) == _MAX_SKILL_SUGGESTIONS

    def test_drops_unnamed_entries_and_non_dicts(self):
        raw = {
            "skills": [
                {"reason": "No name."},
                "not a dict",
                {"name": "  ", "reason": "Blank name."},
                None,
                {"name": "Docker", "reason": "Valid."},
            ]
        }
        assert _normalize_skill_suggestions(raw, set()) == [
            {"name": "Docker", "reason": "Valid.", "kind": "remembered"}
        ]

    def test_truncates_name_and_reason(self):
        raw = {
            "skills": [
                {"name": "X" * 500, "reason": "Y" * 500},
            ]
        }
        (item,) = _normalize_skill_suggestions(raw, set())
        assert len(item["name"]) == 100
        assert len(item["reason"]) == 200

    def test_missing_or_wrong_shaped_payload_returns_empty(self):
        assert _normalize_skill_suggestions({}, set()) == []
        assert _normalize_skill_suggestions({"skills": "nope"}, set()) == []
        assert _normalize_skill_suggestions([], set()) == []
        assert _normalize_skill_suggestions(None, set()) == []


class TestSkillSuggestionsPrompt:
    def test_requires_all_placeholders(self):
        assert "{profile}" in SKILL_SUGGESTIONS_PROMPT
        assert "{output_language}" in SKILL_SUGGESTIONS_PROMPT
        assert "{current_year}" in SKILL_SUGGESTIONS_PROMPT

    def test_mentions_both_groups_and_2026_concepts(self):
        assert "remembered" in SKILL_SUGGESTIONS_PROMPT
        assert "learn_next" in SKILL_SUGGESTIONS_PROMPT
        assert "Model Context Protocol" in SKILL_SUGGESTIONS_PROMPT
        assert "Retrieval-Augmented Generation" in SKILL_SUGGESTIONS_PROMPT

    def test_format_produces_parseable_example_json(self):
        prompt = SKILL_SUGGESTIONS_PROMPT.format(
            profile=json.dumps({"skills": [{"name": "Python", "category": None}]}),
            output_language="English",
            current_year="2026",
        )
        assert "Python" in prompt
        assert "2026" in prompt
        assert '{"name": "Skill name", "reason": "Why it fits their profile", "kind": "remembered"}' in prompt