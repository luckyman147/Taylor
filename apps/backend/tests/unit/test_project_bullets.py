"""Unit tests for project bullet generation helpers."""

from app.routers.enrichment import _clean_project_bullets


class TestCleanProjectBullets:
    def test_strips_list_markers_and_whitespace(self) -> None:
        raw = ["- Led migration", "* Shipped feature", "• Cut latency", "  plain bullet  "]
        assert _clean_project_bullets(raw) == [
            "Led migration",
            "Shipped feature",
            "Cut latency",
            "plain bullet",
        ]

    def test_drops_empty_entries(self) -> None:
        assert _clean_project_bullets(["- ", "", "  ", "Real bullet"]) == ["Real bullet"]

    def test_deduplicates_repeated_bullets(self) -> None:
        assert _clean_project_bullets(["Same bullet", "Same bullet", "- Same bullet"]) == [
            "Same bullet"
        ]

    def test_caps_at_five_bullets(self) -> None:
        raw = [f"Bullet {i}" for i in range(8)]
        assert len(_clean_project_bullets(raw)) == 5

    def test_non_list_input_returns_empty(self) -> None:
        assert _clean_project_bullets(None) == []
        assert _clean_project_bullets("not a list") == []
        assert _clean_project_bullets({"bullets": ["x"]}) == []