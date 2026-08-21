"""Unit tests for job intelligence (red flags, hiring probability)."""

from app.services.job_intel import (
    _career_seniority,
    _job_seniority,
    _keys_overlap,
    _normalize_company_tags,
    _normalize_skill,
    _role_seniority,
    _seniority_score,
    assess_hiring_probability,
    compare_dna,
    detect_red_flags,
)


class TestDetectRedFlags:
    def test_rockstar_language(self):
        result = detect_red_flags("We need a rockstar developer!", {})
        flags = [f["flag"] for f in result["red_flags"]]
        assert "Rockstar/wizard/ninja language" in flags

    def test_wear_many_hats(self):
        result = detect_red_flags("You will wear many hats in our startup.", {})
        flags = [f["flag"] for f in result["red_flags"]]
        assert "Extremely broad responsibilities" in flags

    def test_fast_paced(self):
        result = detect_red_flags("Join our fast-paced environment.", {})
        flags = [f["flag"] for f in result["red_flags"]]
        assert "High-pressure environment" in flags

    def test_competitive_salary(self):
        result = detect_red_flags("We offer a competitive salary.", {})
        flags = [f["flag"] for f in result["red_flags"]]
        assert "Salary not disclosed" in flags

    def test_unpaid_trial(self):
        result = detect_red_flags("Unpaid trial period for the first month.", {})
        flags = [f["flag"] for f in result["red_flags"]]
        assert "Unpaid trial detected" in flags

    def test_available_24_7(self):
        result = detect_red_flags("Must be available 24/7.", {})
        flags = [f["flag"] for f in result["red_flags"]]
        assert "Availability expectations" in flags

    def test_no_flags_clean_job(self):
        result = detect_red_flags(
            "Full-time Senior Backend Engineer. 5+ years experience required. "
            "Salary $120k-$150k. We value work-life balance.",
            {},
        )
        flags = [f["flag"] for f in result["red_flags"]]
        assert flags == []

    def test_ghost_risk_increases_with_danger_flags(self):
        clean = detect_red_flags(
            "Full-time role. Salary disclosed. 3+ years.", {}
        )
        dangerous = detect_red_flags(
            "Unpaid trial period. Full-time role. Salary disclosed. 3+ years.",
            {},
        )
        assert dangerous["ghost_risk_percent"] > clean["ghost_risk_percent"]


class TestCompanyTags:
    def test_splits_concatenated_tags(self):
        assert _normalize_company_tags(["startupfast_growth"]) == [
            "startup",
            "fast_growth",
        ]

    def test_deduplicates_and_validates(self):
        assert _normalize_company_tags(
            ["remote, remote", "startup", "bogus_tag"]
        ) == ["remote", "startup"]


class TestSeniority:
    def test_role_seniority_detection(self):
        assert _role_seniority("Senior Backend Engineer") == 3
        assert _role_seniority("Junior Developer") == 1
        assert _role_seniority("CTO") == 8

    def test_career_seniority_takes_highest_title(self):
        career = {
            "work_experience": [
                {"title": "Junior Developer", "years": "2"},
                {"title": "Senior Developer", "years": "4"},
            ]
        }
        level, years = _career_seniority(career)
        assert level == 3
        assert years == 6.0

    def test_job_seniority_from_years_when_unspecified(self):
        level, years = _job_seniority({}, "5+ years of experience required")
        assert years == 5
        assert level >= 3

    def test_seniority_score_gap_penalty(self):
        assert _seniority_score(3, 3) == 100.0
        assert _seniority_score(4, 3) == 85.0
        assert _seniority_score(5, 2) == 55.0
        assert _seniority_score(3, 8) == 100.0  # over-qualified still scores


def _sample_comparison(skills=80.0, experience=70.0):
    return {
        "technical": {
            "score": skills,
            "matched": [{"skill": "react", "jobWeight": 5, "careerLevel": "high"}],
            "missing": [],
            "extra": [],
        },
        "experience": {
            "score": experience,
            "matched": ["backend"],
            "missing": [],
        },
        "company": {"score": 100.0, "matched": ["remote"], "missing": []},
        "dna_match": 75.0,
    }


class TestSkillNormalization:
    def test_strips_suffixes_and_separators(self):
        assert _normalize_skill("React.js") == ["react"]
        assert _normalize_skill("Node.js") == ["node"]
        assert _normalize_skill("C#") == ["c#"]

    def test_splits_alias_pairs(self):
        assert _normalize_skill("TFS / Azure DevOps") == ["tfs", "azuredevops"]

    def test_strips_vendor_prefix(self):
        assert _normalize_skill("Microsoft SQL Server") == ["sqlserver", "sql"]
        assert _normalize_skill("Apache Solr") == ["solr"]

    def test_strips_legacy_qualifier(self):
        assert _normalize_skill("Legacy ASP.NET") == ["aspnet"]

    def test_net_family_aliases(self):
        assert _normalize_skill(".NET Framework") == ["netframework", "net"]
        assert _normalize_skill(".NET Core") == ["netcore"]
        assert _normalize_skill("ASP.NET Core") == ["aspnetcore"]
        assert _normalize_skill("ASP.NET") == ["aspnet"]

    def test_entity_framework_keeps_meaningful_name(self):
        assert _normalize_skill("Entity Framework") == ["entityframework", "entity"]
        assert _normalize_skill("Entity Framework Core") == ["entityframeworkcore"]


