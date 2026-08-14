from app.schemas.models import AdditionalInfo, Experience


def test_additional_skills_split_on_commas() -> None:
    info = AdditionalInfo.model_validate(
        {"technicalSkills": ["Angular, .NET / ASP.NET Core, NestJS, Spring Boot, FastAPI,"]}
    )

    assert info.technicalSkills == [
        "Angular",
        ".NET / ASP.NET Core",
        "NestJS",
        "Spring Boot",
        "FastAPI",
    ]


def test_additional_skills_split_across_lines_and_semicolons() -> None:
    info = AdditionalInfo.model_validate(
        {
            "technicalSkills": [
                "Git, GitHub; Agile, Scrum",
                "JavaScript, TypeScript",
            ]
        }
    )

    assert info.technicalSkills == [
        "Git",
        "GitHub",
        "Agile",
        "Scrum",
        "JavaScript",
        "TypeScript",
    ]


def test_additional_entries_dedupe_case_insensitively() -> None:
    info = AdditionalInfo.model_validate(
        {"technicalSkills": ["JavaScript, javascript", "React.js", "react.js"]}
    )

    assert info.technicalSkills == ["JavaScript", "React.js"]


def test_additional_entries_keep_commas_inside_parentheses() -> None:
    info = AdditionalInfo.model_validate(
        {"technicalSkills": ["PHP (Laravel, Symfony), MySQL"]}
    )

    assert info.technicalSkills == ["PHP (Laravel, Symfony)", "MySQL"]


def test_additional_languages_split_on_commas() -> None:
    info = AdditionalInfo.model_validate({"languages": ["English, French", "Arabic"]})

    assert info.languages == ["English", "French", "Arabic"]


def test_additional_awards_split_on_commas() -> None:
    info = AdditionalInfo.model_validate(
        {"awards": ["Employee of the Year 2022, Best Mentor 2023"]}
    )

    assert info.awards == ["Employee of the Year 2022", "Best Mentor 2023"]


def test_descriptions_are_not_split_on_commas() -> None:
    experience = Experience.model_validate(
        {"description": ["Led the platform team, cut p99 latency 30%"]}
    )

    assert experience.description == ["Led the platform team, cut p99 latency 30%"]