"""Unit tests for refiner pure functions — no LLM calls needed."""

import copy
import logging
import pytest

from app.services.refiner import (
    _normalize_company,
    _restore_missing_work_experience,
    _validate_resume_structure,
    analyze_keyword_gaps,
    calculate_keyword_match,
    fix_alignment_violations,
    refine_resume,
    remove_ai_phrases,
    validate_master_alignment,
)
from app.schemas.refinement import AlignmentViolation, RefinementConfig


class TestRemoveAiPhrases:
    """Tests for remove_ai_phrases() — local regex replacement."""

    def test_removes_blacklisted_verbs(self, sample_resume):
        data = copy.deepcopy(sample_resume)
        data["workExperience"][0]["description"][0] = "Spearheaded REST API development"
        cleaned, removed = remove_ai_phrases(data)
        assert "spearheaded" in [r.lower() for r in removed]
        assert "spearheaded" not in cleaned["workExperience"][0]["description"][0].lower()

    def test_removes_buzzwords(self, sample_resume):
        data = copy.deepcopy(sample_resume)
        data["summary"] = "Leveraged cutting-edge technologies to build robust solutions"
        cleaned, removed = remove_ai_phrases(data)
        removed_lower = [r.lower() for r in removed]
        assert "leveraged" in removed_lower
        assert "cutting-edge" in removed_lower

    def test_protects_jd_phrases(self, sample_resume):
        data = copy.deepcopy(sample_resume)
        data["summary"] = "Built robust microservices"
        # "robust" is in the blacklist, but if it's in JD, it should be protected
        cleaned, removed = remove_ai_phrases(data, job_description="We need robust solutions")
        assert "robust" not in [r.lower() for r in removed]

    def test_replaces_with_alternatives(self, sample_resume):
        data = copy.deepcopy(sample_resume)
        data["workExperience"][0]["description"][0] = "Utilized Python for API development"
        cleaned, removed = remove_ai_phrases(data)
        # "utilized" → "used"
        assert "used" in cleaned["workExperience"][0]["description"][0].lower()

    def test_removes_em_dashes(self, sample_resume):
        data = copy.deepcopy(sample_resume)
        data["summary"] = "Built APIs \u2014 serving thousands of users"
        cleaned, removed = remove_ai_phrases(data)
        assert "\u2014" not in cleaned["summary"]

    def test_no_removal_when_already_clean(self):
        """A resume with no blacklisted terms should have zero removals."""
        clean_data = {
            "summary": "Built APIs with Python.",
            "workExperience": [{"description": ["Wrote code and shipped features"]}],
        }
        cleaned, removed = remove_ai_phrases(clean_data)
        assert len(removed) == 0

    def test_does_not_mutate_input(self, sample_resume):
        data = copy.deepcopy(sample_resume)
        data["summary"] = "Spearheaded development"
        data_before = copy.deepcopy(data)
        remove_ai_phrases(data)
        # The input dict should not be mutated by remove_ai_phrases
        assert data == data_before


