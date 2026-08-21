"""Unit tests for career-graph helpers (pure functions, no DB)."""

import pytest

from app.services.career_graph import extract_entry_skills


class TestExtractEntrySkills:
    def test_direct_mentions_are_linked(self):
        text = "Built APIs with FastAPI, managed PostgreSQL and Docker."
        assert extract_entry_skills(text, ["FastAPI", "PostgreSQL", "Docker"]) == [
            "FastAPI",
            "PostgreSQL",
            "Docker",
        ]

    def test_unknown_skills_are_never_linked(self):
        text = "I enjoy going to the Go conference and learning golang."
        assert extract_entry_skills(text, []) == []

    def test_skill_not_listed_is_not_linked(self):
        # "Python" appears in the prose but the user never listed it.
        text = "Wrote Python scripts for data munging."
        assert extract_entry_skills(text, ["SQL"]) == []

    def test_alias_matches_known_skill(self):
        # Description says "k8s" / "react.js"; the user knows Kubernetes/React.
        text = "Deployed to k8s clusters; built dashboards with react.js."
        assert extract_entry_skills(text, ["Kubernetes", "React"]) == [
            "Kubernetes",
            "React",
        ]

    def test_alias_resolves_to_canonical_name(self):
        # User listed "React.js"; the description says "React".
        text = "Rewrote the UI in React."
        assert extract_entry_skills(text, ["React.js"]) == ["React"]

    def test_no_false_positive_on_short_words(self):
        # "go" appears in prose but the user never listed Go → no edge.
        text = "I can go anywhere and say SQL is fine."
        assert extract_entry_skills(text, ["SQL"]) == ["SQL"]

    def test_short_prose_word_links_when_user_lists_it(self):
        # Deterministic: the user listed Go, the text says "go" → linked.
        text = "I can go build things with golang tooling."
        assert extract_entry_skills(text, ["Go"]) == ["Go"]

    def test_dedupes_and_preserves_order(self):
        text = "FastAPI and FastAPI again."
        assert extract_entry_skills(text, ["FastAPI"]) == ["FastAPI"]

    def test_case_insensitive(self):
        text = "used PYTHON to script automation"
        assert extract_entry_skills(text, ["python"]) == ["python"]

    def test_empty_text_and_skills(self):
        assert extract_entry_skills("", ["Python"]) == []
        assert extract_entry_skills("Python", []) == []

    def test_word_boundary_prevents_substring_hits(self):
        # "Spring" must not match "springs" or "spraying".
        text = "The springs are spraying in spring boot apps."
        assert extract_entry_skills(text, ["Spring"]) == ["Spring"]