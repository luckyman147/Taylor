"""Schemas for the Chat Command Center."""

from pydantic import BaseModel, Field


class ThreadCreate(BaseModel):
    mode: str = Field(default="ask", max_length=30)
    skills: list[str] = Field(default_factory=list)
    title: str | None = Field(default=None, max_length=120)


class ThreadUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    mode: str | None = Field(default=None, max_length=30)
    skills: list[str] | None = None


class TurnRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    resume_id: str | None = None


class Action(BaseModel):
    kind: str  # "link" | "copy"
    label: str
    href: str | None = None
    copy_text: str | None = None


class ToolCard(BaseModel):
    kind: str  # "job" | "stats" | "audit" | "evidence" | "info"
    data: dict = Field(default_factory=dict)


class MemoryCandidate(BaseModel):
    statement: str


class PendingAction(BaseModel):
    token: str
    tool: str
    summary: str


class TurnResponse(BaseModel):
    assistant_content: str
    cards: list[ToolCard] = Field(default_factory=list)
    actions: list[Action] = Field(default_factory=list)
    stats: dict | None = None
    pending_action: PendingAction | None = None
    memory_candidates: list[MemoryCandidate] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    model_info: dict | None = None


class ConfirmRequest(BaseModel):
    token: str = Field(min_length=1, max_length=100)
    thread_id: str = Field(min_length=1, max_length=100)


class ConfirmResponse(BaseModel):
    ok: bool
    message: str
    result_card: ToolCard | None = None


class CancelRequest(BaseModel):
    token: str = Field(min_length=1, max_length=100)


class MemorySaveRequest(BaseModel):
    statement: str = Field(min_length=1, max_length=500)
    source_thread_id: str = Field(min_length=1, max_length=100)


class ThreadSummary(BaseModel):
    thread_id: str
    title: str
    mode: str
    skills: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    message_count: int = 0
    last_preview: str = ""


class ThreadMessage(BaseModel):
    message_id: str
    thread_id: str
    role: str  # "user" | "assistant"
    content: str
    created_at: str
    envelope: dict | None = None