class TestValidateMasterAlignment:
    """Tests for validate_master_alignment() — fabrication detection."""

    def test_aligned_when_identical(self, sample_resume, master_resume):
        report = validate_master_alignment(sample_resume, master_resume)
        assert report.is_aligned is True
        assert len(report.violations) == 0

    def test_detects_fabricated_skill(self, sample_resume, master_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].append("Kubernetes")
        report = validate_master_alignment(tailored, master_resume)
        skill_violations = [v for v in report.violations if "skill" in v.violation_type]
        assert len(skill_violations) >= 1
        assert any("kubernetes" in v.value.lower() for v in skill_violations)

    def test_allows_jd_added_skill_when_explicitly_allowed(self, sample_resume, master_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].append("Kubernetes")
        report = validate_master_alignment(
            tailored,
            master_resume,
            allowed_new_skills={"Kubernetes"},
        )
        critical_skill_violations = [
            v
            for v in report.violations
            if "skill" in v.violation_type and v.severity == "critical"
        ]
        assert critical_skill_violations == []

    async def test_refiner_rejects_skill_from_generic_keyword_only(
        self,
        sample_resume,
        master_resume,
    ):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].append("CI/CD")
        result = await refine_resume(
            initial_tailored=tailored,
            master_resume=master_resume,
            job_description="Familiarity with CI/CD pipelines and agile practices",
            job_keywords={
                "required_skills": [],
                "preferred_skills": [],
                "keywords": ["CI/CD"],
            },
            config=RefinementConfig(
                enable_keyword_injection=False,
                enable_ai_phrase_removal=False,
                enable_master_alignment_check=True,
            ),
        )
        assert "CI/CD" not in result.refined_data["additional"]["technicalSkills"]

    async def test_refiner_allows_required_skill_present_in_job_description(
        self,
        sample_resume,
        master_resume,
    ):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].append("Kubernetes")
        result = await refine_resume(
            initial_tailored=tailored,
            master_resume=master_resume,
            job_description="Experience with Kubernetes is required.",
            job_keywords={
                "required_skills": ["Kubernetes"],
                "preferred_skills": [],
                "keywords": [],
            },
            config=RefinementConfig(
                enable_keyword_injection=False,
                enable_ai_phrase_removal=False,
                enable_master_alignment_check=True,
            ),
        )
        assert "Kubernetes" in result.refined_data["additional"]["technicalSkills"]

    @pytest.mark.parametrize(
        ("skill", "job_description"),
        [
            ("C++", "Experience with C++ is required for systems tooling."),
            ("C#", "Experience with C# is required for .NET services."),
        ],
    )
    async def test_refiner_allows_required_punctuated_skill_present_in_job_description(
        self,
        sample_resume,
        master_resume,
        skill,
        job_description,
    ):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].append(skill)
        result = await refine_resume(
            initial_tailored=tailored,
            master_resume=master_resume,
            job_description=job_description,
            job_keywords={
                "required_skills": [skill],
                "preferred_skills": [],
                "keywords": [],
            },
            config=RefinementConfig(
                enable_keyword_injection=False,
                enable_ai_phrase_removal=False,
                enable_master_alignment_check=True,
            ),
        )
        assert skill in result.refined_data["additional"]["technicalSkills"]

    def test_detects_fabricated_certification(self, sample_resume, master_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["certificationsTraining"].append("Google Cloud Professional")
        report = validate_master_alignment(tailored, master_resume)
        cert_violations = [v for v in report.violations if v.violation_type == "fabricated_cert"]
        assert len(cert_violations) >= 1

    def test_detects_fabricated_company(self, sample_resume, master_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["workExperience"].append({
            "id": 3,
            "title": "Engineer",
            "company": "FakeCompany Inc",
            "years": "2015 - 2017",
            "description": ["Did things"],
        })
        report = validate_master_alignment(tailored, master_resume)
        company_violations = [v for v in report.violations if v.violation_type == "fabricated_company"]
        assert len(company_violations) >= 1

    def test_allows_skill_variants_as_non_critical(self, sample_resume, master_resume):
        """A variant of an existing skill (e.g. 'Python 3') should be info, not critical."""
        tailored = copy.deepcopy(sample_resume)
        # Master has "Python", tailored adds "Python 3" — substring match should be non-critical
        tailored["additional"]["technicalSkills"].append("Python 3")
        report = validate_master_alignment(tailored, master_resume)
        python3_violations = [
            v for v in report.violations
            if "python 3" in v.value.lower()
        ]
        # Should be info/variant, NOT critical fabricated_skill
        for v in python3_violations:
            assert v.severity != "critical" or v.violation_type == "skill_variant"

    def test_confidence_decreases_with_violations(self, sample_resume, master_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].extend(["Kotlin", "Scala", "Haskell"])
        report = validate_master_alignment(tailored, master_resume)
        assert report.confidence_score < 1.0


class TestFixAlignmentViolations:
    """Tests for fix_alignment_violations() — removing fabricated content."""

    def test_removes_fabricated_skill(self, sample_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["technicalSkills"].append("FakeSkill")
        violations = [
            AlignmentViolation(
                field_path="additional.technicalSkills",
                violation_type="fabricated_skill",
                value="FakeSkill",
                severity="critical",
            )
        ]
        fixed = fix_alignment_violations(tailored, violations)
        assert "FakeSkill" not in fixed["additional"]["technicalSkills"]

    def test_removes_fabricated_cert(self, sample_resume):
        tailored = copy.deepcopy(sample_resume)
        tailored["additional"]["certificationsTraining"].append("Fake Cert")
        violations = [
            AlignmentViolation(
                field_path="additional.certificationsTraining",
                violation_type="fabricated_cert",
                value="Fake Cert",
                severity="critical",
            )
        ]
        fixed = fix_alignment_violations(tailored, violations)
        assert "Fake Cert" not in fixed["additional"]["certificationsTraining"]

    def test_skips_non_critical_violations(self, sample_resume):
        tailored = copy.deepcopy(sample_resume)
        original_skills = list(tailored["additional"]["technicalSkills"])
        violations = [
            AlignmentViolation(
                field_path="additional.technicalSkills",
                violation_type="skill_variant",
                value="Python",
                severity="info",
            )
        ]
        fixed = fix_alignment_violations(tailored, violations)
        assert fixed["additional"]["technicalSkills"] == original_skills


class TestAnalyzeKeywordGaps:
    """Tests for analyze_keyword_gaps() — keyword matching analysis."""

    def test_finds_missing_keywords(self, sample_resume, master_resume, sample_job_keywords):
        analysis = analyze_keyword_gaps(sample_job_keywords, sample_resume, master_resume)
        # "Kubernetes" is in required_skills but not in the resume
        assert "Kubernetes" in analysis.missing_keywords

    def test_identifies_injectable_vs_non_injectable(self, sample_resume, master_resume, sample_job_keywords):
        analysis = analyze_keyword_gaps(sample_job_keywords, sample_resume, master_resume)
        # Every keyword lands in exactly one bucket
        all_jd = set(sample_job_keywords["required_skills"] + sample_job_keywords["preferred_skills"] + sample_job_keywords["keywords"])
        present = all_jd - set(analysis.missing_keywords)
        injectable = set(analysis.injectable_keywords)
        non_injectable = set(analysis.non_injectable_keywords)
        # Missing = injectable + non-injectable (no overlap)
        assert injectable | non_injectable == set(analysis.missing_keywords)
        assert injectable & non_injectable == set()
        # Present + missing = all keywords
        assert present | set(analysis.missing_keywords) == all_jd

    def test_calculates_match_percentage(self, sample_resume, master_resume, sample_job_keywords):
        analysis = analyze_keyword_gaps(sample_job_keywords, sample_resume, master_resume)
        assert 0.0 <= analysis.current_match_percentage <= 100.0
        assert analysis.potential_match_percentage >= analysis.current_match_percentage

    def test_keyword_already_present(self, sample_resume, master_resume):
        keywords = {"required_skills": ["Python"], "preferred_skills": [], "keywords": []}
        analysis = analyze_keyword_gaps(keywords, sample_resume, master_resume)
        assert "Python" not in analysis.missing_keywords
        assert analysis.current_match_percentage == 100.0


class TestCalculateKeywordMatch:
    """Tests for calculate_keyword_match() — percentage calculation."""

    def test_returns_percentage(self, sample_resume, sample_job_keywords):
        pct = calculate_keyword_match(sample_resume, sample_job_keywords)
        assert 0.0 <= pct <= 100.0

    def test_returns_zero_for_no_keywords(self, sample_resume):
        pct = calculate_keyword_match(sample_resume, {"required_skills": [], "preferred_skills": [], "keywords": []})
        assert pct == 0.0

    def test_returns_100_when_all_present(self, sample_resume):
        # Use keywords that are definitely in the resume
        keywords = {"required_skills": ["Python", "FastAPI"], "preferred_skills": [], "keywords": []}
        pct = calculate_keyword_match(sample_resume, keywords)
        assert pct == 100.0

    def test_word_boundary_matching(self, sample_resume):
        """'Go' should not match 'Google' or 'going'."""
        keywords = {"required_skills": ["Go"], "preferred_skills": [], "keywords": []}
        pct = calculate_keyword_match(sample_resume, keywords)
        # "Go" is not in the sample resume as a standalone word
        assert pct == 0.0


class TestNormalizeCompany:
    """Tests for _normalize_company() — company name normalization."""

    def test_strips_location_suffix_pipe(self):
        assert _normalize_company("Barmajti IT | Remote") == "barmajti it"

    def test_strips_location_suffix_dash(self):
        assert _normalize_company("JCI Hammam Sousse - Tunisia") == "jci hammam sousse"

    def test_casefold_and_whitespace(self):
        assert _normalize_company("  BARMAJTI   IT  |  Remote  ") == "barmajti it"

    def test_empty_string(self):
        assert _normalize_company("") == ""

    def test_none_input(self):
        assert _normalize_company(None) == ""

    def test_no_suffix_unchanged(self):
        assert _normalize_company("Acme Corp") == "acme corp"


class TestValidateMasterAlignmentNormalized:
    """Tests for validate_master_alignment() with normalized company comparison."""

    def test_no_violation_for_location_suffix_difference(self, sample_resume, master_resume):
        """Companies differing only by '| Location' suffix should NOT be flagged."""
        tailored = copy.deepcopy(sample_resume)
        # Modify to have location suffix (like master_resume likely has)
        tailored["workExperience"][0]["company"] = "Tech Corp | Remote"
        master_resume["workExperience"][0]["company"] = "Tech Corp"

        report = validate_master_alignment(tailored, master_resume)
        company_violations = [v for v in report.violations if v.violation_type == "fabricated_company"]
        assert len(company_violations) == 0

    def test_still_flags_genuinely_new_company(self, sample_resume, master_resume):
        """A completely new company should still be flagged as fabricated."""
        tailored = copy.deepcopy(sample_resume)
        tailored["workExperience"].append({
            "id": 99,
            "title": "Engineer",
            "company": "Totally Fake Corp",
            "years": "2020 - 2021",
            "description": ["Did things"],
        })
        report = validate_master_alignment(tailored, master_resume)
        company_violations = [v for v in report.violations if v.violation_type == "fabricated_company"]
        assert len(company_violations) == 1
        assert "totally fake corp" in company_violations[0].value


class TestFixAlignmentViolationsNeverEmptiesWorkExperience:
    """Tests that fix_alignment_violations never empties workExperience."""

    def test_restores_company_from_master_on_match(self, sample_resume, master_resume):
        """When normalized company matches, restore master's original company string."""
        tailored = copy.deepcopy(sample_resume)
        tailored["workExperience"][0]["company"] = "Tech Corp"  # Without suffix
        master_resume["workExperience"][0]["company"] = "Tech Corp | Remote"

        violations = [
            AlignmentViolation(
                field_path="workExperience",
                violation_type="fabricated_company",
                value="tech corp",  # normalized
                severity="critical",
            )
        ]
        fixed = fix_alignment_violations(tailored, violations, master=master_resume)
        # Should restore the master's company string
        assert fixed["workExperience"][0]["company"] == "Tech Corp | Remote"

    def test_never_empties_work_experience(self, sample_resume, master_resume):
        """Even with multiple fabricated companies, should not empty the list."""
        tailored = copy.deepcopy(sample_resume)
        # Add two fabricated companies
        tailored["workExperience"].extend([
            {"id": 3, "title": "Eng", "company": "Fake Co 1", "years": "2020", "description": []},
            {"id": 4, "title": "Eng", "company": "Fake Co 2", "years": "2021", "description": []},
        ])
        violations = [
            AlignmentViolation(
                field_path="workExperience",
                violation_type="fabricated_company",
                value="fake co 1",
                severity="critical",
            ),
            AlignmentViolation(
                field_path="workExperience",
                violation_type="fabricated_company",
                value="fake co 2",
                severity="critical",
            ),
        ]
        fixed = fix_alignment_violations(tailored, violations, master=master_resume)
        # Should keep at least the original entries
        assert len(fixed["workExperience"]) >= len(sample_resume["workExperience"])

    def test_keeps_entry_with_no_master_match_logs_warning(self, sample_resume, master_resume, caplog):
        """Entry with no master match should be kept (not deleted)."""
        tailored = copy.deepcopy(sample_resume)
        tailored["workExperience"].append({
            "id": 99,
            "title": "Engineer",
            "company": "Unique Corp",
            "years": "2020 - 2021",
            "description": ["Did things"],
        })
        violations = [
            AlignmentViolation(
                field_path="workExperience",
                violation_type="fabricated_company",
                value="unique corp",
                severity="critical",
            )
        ]
        with caplog.at_level(logging.WARNING):
            fixed = fix_alignment_violations(tailored, violations, master=master_resume)
        # Entry should still be there (not deleted)
        assert any(exp.get("company") == "Unique Corp" for exp in fixed["workExperience"])
        # Warning should have been logged
        assert any("No master match" in record.message for record in caplog.records)


class TestValidateResumeStructureWithBaseline:
    """Tests for _validate_resume_structure() with baseline comparison."""

    def test_accepts_same_length_work_experience(self, sample_resume):
        assert _validate_resume_structure(sample_resume, baseline=sample_resume) is True

    def test_rejects_shorter_work_experience(self, sample_resume):
        """Should reject if workExperience has fewer entries than baseline."""
        data = copy.deepcopy(sample_resume)
        data["workExperience"] = data["workExperience"][:1]  # Reduce to 1 entry
        assert _validate_resume_structure(data, baseline=sample_resume) is False

    def test_rejects_missing_work_experience(self, sample_resume):
        """Should reject if workExperience key is missing."""
        data = copy.deepcopy(sample_resume)
        del data["workExperience"]
        assert _validate_resume_structure(data, baseline=sample_resume) is False

    def test_rejects_empty_work_experience(self, sample_resume):
        """Should reject if workExperience is empty list when baseline has entries."""
        data = copy.deepcopy(sample_resume)
        data["workExperience"] = []
        assert _validate_resume_structure(data, baseline=sample_resume) is False

    def test_accepts_without_baseline(self, sample_resume):
        """Should accept if no baseline provided (backwards compat)."""
        data = copy.deepcopy(sample_resume)
        data["workExperience"] = []
        assert _validate_resume_structure(data, baseline=None) is True


class TestRestoreMissingWorkExperience:
    """Tests for _restore_missing_work_experience() post-refinement guard."""

    def test_restores_missing_entries(self, sample_resume):
        """Should restore entries lost during refinement."""
        baseline = copy.deepcopy(sample_resume)
        refined = copy.deepcopy(sample_resume)
        refined["workExperience"] = refined["workExperience"][:1]  # Lose one entry

        restored, warnings = _restore_missing_work_experience(baseline, refined)

        assert len(restored["workExperience"]) == len(baseline["workExperience"])
        assert len(warnings) == 1
        assert "restored" in warnings[0].lower()

    def test_no_op_when_equal_or_more(self, sample_resume):
        """Should not add entries if refined has same or more."""
        baseline = copy.deepcopy(sample_resume)
        refined = copy.deepcopy(sample_resume)

        restored, warnings = _restore_missing_work_experience(baseline, refined)
        assert len(restored["workExperience"]) == len(refined["workExperience"])
        assert len(warnings) == 0

        # Add extra entry
        refined["workExperience"].append({"id": 99, "title": "Extra", "company": "Extra Co", "years": "2022", "description": []})
        restored, warnings = _restore_missing_work_experience(baseline, refined)
        assert len(restored["workExperience"]) == len(refined["workExperience"])
        assert len(warnings) == 0

    def test_handles_missing_keys_gracefully(self):
        """Should not crash if workExperience key is missing."""
        baseline = {"workExperience": [{"id": 1, "company": "Test"}]}
        refined = {"workExperience": []}
        restored, warnings = _restore_missing_work_experience(baseline, refined)
        assert restored["workExperience"] == baseline["workExperience"]
        assert len(warnings) == 1

    def test_matches_by_normalized_company(self, sample_resume):
        """Should match entries by normalized company name."""
        baseline = copy.deepcopy(sample_resume)
        refined = copy.deepcopy(sample_resume)
        # Change company in refined (LLM normalization) - remove "| Remote" suffix
        refined["workExperience"][0]["company"] = "Tech Corp"
        baseline["workExperience"][0]["company"] = "Tech Corp | Remote"

        restored, warnings = _restore_missing_work_experience(baseline, refined)
        # Should recognize it's the same company and not add duplicate
        assert len(restored["workExperience"]) == len(baseline["workExperience"])
        assert len(warnings) == 0