class TestKeysOverlap:
    def test_exact_match(self):
        assert _keys_overlap(["react"], ["react"])

    def test_containment_matches_aspnet_family(self):
        assert _keys_overlap(["aspnet"], ["aspnetcore"])
        assert _keys_overlap(["aspnetcore"], ["aspnet"])

    def test_short_keys_do_not_containment_match(self):
        # "java" must not match "javascript" via containment
        assert not _keys_overlap(["java"], ["javascript"])
        # "c" must not match "c++"
        assert not _keys_overlap(["c"], ["c++"])

    def test_alias_list_any_match(self):
        assert _keys_overlap(["tfs", "azuredevops"], ["azuredevops"])
        assert _keys_overlap(["tfs", "azuredevops"], ["tfs"])

    def test_no_match(self):
        assert not _keys_overlap(["react"], ["vue"])
        assert not _keys_overlap(["netcore"], ["netframework"])


class TestCompareDnaMatching:
    def _run(self, job_skills: list[str], career_skills: list[str]):
        job_dna = {"technical": [{"skill": s, "weight": 10} for s in job_skills], "experience": [], "company": []}
        career_dna = {"technical": [{"skill": s, "level": "high"} for s in career_skills], "experience": [], "company": []}
        return compare_dna(job_dna, career_dna)

    def test_aspnet_matches_aspnet_core(self):
        result = self._run(["ASP.NET"], ["ASP.NET Core"])
        assert len(result["technical"]["matched"]) == 1
        assert result["technical"]["missing"] == []

    def test_microsoft_sql_server_matches_sql_server(self):
        result = self._run(["Microsoft SQL Server"], ["SQL Server"])
        assert len(result["technical"]["matched"]) == 1
        assert result["technical"]["missing"] == []

    def test_tfs_slash_azure_devops_matches_either(self):
        result = self._run(["TFS / Azure DevOps"], ["Azure DevOps"])
        assert len(result["technical"]["matched"]) == 1
        result = self._run(["TFS / Azure DevOps"], ["TFS"])
        assert len(result["technical"]["matched"]) == 1

    def test_legacy_aspnet_matches_aspnet_core(self):
        result = self._run(["Legacy ASP.NET"], ["ASP.NET Core"])
        assert len(result["technical"]["matched"]) == 1

    def test_entity_framework_matches_entity_framework_core(self):
        result = self._run(["Entity Framework"], ["Entity Framework Core"])
        assert len(result["technical"]["matched"]) == 1

    def test_dotnet_framework_matches_dotnet(self):
        result = self._run([".NET Framework"], [".NET"])
        assert len(result["technical"]["matched"]) == 1

    def test_apache_solr_matches_solr(self):
        result = self._run(["Apache Solr"], ["Solr"])
        assert len(result["technical"]["matched"]) == 1

    def test_unrelated_skills_stay_missing(self):
        result = self._run(["RabbitMQ"], ["React"])
        assert result["technical"]["missing"] == [{"skill": "RabbitMQ", "weight": 10}]

    def test_score_reflects_partial_match(self):
        result = self._run(["React", "Vue"], ["React"])
        assert result["technical"]["score"] == 25.0
        assert len(result["technical"]["matched"]) == 1
        assert len(result["technical"]["missing"]) == 1


class TestHiringProbability:
    def test_strong_profile_is_excellent_target(self):
        result = assess_hiring_probability(
            job_dna={"technical": [{"skill": "react", "weight": 5}], "experience": [{"domain": "backend", "level": "medium"}]},
            career_dna={"technical": [{"skill": "react", "level": "high"}], "experience": [{"domain": "backend", "level": "medium"}], "company": []},
            comparison=_sample_comparison(),
            job_keywords={"seniority_level": "senior"},
            content="Senior role. 5+ years.",
            career_data={"work_experience": [{"title": "Senior Developer", "years": "6"}]},
        )
        assert result["hiring_probability"] >= 80
        assert result["assessment"] == "Excellent target"
        assert result["gaps"]

    def test_weak_profile_is_long_shot(self):
        result = assess_hiring_probability(
            job_dna={"technical": [{"skill": "go", "weight": 10}], "experience": [{"domain": "backend", "level": "high"}]},
            career_dna={"technical": [{"skill": "css", "level": "high"}], "experience": [{"domain": "frontend", "level": "low"}], "company": []},
            comparison=_sample_comparison(skills=20.0, experience=0.0),
            job_keywords={"seniority_level": "principal"},
            content="Principal Engineer. 10+ years.",
            career_data={"work_experience": [{"title": "Junior Developer", "years": "1"}]},
        )
        assert result["hiring_probability"] < 50
        assert result["assessment"] in ("Stretch", "Long shot")
        assert result["gaps"]

    def test_seniority_gap_listed_in_gaps(self):
        result = assess_hiring_probability(
            job_dna={"technical": [{"skill": "react", "weight": 5}], "experience": [{"domain": "backend", "level": "medium"}]},
            career_dna={"technical": [{"skill": "react", "level": "high"}], "experience": [{"domain": "backend", "level": "medium"}], "company": []},
            comparison=_sample_comparison(skills=90.0, experience=90.0),
            job_keywords={"seniority_level": "principal"},
            content="Principal role.",
            career_data={"work_experience": [{"title": "Junior Developer", "years": "2"}]},
        )
        assert any("seniority" in gap for gap in result["gaps"])
        assert result["skills"]["score"] == 90.0
        assert result["experience"]["score"] == 90.0
        assert result["seniority"]["score"] < 60