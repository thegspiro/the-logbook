"""
Skills Testing Database Models

SQLAlchemy models for skills testing management including templates and test sessions.
"""

import enum

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
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class SkillTemplateStatus(str, enum.Enum):
    """Status of a skill template"""

    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class SkillTestStatus(str, enum.Enum):
    """Status of a skill test session"""

    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class SkillTestResult(str, enum.Enum):
    """Result of a skill test"""

    PASS = "pass"
    FAIL = "fail"
    INCOMPLETE = "incomplete"


class SkillTemplate(Base):
    """
    Skill Template model

    Defines a reusable template for skills testing. Contains sections with
    nested criteria that examiners use to evaluate candidates. The sections
    field stores a JSON array of SkillTemplateSection objects, each containing
    an array of SkillCriterion objects.
    """

    __tablename__ = "skill_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Template Details
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    version = Column(Integer, default=1)
    status = Column(String(20), default="draft")

    # Template Structure — JSON array of SkillTemplateSection[]
    # Each section contains: name, description, sort_order, criteria[]
    # Each criterion contains: label, description, type, required, sort_order,
    #   passing_score, max_score, time_limit_seconds, checklist_items
    sections = Column(JSON, nullable=False)

    # Scoring & Rules
    time_limit_seconds = Column(Integer, nullable=True)
    passing_percentage = Column(Float, nullable=True)
    require_all_critical = Column(Boolean, default=True)

    # Metadata
    tags = Column(JSON, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)

    # Relationships
    tests = relationship("SkillTest", back_populates="template", lazy="select")

    __table_args__ = (
        Index("idx_skill_template_org_status", "organization_id", "status"),
        Index("idx_skill_template_category", "organization_id", "category"),
    )

    def __repr__(self):
        return f"<SkillTemplate(name={self.name}, status={self.status}, version={self.version})>"


class SkillTest(Base):
    """
    Skill Test model

    Represents a single test session where an examiner evaluates a candidate
    against a skill template. Stores per-section results and an overall score.
    """

    __tablename__ = "skill_tests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    template_id = Column(
        String(36),
        ForeignKey("skill_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    candidate_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    examiner_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Test State
    status = Column(String(20), default="draft")
    result = Column(String(20), default="incomplete")

    # Results — JSON array of SectionResult[] with nested CriterionResult[]
    section_results = Column(JSON, nullable=True)
    overall_score = Column(Float, nullable=True)
    elapsed_seconds = Column(Integer, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    template = relationship("SkillTemplate", back_populates="tests", lazy="select")
    candidate = relationship("User", foreign_keys=[candidate_id], lazy="select")
    examiner = relationship("User", foreign_keys=[examiner_id], lazy="select")

    __table_args__ = (
        Index("idx_skill_test_org_status", "organization_id", "status"),
        Index("idx_skill_test_template_candidate", "template_id", "candidate_id"),
    )

    def __repr__(self):
        return f"<SkillTest(template_id={self.template_id}, candidate_id={self.candidate_id}, status={self.status})>"
