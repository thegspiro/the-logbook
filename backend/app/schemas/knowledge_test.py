"""
Knowledge test request/response schemas.

Responses are snake_case (no alias generator), like the rest of the training
module's newer routes.

Two response shapes exist for a question on purpose: ``QuestionAdmin`` carries
the correct answers and is only ever built for ``training.manage``;
``QuestionDelivered`` is what a member sitting the test receives, and has no
field that could carry an answer.
"""

from datetime import datetime
from typing import Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.base import UTCResponseBase

MAX_OPTIONS = 10
MAX_QUESTIONS_PER_TEST = 500
QuestionTypeStr = Literal["single_choice", "multiple_choice", "true_false"]
TestStatusStr = Literal["draft", "published", "archived"]


class KnowledgeTestBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    instructions: Optional[str] = Field(None, max_length=5000)
    requirement_id: Optional[UUID] = None
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    time_limit_minutes: Optional[int] = Field(None, ge=1, le=600)
    question_count: Optional[int] = Field(None, ge=1, le=MAX_QUESTIONS_PER_TEST)
    shuffle_questions: bool = True
    show_correct_answers: bool = False

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class KnowledgeTestCreate(KnowledgeTestBase):
    pass


class KnowledgeTestUpdate(BaseModel):
    """Omitted fields are left alone; an explicit null clears the field."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    instructions: Optional[str] = Field(None, max_length=5000)
    requirement_id: Optional[UUID] = None
    passing_score: Optional[float] = Field(None, ge=0, le=100)
    time_limit_minutes: Optional[int] = Field(None, ge=1, le=600)
    question_count: Optional[int] = Field(None, ge=1, le=MAX_QUESTIONS_PER_TEST)
    shuffle_questions: Optional[bool] = None
    show_correct_answers: Optional[bool] = None
    status: Optional[TestStatusStr] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class OptionWrite(BaseModel):
    # Present when editing an existing option, so answers given against it in
    # earlier attempts still line up in review. New options get one assigned.
    id: Optional[str] = Field(None, max_length=36)
    text: str = Field(..., min_length=1, max_length=1000)
    correct: bool = False


class QuestionWrite(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=5000)
    question_type: QuestionTypeStr
    options: List[OptionWrite] = Field(..., min_length=2, max_length=MAX_OPTIONS)
    explanation: Optional[str] = Field(None, max_length=5000)
    points: float = Field(1.0, gt=0, le=100)
    sort_order: Optional[int] = Field(None, ge=0)
    active: bool = True

    @model_validator(mode="after")
    def _check_answers(self) -> "QuestionWrite":
        correct = sum(1 for o in self.options if o.correct)
        if self.question_type == "true_false" and len(self.options) != 2:
            raise ValueError("A true/false question has exactly two options")
        if self.question_type in ("single_choice", "true_false") and correct != 1:
            raise ValueError("Mark exactly one option as correct")
        if self.question_type == "multiple_choice" and correct < 1:
            raise ValueError("Mark at least one option as correct")
        texts = [o.text.strip().lower() for o in self.options]
        if len(set(texts)) != len(texts):
            raise ValueError("Two options have the same text")
        ids = [o.id for o in self.options if o.id]
        if len(set(ids)) != len(ids):
            raise ValueError("Two options have the same id")
        return self


class OptionAdmin(BaseModel):
    id: str
    text: str
    correct: bool


class QuestionAdmin(UTCResponseBase):
    id: UUID
    prompt: str
    question_type: str
    options: List[OptionAdmin]
    explanation: Optional[str] = None
    points: float
    sort_order: int
    active: bool


class KnowledgeTestResponse(UTCResponseBase):
    id: UUID
    name: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    requirement_id: Optional[UUID] = None
    requirement_name: Optional[str] = None
    passing_score: Optional[float] = None
    # What a sitting will actually be graded against, after the fallbacks.
    effective_passing_score: float
    time_limit_minutes: Optional[int] = None
    question_count: Optional[int] = None
    shuffle_questions: bool
    show_correct_answers: bool
    status: str
    active_question_count: int = 0
    attempt_count: int = 0
    # The caller's own most recent attempt, for the member list.
    my_latest_attempt: Optional["AttemptSummary"] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class KnowledgeTestDetail(KnowledgeTestResponse):
    """Officer view: the test with its whole question bank."""

    questions: List[QuestionAdmin] = Field(default_factory=list)


class AttemptSummary(UTCResponseBase):
    id: UUID
    test_id: UUID
    user_id: UUID
    user_name: Optional[str] = None
    status: str
    started_at: datetime
    expires_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    score: Optional[float] = None
    passed: Optional[bool] = None
    credited: bool = False
    credit_note: Optional[str] = None


class QuestionDelivered(BaseModel):
    id: str
    prompt: str
    question_type: str
    options: List[Dict[str, str]]
    points: float


class QuestionReviewed(QuestionDelivered):
    """A question after submission, when answers may be shown."""

    correct: bool
    correct_option_ids: List[str]
    explanation: Optional[str] = None


class AttemptResponse(AttemptSummary):
    test_name: str
    instructions: Optional[str] = None
    passing_score: float
    points_earned: Optional[float] = None
    points_possible: Optional[float] = None
    answers: Dict[str, List[str]] = Field(default_factory=dict)
    # Exactly one of these is filled: delivered questions while the attempt is
    # open, or (after submission, when the test allows it) reviewed ones.
    questions: List[QuestionDelivered] = Field(default_factory=list)
    review: Optional[List[QuestionReviewed]] = None
    # Seconds left on a timed attempt, from the server's clock.
    seconds_remaining: Optional[int] = None


class AnswersUpdate(BaseModel):
    answers: Dict[str, List[str]] = Field(..., max_length=MAX_QUESTIONS_PER_TEST)

    @field_validator("answers")
    @classmethod
    def _bounded(cls, v: Dict[str, List[str]]) -> Dict[str, List[str]]:
        for key, ids in v.items():
            if len(key) > 36 or len(ids) > MAX_OPTIONS or any(len(i) > 36 for i in ids):
                raise ValueError("Answer is malformed")
        return v


KnowledgeTestResponse.model_rebuild()
KnowledgeTestDetail.model_rebuild()
