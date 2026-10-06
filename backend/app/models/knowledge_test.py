"""
Online knowledge tests: a question bank, delivery to a member, and grading.

A ``knowledge_test`` training requirement used to be satisfied only by an
officer typing a score in. These tables let a training officer write the
questions once and have members sit the test themselves; the server grades it
and records the score through the same requirement-progress path an officer's
entry takes, so ``passing_score`` and ``max_attempts`` mean the same thing
either way.

Integrity rests on three rules the endpoints keep:

- The correct answers never leave the server before an attempt is submitted.
- An attempt grades against the copy of the questions it was given
  (``questions_snapshot``), so a later edit cannot re-score or re-word it.
- A score is computed by the server from the stored answers; nothing a client
  sends is taken as a score.
"""

from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class KnowledgeTestStatus(str, Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class KnowledgeQuestionType(str, Enum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    TRUE_FALSE = "true_false"


class KnowledgeAttemptStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"


class KnowledgeTest(Base):
    """A test definition and the bank its questions are drawn from."""

    __tablename__ = "knowledge_tests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)
    # The knowledge_test requirement a submitted attempt is credited to.
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Null: the linked requirement's passing_score, else 70.
    passing_score = Column(Float, nullable=True)
    time_limit_minutes = Column(Integer, nullable=True)
    # Null: every active question. Otherwise this many, drawn at random per
    # attempt, so two members sitting together do not see the same paper.
    question_count = Column(Integer, nullable=True)
    shuffle_questions = Column(Boolean, nullable=False, default=True)
    # Whether a member sees which answers were right once they submit.
    show_correct_answers = Column(Boolean, nullable=False, default=False)
    status = Column(String(20), nullable=False, default=KnowledgeTestStatus.DRAFT.value)
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_knowledge_test_org_status", "organization_id", "status"),
    )


class KnowledgeTestQuestion(Base):
    """One question in a test's bank."""

    __tablename__ = "knowledge_test_questions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    test_id = Column(
        String(36),
        ForeignKey("knowledge_tests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    prompt = Column(Text, nullable=False)
    question_type = Column(String(20), nullable=False)
    # [{"id": str, "text": str}]
    options = Column(JSON, nullable=False)
    # Option ids. Never serialized to a member before they submit.
    correct_option_ids = Column(JSON, nullable=False)
    explanation = Column(Text, nullable=True)
    points = Column(Float, nullable=False, default=1.0)
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class KnowledgeTestAttempt(Base):
    """One member's sitting of a test."""

    __tablename__ = "knowledge_test_attempts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    test_id = Column(
        String(36),
        ForeignKey("knowledge_tests.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status = Column(
        String(20),
        nullable=False,
        default=KnowledgeAttemptStatus.IN_PROGRESS.value,
    )
    started_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    # The questions exactly as delivered — order, option order, answers and
    # points — so grading and review never read the live bank.
    questions_snapshot = Column(JSON, nullable=False)
    # {question_id: [option_id, ...]}
    answers = Column(JSON, nullable=True)
    score = Column(Float, nullable=True)
    points_earned = Column(Float, nullable=True)
    points_possible = Column(Float, nullable=True)
    passed = Column(Boolean, nullable=True)
    passing_score = Column(Float, nullable=False)
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="SET NULL"),
        nullable=True,
    )
    show_correct_answers = Column(Boolean, nullable=False, default=False)
    # Whether the result reached a pipeline requirement, and if not, why.
    credited = Column(Boolean, nullable=False, default=False)
    credit_note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_knowledge_attempt_test_user", "test_id", "user_id", "status"),
        Index("idx_knowledge_attempt_user", "user_id"),
    )
