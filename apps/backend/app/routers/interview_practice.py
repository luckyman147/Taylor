"""Interview practice hub endpoints: AI feedback on practice answers + history."""

import logging

from fastapi import APIRouter, HTTPException

from app.config_cache import get_content_language
from app.database import db
from app.schemas import (
    InterviewPracticeFeedbackRequest,
    InterviewPracticeFeedbackResponse,
    PracticeSessionSummary,
)
from app.services.interview_practice import generate_practice_feedback

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/interview-practice", tags=["Interview Practice"])


@router.post("/feedback", response_model=InterviewPracticeFeedbackResponse)
async def submit_practice_answer(
    request: InterviewPracticeFeedbackRequest,
) -> InterviewPracticeFeedbackResponse:
    """Score a practice answer, persist the session, and return feedback.

    Resume context: the requested ``resume_id`` is used when provided;
    otherwise the master resume grounds the feedback. If no usable resume
    data exists the coach falls back to generic structure/delivery feedback.
    """
    resume_data = None
    if request.resume_id:
        resume = await db.get_resume(request.resume_id)
        processed = (resume or {}).get("processed_data")
        if isinstance(processed, dict) and processed:
            resume_data = processed
    if resume_data is None:
        master = await db.get_master_resume()
        processed = (master or {}).get("processed_data")
        if isinstance(processed, dict) and processed:
            resume_data = processed

    language = get_content_language()

    try:
        feedback = await generate_practice_feedback(
            scenario_title=request.scenario_title,
            scenario_description=request.scenario_description,
            answer=request.answer,
            resume_data=resume_data,
            language=language,
        )
    except Exception as exc:
        logger.exception("Interview practice feedback failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to generate practice feedback. Please try again.",
        )

    try:
        session = await db.create_practice_session(
            scenario_id=request.scenario_id,
            scenario_title=request.scenario_title,
            scenario_description=request.scenario_description,
            duration_minutes=request.duration_minutes,
            answer=request.answer,
            score=feedback.score,
            level=feedback.level,
            feedback={
                "strengths": feedback.strengths,
                "improvements": feedback.improvements,
                "recommended_answer_points": feedback.recommended_answer_points,
                "follow_ups": feedback.follow_ups,
            },
        )
    except Exception as exc:
        logger.error("Failed to persist practice session: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Failed to save practice session. Please try again.",
        )

    return InterviewPracticeFeedbackResponse(
        session_id=session["session_id"],
        scenario_id=request.scenario_id,
        scenario_title=request.scenario_title,
        scenario_description=request.scenario_description,
        duration_minutes=request.duration_minutes,
        answer=request.answer,
        score=feedback.score,
        level=feedback.level,
        strengths=feedback.strengths,
        improvements=feedback.improvements,
        recommended_answer_points=feedback.recommended_answer_points,
        follow_ups=feedback.follow_ups,
        created_at=session["created_at"],
    )


@router.get("/sessions", response_model=list[PracticeSessionSummary])
async def list_practice_sessions() -> list[PracticeSessionSummary]:
    """List recorded practice sessions, newest first."""
    rows = await db.list_practice_sessions()
    return [PracticeSessionSummary(**row) for row in rows]