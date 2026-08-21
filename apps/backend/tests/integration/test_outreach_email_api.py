"""Integration tests for POST /enrichment/generate-outreach-email."""

from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.main import app


async def _post(payload: dict, llm_result: dict):
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        return_value=llm_result,
    ) as mock:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/generate-outreach-email", json=payload
            )
    return response, mock


async def test_generates_subject_and_body_for_internship() -> None:
    response, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "industry": "Robotics",
            "company_size": "51-200",
            "purpose": "internship",
            "output_language": "en",
        },
        {"subject": "Summer internship inquiry", "body": "Dear team,\n\nI would love to intern at Acme Robotics."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["subject"] == "Summer internship inquiry"
    assert "Acme Robotics" in payload["body"]

    prompt = mock.await_args.args[0]
    assert "Acme Robotics" in prompt
    assert "Applying for an internship opportunity" in prompt
    assert "Generate ALL output text in English" in prompt


async def test_custom_purpose_is_used_when_purpose_is_custom() -> None:
    _, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "custom",
            "custom_purpose": "Asking about a research collaboration",
            "output_language": "en",
        },
        {"subject": "Research collab", "body": "Hello."},
    )
    prompt = mock.await_args.args[0]
    assert "Asking about a research collaboration" in prompt


async def test_output_language_is_resolved_to_full_name() -> None:
    _, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "cold",
            "output_language": "fr",
        },
        {"subject": "Bonjour", "body": "Bonjour."},
    )
    prompt = mock.await_args.args[0]
    assert "Generate ALL output text in French" in prompt


async def test_missing_fields_yield_empty_strings() -> None:
    response, _ = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "internship",
            "output_language": "en",
        },
        {"subject": "", "body": None},
    )
    assert response.status_code == 200
    assert response.json() == {"subject": "", "body": ""}


async def test_resume_id_uses_selected_resume_profile() -> None:
    selected = {
        "resume_id": "resume-123",
        "processed_data": {
            "personalInfo": {"name": "Jane Specific"},
            "summary": "A summary only found in the selected resume.",
            "additional": {"technicalSkills": ["Rust"]},
        },
    }
    transport = ASGITransport(app=app)
    with (
        patch(
            "app.routers.enrichment.db.get_resume",
            new_callable=AsyncMock,
            return_value=selected,
        ) as mock_get,
        patch(
            "app.routers.enrichment.db.get_master_resume",
            new_callable=AsyncMock,
        ) as mock_master,
        patch(
            "app.routers.enrichment.complete_json",
            new_callable=AsyncMock,
            return_value={"subject": "Hi", "body": "Hello."},
        ) as mock_llm,
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/generate-outreach-email",
                json={
                    "company_name": "Acme Robotics",
                    "company_email": "careers@acme.example",
                    "purpose": "internship",
                    "output_language": "en",
                    "resume_id": "resume-123",
                },
            )

    assert response.status_code == 200
    mock_get.assert_awaited_once_with("resume-123")
    mock_master.assert_not_awaited()
    prompt = mock_llm.await_args.args[0]
    assert "Jane Specific" in prompt
    assert "A summary only found in the selected resume." in prompt
    assert "Rust" in prompt


async def test_unknown_resume_id_falls_back_to_master() -> None:
    master = {
        "resume_id": "master-1",
        "processed_data": {
            "personalInfo": {"name": "Master Person"},
            "additional": {},
        },
    }
    transport = ASGITransport(app=app)
    with (
        patch(
            "app.routers.enrichment.db.get_resume",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "app.routers.enrichment.db.get_master_resume",
            new_callable=AsyncMock,
            return_value=master,
        ) as mock_master,
        patch(
            "app.routers.enrichment.complete_json",
            new_callable=AsyncMock,
            return_value={"subject": "Hi", "body": "Hello."},
        ) as mock_llm,
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/generate-outreach-email",
                json={
                    "company_name": "Acme Robotics",
                    "company_email": "careers@acme.example",
                    "purpose": "internship",
                    "output_language": "en",
                    "resume_id": "does-not-exist",
                },
            )

    assert response.status_code == 200
    mock_master.assert_awaited_once()
    prompt = mock_llm.await_args.args[0]
    assert "Master Person" in prompt


async def test_instruction_is_appended_to_prompt() -> None:
    _, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "internship",
            "output_language": "en",
            "instruction": "Keep it under 80 words and mention my Flutter experience.",
        },
        {"subject": "Hi", "body": "Hello."},
    )
    prompt = mock.await_args.args[0]
    assert (
        "User's additional instructions for this generation (follow them precisely):\n"
        "Keep it under 80 words and mention my Flutter experience." in prompt
    )


async def test_custom_outreach_email_prompt_is_used() -> None:
    custom = (
        "You are a hiring insider. Write to {company_name} in {output_language} "
        "using {sender_info}. Purpose: {purpose}. Include {company_email}."
    )
    transport = ASGITransport(app=app)
    with (
        patch(
            "app.routers.enrichment._resolve_feature_prompt",
            return_value=(custom, True),
        ),
        patch(
            "app.routers.enrichment.complete_json",
            new_callable=AsyncMock,
            return_value={"subject": "Hi", "body": "Hello."},
        ) as mock_llm,
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/generate-outreach-email",
                json={
                    "company_name": "Acme Robotics",
                    "company_email": "careers@acme.example",
                    "purpose": "internship",
                    "output_language": "en",
                },
            )

    assert response.status_code == 200
    prompt = mock_llm.await_args.args[0]
    assert "You are a hiring insider." in prompt
    assert "Acme Robotics" in prompt
    assert "You are a professional career coach" not in prompt