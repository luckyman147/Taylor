"""Schemas for the interview-practice hub (scenario practice + feedback)."""

from pydantic import BaseModel, Field, field_validator


class InterviewPracticeFeedbackRequest(BaseModel):
    """A practice attempt to be scored by the AI coach.

    ``scenario_id`` is None for ad-hoc sessions started from the "Have an
    idea?" custom input; in that case ``scenario_title`` / ``scenario_description``
    carry the user's own prompt. ``resume_id`` selects the resume whose
    processed data grounds the feedback; when absent the master resume is used.
    """

    scenario_id: str | None = Field(default=None, max_length=100)
    scenario_title: str = Field(min_length=1, max_length=300)
    scenario_description: str | None = Field(default=None, max_length=4000)
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    answer: str = Field(min_length=1, max_length=20000)
    resume_id: str | None = Field(default=None, max_length=100)
    output_language: str = Field(default="en", max_length=20)

    @field_validator("answer", mode="before")
    @classmethod
    def _reject_blank_answer(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            raise ValueError("Answer must not be empty")
        return value


class PracticeFeedback(BaseModel):
    """The AI coach's feedback payload (validated LLM output)."""

    score: int = Field(ge=1, le=10)
    level: str
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    recommended_answer_points: list[str] = Field(default_factory=list)
    follow_ups: list[str] = Field(default_factory=list)


class InterviewPracticeFeedbackResponse(BaseModel):
    """Structured AI coaching feedback for a practice answer."""

    session_id: str
    scenario_id: str | None = None
    scenario_title: str
    scenario_description: str | None = None
    duration_minutes: int | None = None
    answer: str
    score: int
    level: str
    strengths: list[str]
    improvements: list[str]
    recommended_answer_points: list[str]
    follow_ups: list[str]
    created_at: str


class PracticeSessionSummary(BaseModel):
    """One historical practice session (feedback flattened to top level)."""

    session_id: str
    scenario_id: str | None = None
    scenario_title: str
    scenario_description: str | None = None
    duration_minutes: int | None = None
    answer: str
    score: int | None = None
    level: str | None = None
    feedback: dict[str, object] = Field(default_factory=dict)
    created_at: str