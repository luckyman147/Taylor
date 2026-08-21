"""Unit tests for cover letter ATS-analysis stripping."""

import pytest

from app.services.cover_letter import strip_ats_analysis


class TestStripAtsAnalysis:
    def test_removes_trailing_markdown_section(self):
        letter = (
            "Dear Hiring Manager,\n\n"
            "I would be a great fit.\n\n"
            "Best regards,\n"
            "**John Doe**\n\n"
            "---\n\n"
            "### **ATS Match Analysis**\n\n"
            "**Estimated ATS Score:** 88/100\n\n"
            "**Matching Skills:**\n- Python\n- React\n"
        )
        cleaned = strip_ats_analysis(letter)
        assert "ATS" not in cleaned
        assert cleaned.endswith("**John Doe**")

    def test_removes_section_without_separator_or_heading(self):
        letter = (
            "Best regards,\nJane Doe\n\n"
            "ATS Match Analysis:\n"
            "Estimated score 90/100. Matching skills: SQL, Go.\n"
        )
        cleaned = strip_ats_analysis(letter)
        assert "ATS" not in cleaned
        assert cleaned.endswith("Jane Doe")

    def test_removes_plain_bold_heading(self):
        letter = "Regards,\nJ. Doe\n\n**ATS Score Analysis**\nSomething about keywords."
        cleaned = strip_ats_analysis(letter)
        assert "ATS" not in cleaned
        assert cleaned.endswith("J. Doe")

    def test_leaves_mid_letter_ats_mention(self):
        letter = (
            "My resume is ATS-friendly and keyword-optimized.\n\n"
            "Best regards,\nJane Doe"
        )
        assert strip_ats_analysis(letter) == letter

    def test_clean_letter_unchanged(self):
        letter = "Dear Team,\n\nGreat fit.\n\nBest regards,\nJohn"
        assert strip_ats_analysis(letter) == letter

    def test_empty_input(self):
        assert strip_ats_analysis("") == ""

    def test_only_ats_section_removed_entirely(self):
        assert strip_ats_analysis("ATS Match Analysis\nscore: 99") == ""

    def test_removes_lowercase_heading(self):
        letter = "Regards,\nJ. Doe\n\n### ats match analysis\n- React\n- Django"
        cleaned = strip_ats_analysis(letter)
        assert "ats" not in cleaned
        assert cleaned.endswith("J. Doe")