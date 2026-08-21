"""Unit tests for chat audit deterministic scoring."""

import pytest

from app.services.chat_audit import (
    _compute_action_verbs,
    _compute_quantification,
    _compute_section_completeness,
    _count_resume_mentions,
    _extract_all_text,
    _find_best_evidence,
)


_SAMPLE_RESUME = {
    "personalInfo": {"name": "Jane Doe", "email": "jane@example.com"},
    "summary": "Senior engineer with 8 years of experience.",
    "workExperience": [
        {
            "company": "Acme Corp",
            "title": "Senior Engineer",
            "description": [
                "Built a data pipeline that processed 1M records daily",
                "Led a team of 5 engineers to deliver a new product",
                "Managed cloud infrastructure reducing costs by 30%",
            ],
        }
    ],
    "education": [
        {"institution": "MIT", "degree": "BS Computer Science"}
    ],
    "personalProjects": [
        {
            "name": "Open Source Tool",
            "description": [
                "Created a CLI tool used by 500+ developers",
            ],
        }
    ],
}


class TestExtractAllText:
    def test_extracts_all_sections(self):
        text = _extract_all_text(_SAMPLE_RESUME)
        assert "Jane Doe" in text
        assert "Senior engineer" in text
        assert "Acme Corp" in text
        assert "Senior Engineer" in text
        assert "Built a data pipeline" in text
        assert "MIT" in text
        assert "Open Source Tool" in text

    def test_empty_resume(self):
        text = _extract_all_text({})
        assert text == ""


class TestSectionCompleteness:
    def test_full_resume(self):
        score = _compute_section_completeness(_SAMPLE_RESUME)
        assert score == 100.0

    def test_partial_resume(self):
        resume = {"personalInfo": {"name": "Jane"}}
        score = _compute_section_completeness(resume)
        assert score == 25.0

    def test_empty_resume(self):
        score = _compute_section_completeness({})
        assert score == 0.0


class TestQuantification:
    def test_all_quantified(self):
        resume = {
            "workExperience": [
                {"description": ["Increased revenue by 20%", "Reduced latency 3x"]}
            ]
        }
        score = _compute_quantification(resume)
        assert score == 100.0

    def test_no_quantification(self):
        resume = {
            "workExperience": [
                {"description": ["Built a great product", "Led the team"]}
            ]
        }
        score = _compute_quantification(resume)
        assert score == 0.0

    def test_mixed(self):
        resume = {
            "workExperience": [
                {"description": ["Built a product", "Reduced costs by 30%"]}
            ]
        }
        score = _compute_quantification(resume)
        assert score == 50.0


class TestActionVerbs:
    def test_strong_verbs(self):
        resume = {
            "workExperience": [
                {"description": ["Built a data pipeline", "Created a new feature"]}
            ]
        }
        score = _compute_action_verbs(resume)
        assert score == 100.0

    def test_weak_verbs(self):
        resume = {
            "workExperience": [
                {"description": ["Was responsible for the project", "Helped with tasks"]}
            ]
        }
        score = _compute_action_verbs(resume)
        assert score == 0.0

    def test_empty_bullets(self):
        score = _compute_action_verbs({})
        assert score == 0.0


class TestCountResumeMentions:
    def test_case_insensitive(self):
        text = "Python is used. I love PYTHON. Also python3."
        count = _count_resume_mentions(text, "Python")
        assert count == 3

    def test_no_mentions(self):
        count = _count_resume_mentions("Java is great", "Python")
        assert count == 0


class TestFindBestEvidence:
    def test_finds_in_experience(self):
        processed = {
            "workExperience": [
                {
                    "company": "Acme",
                    "description": ["Used Python extensively for data work"],
                }
            ]
        }
        result = _find_best_evidence(processed, "Python")
        assert result == "workExperience: Acme"

    def test_finds_in_projects(self):
        processed = {
            "personalProjects": [
                {
                    "name": "My Tool",
                    "description": ["Built with React and TypeScript"],
                }
            ]
        }
        result = _find_best_evidence(processed, "React")
        assert result == "personalProjects: My Tool"

    def test_no_evidence(self):
        result = _find_best_evidence({}, "Python")
        assert result is None
