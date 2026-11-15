"""Integration tests for POST /enrichment/generate-outreach-email."""

from unittest.mock import AsyncMock, patch

import litellm
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


async def test_missing_fields_yield_empty_strings(isolated_db) -> None:
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
    assert response.json() == {
        "subject": "",
        "body": "",
        "uses_html_signature": False,
    }


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
        "**User's additional instructions (HIGHEST PRIORITY — follow these precisely):**\n"
        "Keep it under 80 words and mention my Flutter experience." in prompt
    )
    assert "Email structure (greeting, blank lines, sign-off) MUST still be followed." in prompt
    assert (
        "If the instructions above specify a different output language, "
        "use that language for the entire email." in prompt
    )


async def test_french_instruction_overrides_output_language() -> None:
    """A French template pasted as instructions must produce a French email
    even when the configured content language is English."""
    _, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "internship",
            "output_language": "en",
            "instruction": (
                "Bonjour, je me permets de vous écrire car je suis très intéressé "
                "par votre entreprise et je pense que mon expérience correspond."
            ),
        },
        {"subject": "Bonjour", "body": "Bonjour."},
    )
    prompt = mock.await_args.args[0]
    assert "Generate ALL output text in French" in prompt
    assert "Generate ALL output text in English" not in prompt
    assert (
        "The user's text above is written in French — write the entire email "
        "(subject and body) in French." in prompt
    )


async def test_english_instruction_keeps_configured_french_language() -> None:
    """Short English meta-instructions must not flip a user who explicitly set
    a non-English content language."""
    _, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "internship",
            "output_language": "fr",
            "instruction": "Keep it under 80 words and mention my Flutter experience.",
        },
        {"subject": "Bonjour", "body": "Bonjour."},
    )
    prompt = mock.await_args.args[0]
    assert "Generate ALL output text in French" in prompt
    assert "written in English" not in prompt


async def test_french_custom_purpose_overrides_output_language() -> None:
    _, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "custom",
            "custom_purpose": (
                "Je souhaite proposer une collaboration de recherche avec votre "
                "équipe sur des sujets d'intelligence artificielle."
            ),
            "output_language": "en",
        },
        {"subject": "Bonjour", "body": "Bonjour."},
    )
    prompt = mock.await_args.args[0]
    assert "Generate ALL output text in French" in prompt
    assert "Generate ALL output text in English" not in prompt


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


async def test_repairs_incomplete_ellipsis_body() -> None:
    incomplete = {
        "subject": "Internship",
        "body": (
            "Hi Acme Robotics team,\n\n"
            "I thought I'd reach out because...\n\n"
            "Most recently shipping X that did Y.\n\n"
            "Best,\nJane Doe"
        ),
    }
    repaired = {
        "subject": "Internship",
        "body": (
            "Hi Acme Robotics team,\n\n"
            "I found your robotics internship listing and wanted to write because "
            "my React and Node work matches your warehouse tooling.\n\n"
            "Best,\nJane Doe"
        ),
    }
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        side_effect=[incomplete, repaired],
    ) as mock_llm:
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
    assert mock_llm.await_count == 2
    repair_prompt = mock_llm.await_args.args[0]
    assert "REPAIR TASK" in repair_prompt
    body = response.json()["body"]
    assert "..." not in body
    assert "X that did Y" not in body
    assert "wanted to write" in body


async def test_complete_body_is_not_repaired(isolated_db) -> None:
    good = {
        "subject": "Internship",
        "body": (
            "Hi Acme Robotics team,\n\n"
            "I saw your internship post and wanted to write about my React and Node work.\n\n"
            "Best,\nJane Doe"
        ),
    }
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        return_value=good,
    ) as mock_llm:
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
    assert mock_llm.await_count == 1
    body = response.json()["body"]
    assert body.startswith(good["body"])
    assert "REPAIR TASK" not in body
    # No HTML signature configured → markdown contact footer may be present
    # depending on resume data; flag must be false.
    assert response.json().get("uses_html_signature") is False


