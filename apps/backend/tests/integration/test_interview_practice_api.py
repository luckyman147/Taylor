"""Integration tests for the interview-practice hub endpoints."""

from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.main import app

LLM_FEEDBACK = {
    "score": 8,
    "level": "good",
    "strengths": ["Clear structure", "Relevant experience mentioned"],
    "improvements": ["Quantify the impact", "Tighten the intro"],
    "recommended_answer_points": ["Start with a hook", "Give one concrete metric"],
    "follow_ups": ["What would you do differently?", "Walk me through the timeline"],
}


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _post_feedback(payload: dict, llm_result: dict = LLM_FEEDBACK):
    with patch(
        "app.services.interview_practice.complete_json",
        new_callable=AsyncMock,
        return_value=llm_result,
    ) as mock:
        async with _client() as client:
            response = await client.post(
                "/api/v1/interview-practice/feedback", json=payload
            )
    return response, mock


async def test_feedback_without_resume(isolated_db) -> None:
    response, mock = await _post_feedback(
        {
            "scenario_id": "tell_me_about_yourself",
            "scenario_title": "Tell Me About Yourself",
            "scenario_description": "Master the art of introduction.",
            "duration_minutes": 15,
            "answer": "I am a software engineer with 3 years of experience.",
            "output_language": "en",
        }
    )

    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 8
    assert body["level"] == "good"
    assert body["strengths"] == LLM_FEEDBACK["strengths"]
    assert body["follow_ups"] == LLM_FEEDBACK["follow_ups"]
    assert body["scenario_id"] == "tell_me_about_yourself"
    assert body["answer"] == "I am a software engineer with 3 years of experience."
    assert body["session_id"]

    prompt = mock.await_args.kwargs["prompt"]
    assert "Tell Me About Yourself" in prompt
    assert "I am a software engineer with 3 years of experience." in prompt
    assert "resume" in prompt.lower()


async def test_feedback_uses_resume_context_when_requested(isolated_db) -> None:
    resume = await isolated_db.create_resume(
        content="# Master",
        is_master=True,
        processed_data={
            "personalInfo": {"name": "Jane Doe", "title": "Backend Engineer"},
            "workExperience": [
                {
                    "jobTitle": "Backend Engineer",
                    "company": "Acme",
                    "description": ["Built APIs in FastAPI"],
                }
            ],
        },
        processing_status="ready",
    )

    response, mock = await _post_feedback(
        {
            "scenario_title": "Tell Me About Yourself",
            "answer": "I build FastAPI services.",
            "resume_id": resume["resume_id"],
            "output_language": "en",
        }
    )
    assert response.status_code == 200
    prompt = mock.await_args.kwargs["prompt"]
    assert "Jane Doe" in prompt
    assert "Backend Engineer" in prompt


async def test_feedback_falls_back_to_master_resume(isolated_db) -> None:
    await isolated_db.create_resume(
        content="# Master",
        is_master=True,
        processed_data={
            "personalInfo": {"name": "John Master", "title": "Data Scientist"},
        },
        processing_status="ready",
    )

    response, mock = await _post_feedback(
        {
            "scenario_title": "Career Gaps",
            "answer": "I took time off to care for family.",
            "output_language": "en",
        }
    )
    assert response.status_code == 200
    prompt = mock.await_args.kwargs["prompt"]
    assert "John Master" in prompt
    assert "Data Scientist" in prompt


async def test_feedback_rejects_empty_answer(isolated_db) -> None:
    response, _ = await _post_feedback(
        {
            "scenario_title": "Tell Me About Yourself",
            "answer": "   ",
            "output_language": "en",
        }
    )
    assert response.status_code == 422


async def test_feedback_persists_history_and_lists_newest_first(isolated_db) -> None:
    for i in range(2):
        await _post_feedback(
            {
                "scenario_id": f"scenario-{i}",
                "scenario_title": f"Scenario {i}",
                "answer": f"Answer number {i}",
                "output_language": "en",
            },
            llm_result={**LLM_FEEDBACK, "score": 7 + i},
        )

    async with _client() as client:
        response = await client.get("/api/v1/interview-practice/sessions")
    assert response.status_code == 200
    sessions = response.json()
    assert [s["scenario_title"] for s in sessions] == ["Scenario 1", "Scenario 0"]
    assert sessions[0]["score"] == 8
    assert sessions[0]["feedback"]["strengths"] == LLM_FEEDBACK["strengths"]
    assert sessions[1]["score"] == 7


async def test_custom_scenario_persists_without_scenario_id(isolated_db) -> None:
    response, _ = await _post_feedback(
        {
            "scenario_title": "Practice: System design interviews",
            "scenario_description": "I want to practice whiteboarding a rate limiter",
            "answer": "I would start with requirements.",
            "output_language": "en",
        }
    )
    assert response.status_code == 200
    assert response.json()["scenario_id"] is None

    async with _client() as client:
        sessions = await client.get("/api/v1/interview-practice/sessions")
    assert sessions.json()[0]["scenario_id"] is None
    assert sessions.json()[0]["scenario_description"] == (
        "I want to practice whiteboarding a rate limiter"
    )