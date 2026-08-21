"""Unit tests for the mobile-job field extractor (title/company/location)."""

from app.routers.jobs import _extract_mobile_job_fields


class TestExtractMobileJobFields:
    def test_at_company_pattern(self):
        fields = _extract_mobile_job_fields(
            "About the job\n( Full-Stack Engineer @ Stravos )\nÀ propos de Stravos :"
        )
        assert fields["title"] == "Full-Stack Engineer"
        assert fields["company"] == "Stravos"

    def test_at_company_pattern_with_recruitment_prefix(self):
        fields = _extract_mobile_job_fields(
            "About the job\nRecrutement - CDI ( Full-Stack Engineer @ Stravos )\nÀ propos de Stravos :"
        )
        assert fields["title"] == "Full-Stack Engineer"
        assert fields["company"] == "Stravos"

    def test_pipe_line_with_location_and_work_mode(self):
        fields = _extract_mobile_job_fields(
            "Junior Django Developer – Full-Time | On-site | Tunis, Tunisia\nCompany Description\nBridges S.A. is a company."
        )
        assert fields["title"] == "Junior Django Developer"
        assert fields["location"] == "Tunis, Tunisia"

    def test_company_description_header_takes_next_line(self):
        fields = _extract_mobile_job_fields(
            "Job Title: Platform Engineer\nCompany Description\nBridges S.A. is a growing company."
        )
        assert fields["title"] == "Platform Engineer"
        assert fields["company"] == "Bridges S.A."

    def test_labeled_fields(self):
        fields = _extract_mobile_job_fields(
            "Position: Senior Backend Engineer\nCompany: Acme Corp\nLocation: Remote"
        )
        assert fields["title"] == "Senior Backend Engineer"
        assert fields["company"] == "Acme Corp"
        assert fields["location"] == "Remote"

    def test_first_line_falls_back_to_title_when_plausible(self):
        fields = _extract_mobile_job_fields(
            "Senior Data Engineer\nWe are looking for a data engineer to join our team."
        )
        assert fields["title"] == "Senior Data Engineer"

    def test_boilerplate_first_line_is_not_used_as_title(self):
        fields = _extract_mobile_job_fields(
            "About the job\nWe are looking for a versatile Full-stack Developer.\nRoles And Responsibilities"
        )
        assert fields["title"] is None

    def test_stored_company_keywords_are_ignored_by_extractor(self):
        # The extractor only reads raw content; LLM job_keywords live in
        # metadata and are merged by the router (stored wins).
        fields = _extract_mobile_job_fields("KILLS REQUIRED\n10+ years of experience.")
        assert fields["title"] is None
        assert fields["company"] is None

    def test_empty_and_short_content(self):
        assert _extract_mobile_job_fields("") == {
            "title": None,
            "company": None,
            "location": None,
        }
        assert _extract_mobile_job_fields("   \n  ")["title"] is None

    def test_about_company_pattern(self):
        fields = _extract_mobile_job_fields(
            "Account Manager\nAbout Stravos :\nStravos est une agence."
        )
        assert fields["title"] == "Account Manager"
        assert fields["company"] == "Stravos"