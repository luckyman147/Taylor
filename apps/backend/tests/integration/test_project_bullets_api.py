"""Integration tests for POST /enrichment/generate-project-bullets."""

from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.main import app

_README = (
    "# Chatty\n"
    "Real-time chat app. Uses WebSockets, Redis pub/sub, PostgreSQL.\n"
    "Supports 5k concurrent users with 40ms p95 latency.\n"
)


async def _post(payload: dict, llm_result: dict):
    transport = ASGITransport(app=app)
    with patch(
        "app.routers.enrichment.complete_json",
        new_callable=AsyncMock,
        return_value=llm_result,
    ) as mock:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/enrichment/generate-project-bullets", json=payload
            )
    return response, mock


async def test_readme_path_returns_cleaned_bullets() -> None:
    response, mock = await _post(
        {
            "name": "Chatty",
            "role": "Creator",
            "years": "2023",
            "github": "github.com/u/chatty",
            "description": ["A chat app"],
            "languages": ["Python", "Redis"],
            "readme": _README,
            "output_language": "en",
        },
        {"bullets": ["- Built real-time chat with WebSockets", "* Redis pub/sub", ""]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["bullets"] == [
        "Built real-time chat with WebSockets",
        "Redis pub/sub",
    ]
    prompt = mock.await_args.args[0]
    assert "Chatty" in prompt
    assert "Real-time chat app" in prompt
    assert "No additional user instruction" in prompt


async def test_prompt_path_expands_user_mini_prompt() -> None:
    response, mock = await _post(
        {
            "name": "Chatty",
            "description": [],
            "languages": [],
            "readme": None,
            "prompt": "I built a chat app with websockets for 5k users",
            "output_language": "en",
        },
        {"bullets": ["Bullet one", "Bullet two"]},
    )

    assert response.status_code == 200
    assert response.json()["bullets"] == ["Bullet one", "Bullet two"]
    prompt = mock.await_args.args[0]
    assert "USER'S FOCUS/INSTRUCTION" in prompt
    assert "I built a chat app with websockets for 5k users" in prompt


async def test_output_language_is_resolved_to_full_name() -> None:
    _, mock = await _post(
        {"name": "Chatty", "readme": _README, "output_language": "fr"},
        {"bullets": ["Puce un"]},
    )
    prompt = mock.await_args.args[0]
    assert "Generate ALL output text in French" in prompt


async def test_malformed_llm_output_yields_empty_bullets() -> None:
    response, _ = await _post(
        {"name": "Chatty", "readme": _README, "output_language": "en"},
        {"bullets": "not a list"},
    )
    assert response.status_code == 200
    assert response.json()["bullets"] == []