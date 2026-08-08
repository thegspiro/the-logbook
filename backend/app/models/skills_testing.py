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


class SkillTemplateVisibility(str, enum.Enum):
    """Controls who can see a published skill template"""

    ALL_MEMBERS = "all_members"
    OFFICERS_ONLY = "officers_only"
    ASSIGNED_ONLY = "assigned_only"


class SkillTestStatus(str, enum.Enum):
    """Status of a skill test session"""

    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    # An official result withdrawn after the fact. Official results are never
    # deleted — they are evaluation records that a member's certification may
    # rest on — so a mistaken or invalidated test is voided instead: the row
    # survives with its reason and author, but stops counting toward stats and
    # releases any pipeline requirement it had credited.
    VOIDED = "voided"


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
    )

    # Template Details
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    version = Column(Integer, default=1)
    status = Column(String(20), default="draft")
    visibility = Column(String(20), default="all_members")

    # Template Structure — JSON array of SkillTemplateSection[]
    # Each section contains: name, description, sort_order, criteria[]
    # Each criterion contains: label, description, type, required, sort_order,
    #   passing_score, max_score, time_limit_seconds, checklist_items
    sections = Column(JSON, nullable=False)

    # Scoring & Rules
    time_limit_seconds = Column(Integer, nullable=True)
    passing_percentage = Column(Float, nullable=True)
    require_all_critical = Column(Boolean, default=True)

    # Optional pipeline linkage — the training requirement this template's tests
    # satisfy. Tests inherit it at creation (overridable per test), and a passing
    # test marks that requirement complete on the candidate's active enrollment.
    # SET NULL requires nullable=True.
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Metadata
    tags = Column(JSON, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
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
    )
    template_id = Column(
        String(36),
        ForeignKey("skill_templates.id", ondelete="CASCADE"),
        nullable=False,
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

    # Optional pipeline linkage — inherited from the template at creation but
    # overridable per test. A passing (non-practice) test marks this requirement
    # complete on the candidate's active enrollment. SET NULL → nullable=True.
    requirement_id = Column(
        String(36),
        ForeignKey("training_requirements.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Test State
    status = Column(String(20), default="draft")
    result = Column(String(20), default="incomplete")
    is_practice = Column(Boolean, default=False)

    # Optimistic-concurrency counter, incremented on every mutation. A client
    # may send the version it last saw; a mismatch means someone else wrote in
    # between and the write is refused rather than silently overwriting them.
    #
    # An integer rather than updated_at: MySQL DATETIME carries no fractional
    # seconds by default, so two writes inside the same second compare equal
    # and the conflict goes undetected.
    version = Column(Integer, nullable=False, default=1, server_default="1")

    # Frozen copy of the template as it stood when this test was created:
    # {version, sections, passing_percentage, require_all_critical,
    #  time_limit_seconds}.
    #
    # Criterion identity is positional ("criterion-{section}-{index}"), and
    # updating a published template rewrites skill_templates.sections in place.
    # Without this snapshot, inserting or deleting a criterion re-binds every
    # historical result to different criteria — a recorded pass would display
    # against whichever criterion later took that slot, and deleted criteria
    # would drop recorded evidence off the scorecard entirely. Scoring rules are
    # frozen alongside the structure so a result is never re-derived against a
    # passing threshold that didn't apply at the time.
    #
    # Nullable for rows created before the column existed; readers fall back to
    # the live template.
    template_snapshot = Column(JSON, nullable=True)

    # Results — JSON array of SectionResult[] with nested CriterionResult[]
    section_results = Column(JSON, nullable=True)
    overall_score = Column(Float, nullable=True)
    elapsed_seconds = Column(Integer, nullable=True)

    # Notes
    notes = Column(Text, nullable=True)

    # Void trail — set only when an official result is withdrawn. SET NULL on the
    # author (a departed officer must not erase the void record), so nullable.
    voided_at = Column(DateTime(timezone=True), nullable=True)
    voided_by = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    void_reason = Column(Text, nullable=True)

    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    template = relationship("SkillTemplate", back_populates="tests", lazy="select")
    candidate = relationship("User", foreign_keys=[candidate_id], lazy="select")
    examiner = relationship("User", foreign_keys=[examiner_id], lazy="select")

    __table_args__ = (
        Index("idx_skill_test_org_status", "organization_id", "status"),
        Index("idx_skill_test_template_candidate", "template_id", "candidate_id"),
        # Sweep index for the practice-attempt purge job, which scans by
        # is_practice + age.
        Index("idx_skill_test_practice_created", "is_practice", "created_at"),
    )

    def __repr__(self):
        return f"<SkillTest(template_id={self.template_id}, candidate_id={self.candidate_id}, status={self.status})>"
