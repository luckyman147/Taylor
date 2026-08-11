"""Unit tests for deterministic GitHub project descriptions (no LLM involvement)."""

from app.services.mcp.github import (
    _clip_line,
    _deterministic_project_paragraph,
    _project_idea,
)


def _repo(**overrides):
    repo = {
        "name": "smartpark-ai",
        "description": "Smart parking system using computer vision.",
        "languages": ["Python", "TypeScript", "YOLO"],
        "topics": ["computer-vision", "fastapi", "react-native"],
        "url": "https://github.com/janedoe/smartpark-ai",
        "readme": "",
    }
    repo.update(overrides)
    return repo


class TestProjectIdea:
    def test_description_is_preferred_over_readme(self):
        repo = _repo(
            readme="# SmartPark AI\n\nDetects free parking spots in real time from CCTV.\n\n## Setup\n"
        )
        assert _project_idea(repo) == "Smart parking system using computer vision."

    def test_clean_readme_tagline_when_no_description(self):
        repo = _repo(
            description="",
            readme="# SmartPark AI\n\nDetects free parking spots in real time from CCTV.\n\n## Setup\n",
        )
        assert _project_idea(repo) == "Detects free parking spots in real time from CCTV."

    def test_skips_headings_badges_and_code_fences(self):
        repo = _repo(
            description="",
            readme=(
                "![build](https://img.shields.io/badge/build-passing-green)\n"
                "# SmartPark AI\n"
                "---\n"
                "```\n"
                "# code block should be skipped\n"
                "```\n"
                "A city-wide parking availability monitor.\n"
            ),
        )
        assert _project_idea(repo) == "A city-wide parking availability monitor."

    def test_strips_bom_and_skips_first_heading(self):
        repo = _repo(
            description="",
            readme="\ufeff# Tunisia Oggi\nWeekly Tunisian news digest with local engagement insights.\n",
        )
        assert _project_idea(repo) == "Weekly Tunisian news digest with local engagement insights."

    def test_strips_inline_html_tags(self):
        repo = _repo(
            description="",
            readme=(
                '<p align="center"><strong>SmartPark</strong> is an AI parking availability '
                "platform.\n## Setup\n"
            ),
        )
        assert _project_idea(repo) == "SmartPark is an AI parking availability platform."

    def test_skips_html_markup_lines(self):
        repo = _repo(
            description="",
            readme='<p align="center">\n<img src="banner.png">\nAn ML-powered resume tailoring suite.\n',
        )
        assert _project_idea(repo) == "An ML-powered resume tailoring suite."

    def test_vite_boilerplate_readme_yields_no_idea(self):
        repo = _repo(
            name="aura",
            description="",
            readme=(
                "# React + Vite\n"
                "This template provides a minimal setup to get React working in Vite with HMR.\n"
                "## Expanding the ESLint configuration\n"
            ),
        )
        assert _project_idea(repo) == ""

    def test_falls_back_to_description_without_readme(self):
        assert _project_idea(_repo(readme="")) == "Smart parking system using computer vision."

    def test_short_readme_falls_back_to_description(self):
        repo = _repo(readme="# SmartPark AI\n")
        assert _project_idea(repo) == "Smart parking system using computer vision."

    def test_name_derived_fallback_when_nothing_else(self):
        repo = _repo(
            name="tunisia-oggi", description="", readme="", topics=[], languages=[]
        )
        assert _project_idea(repo) == ""
        assert _deterministic_project_paragraph(repo) == ["Tunisia oggi"]


class TestClipLine:
    def test_keeps_short_text(self):
        assert _clip_line("A short line.", 160) == "A short line."

    def test_clips_at_word_boundary(self):
        text = "word " * 100
        clipped = _clip_line(text, 30)
        assert len(clipped) <= 33
        assert clipped.endswith("...")
        assert "  " not in clipped


class TestDeterministicParagraph:
    def test_returns_single_flowing_paragraph(self):
        paragraphs = _deterministic_project_paragraph(_repo())
        assert len(paragraphs) == 1
        text = paragraphs[0]
        assert text == "Smart parking system using computer vision."

    def test_no_stack_or_language_mentions(self):
        text = _deterministic_project_paragraph(
            _repo(
                description="",
                readme="<p align=\"center\">Taylor is a full-stack resume automation suite.\n",
                topics=["computer-vision"],
            )
        )[0]
        assert text == "Taylor is a full-stack resume automation suite."
        assert "Built with" not in text
        assert "Python" not in text and "TypeScript" not in text

    def test_taylor_style_html_readme_produces_purpose(self):
        repo = _repo(
            name="Taylor",
            description="",
            readme=(
                '<p align="center">\n'
                '  <img src="apps/frontend/public/logo.png" alt="Taylor logo" width="96" height="96" />\n'
                "</p>\n"
                '<h1 align="center">Taylor</h1>\n'
                '<p align="center">AI-powered resume tailoring, cover letters, job scraping '
                "and application tracking.\n"
                '<p align="center"><strong>Taylor</strong> is a full-stack resume automation suite.\n'
                "## Screenshots\n"
                "| Screenshot | Description |\n"
            ),
        )
        paragraphs = _deterministic_project_paragraph(repo)
        assert paragraphs == [
            "AI-powered resume tailoring, cover letters, job scraping and application tracking."
        ]

    def test_languages_never_entered_the_paragraph(self):
        text = _deterministic_project_paragraph(_repo(topics=[]))[0]
        assert text == "Smart parking system using computer vision."

    def test_topics_never_entered_the_paragraph(self):
        repo = _repo(topics=[f"skill-{i}" for i in range(10)])
        text = _deterministic_project_paragraph(repo)[0]
        assert text == "Smart parking system using computer vision."

    def test_no_skills_at_all_is_plain_idea(self):
        text = _deterministic_project_paragraph(_repo(topics=[], languages=[]))[0]
        assert text == "Smart parking system using computer vision."

    def test_never_empty_with_name_only(self):
        text = _deterministic_project_paragraph(_repo(name="jciamember", description="", readme=""))[0]
        assert text.startswith("Jciamember")

    def test_clips_long_descriptions(self):
        long_text = " ".join(["sentence"] * 60)  # 540 chars
        paragraphs = _deterministic_project_paragraph(_repo(description=long_text, readme=""))
        assert len(paragraphs[0]) <= 223

    def test_empty_repo_yields_no_description(self):
        assert _deterministic_project_paragraph({}) == []