async def test_html_signature_skips_markdown_contact_footer(isolated_db) -> None:
    await isolated_db.update_career_profile(
        {"email_signature": "<p><strong>Jane Doe</strong><br>Engineer</p>"}
    )
    llm = {
        "subject": "Hi",
        "body": (
            "Hi Acme team,\n\n"
            "I wanted to write about the internship.\n\n"
            "Best,\nJane Doe"
        ),
    }
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        return_value=llm,
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/generate-outreach-email",
                json={
                    "company_name": "Acme",
                    "company_email": "careers@acme.example",
                    "purpose": "internship",
                    "output_language": "en",
                },
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["uses_html_signature"] is True
    # Markdown one-liner footer must not be appended when signature is set.
    assert "**" not in payload["body"] or "| [mailto:" not in payload["body"]
    assert "mailto:" not in payload["body"]
    assert payload["body"].rstrip().endswith("Jane Doe")


async def test_generation_passes_trace_metadata_for_usage_attribution() -> None:
    """The draft call must carry trace_name so /status llm_usage.by_tag can
    attribute outreach emails (they would otherwise fall back to 'diff')."""
    response, mock = await _post(
        {
            "company_name": "Acme Robotics",
            "company_email": "careers@acme.example",
            "purpose": "internship",
            "output_language": "en",
        },
        {
            "subject": "Internship inquiry",
            "body": "Dear team,\n\nI would love to intern at Acme Robotics.\n\nBest,\nJane Doe",
        },
    )
    assert response.status_code == 200
    metadata = mock.await_args.kwargs.get("metadata")
    assert metadata is not None
    assert metadata["trace_name"] == "outreach_email"


async def test_concurrent_duplicate_requests_share_one_llm_call() -> None:
    """A double-clicked generate button fires two identical requests; the
    second must coalesce onto the first in-flight generation instead of
    double-billing the LLM. Sequential (later) calls still recompute."""
    import asyncio

    llm_result = {
        "subject": "Internship inquiry",
        "body": "Dear team,\n\nI would love to intern at Acme Robotics.\n\nBest,\nJane Doe",
    }

    async def slow_generate(*args, **kwargs):
        await asyncio.sleep(0.2)
        return llm_result

    payload = {
        "company_name": "Acme Robotics",
        "company_email": "careers@acme.example",
        "purpose": "internship",
        "output_language": "en",
    }
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        side_effect=slow_generate,
    ) as mock_llm:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first, second = await asyncio.gather(
                client.post("/api/v1/enrichment/generate-outreach-email", json=payload),
                client.post("/api/v1/enrichment/generate-outreach-email", json=payload),
            )

    assert first.status_code == 200
    assert second.status_code == 200
    assert mock_llm.await_count == 1
    assert first.json()["subject"] == second.json()["subject"]


async def test_transient_llm_outage_returns_503_with_generic_detail() -> None:
    """After the Router exhausts its retries, a Gemini 503 must surface as a
    clean 503 (with Retry-After) instead of an unhandled 500 traceback, and
    the upstream error text must never reach the client."""
    transport = ASGITransport(app=app)
    outage = litellm.ServiceUnavailableError(
        "This model is currently experiencing high demand. UNAVAILABLE",
        "gemini",
        "gemini-3-flash-preview",
    )
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        side_effect=outage,
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

    assert response.status_code == 503
    assert response.headers.get("retry-after") == "10"
    detail = response.json()["detail"]
    assert detail == "The AI service is busy right now. Please try again in a moment."
    assert "high demand" not in response.text
    assert "UNAVAILABLE" not in response.text


async def test_unexpected_error_returns_generic_500() -> None:
    """Non-transient failures (bad content, app bugs) return a generic 500
    with no internals leaked (CLAUDE.md rule 2)."""
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        side_effect=ValueError("No JSON found in response: {internal"),
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

    assert response.status_code == 500
    assert response.json()["detail"] == (
        "Failed to generate outreach email. Please try again."
    )
    assert "No JSON" not in response.text
