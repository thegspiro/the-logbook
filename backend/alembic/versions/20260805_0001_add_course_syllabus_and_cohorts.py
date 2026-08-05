"""Add course syllabus and cohort tables

Multi-class courses. A course (e.g. "Recruit School") gains an ordered syllabus
of classes, each timed relative to the course start rather than pinned to a
calendar date. A cohort is one scheduled run of that course: it materializes
every syllabus row onto real dates, backed by an Event + TrainingSession, and
carries the roster of members taking it.

This is also a merge revision. The versions directory had two heads
(20260801_0020 storefront and 20260802_0001 dues ledger), both branching off
20260801_0019; chaining off both collapses them back to a single head.

Revision ID: 20260805_0001
Revises: 20260801_0020, 20260802_0001
Create Date: 2026-08-05 00:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260805_0001"
down_revision = ("20260801_0020", "20260802_0001")
branch_labels = None
depends_on = None


COHORT_STATUS = ("draft", "scheduled", "in_progress", "completed", "cancelled")
COHORT_CLASS_STATUS = ("scheduled", "completed", "cancelled")
COHORT_MEMBER_STATUS = ("active", "withdrawn", "completed")
DATE_ROLL_POLICY = ("none", "next_business_day", "next_meeting_day")


def _timestamps() -> list:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("CURRENT_TIMESTAMP"),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
        ),
    ]


def upgrade() -> None:
    # Links a container course to the pipeline its cohorts enrol members in.
    op.add_column(
        "training_courses",
        sa.Column(
            "program_id",
            sa.String(36),
            sa.ForeignKey("training_programs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "course_classes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "course_id",
            sa.String(36),
            sa.ForeignKey("training_courses.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # NOT NULL, so CASCADE rather than SET NULL (MySQL rejects SET NULL on a
        # NOT NULL column with error 1830). Courses are only soft-deleted in
        # practice, so this never fires.
        sa.Column(
            "class_course_id",
            sa.String(36),
            sa.ForeignKey("training_courses.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("section_name", sa.String(255), nullable=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("day_offset", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("start_time", sa.String(5), nullable=True),
        sa.Column(
            "duration_minutes", sa.Integer(), nullable=False, server_default="60"
        ),
        sa.Column("credit_hours", sa.Float(), nullable=True),
        sa.Column(
            "instructor_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("instructor", sa.String(255), nullable=True),
        sa.Column(
            "location_id",
            sa.String(36),
            sa.ForeignKey("locations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("location", sa.String(300), nullable=True),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("training_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("training_requirements.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "phase_id",
            sa.String(36),
            sa.ForeignKey("program_phases.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "is_required", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "counts_toward_certification",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("course_id", "sequence", name="uq_course_class_sequence"),
    )
    op.create_index(
        "idx_course_class_org_course",
        "course_classes",
        ["organization_id", "course_id"],
    )

    op.create_table(
        "course_cohorts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "course_id",
            sa.String(36),
            sa.ForeignKey("training_courses.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*COHORT_STATUS, name="cohortstatus"),
            nullable=False,
            server_default="draft",
            index=True,
        ),
        sa.Column(
            "program_id",
            sa.String(36),
            sa.ForeignKey("training_programs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("meeting_days", sa.JSON(), nullable=True),
        sa.Column("default_start_time", sa.String(5), nullable=True),
        sa.Column("default_duration_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "date_roll_policy",
            sa.Enum(*DATE_ROLL_POLICY, name="daterollpolicy"),
            nullable=False,
            server_default="none",
        ),
        sa.Column("blackout_dates", sa.JSON(), nullable=True),
        sa.Column(
            "location_id",
            sa.String(36),
            sa.ForeignKey("locations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("location", sa.String(300), nullable=True),
        sa.Column(
            "requires_rsvp", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "auto_create_records",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "generated_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        *_timestamps(),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_course_cohort_org_course",
        "course_cohorts",
        ["organization_id", "course_id"],
    )

    op.create_table(
        "course_cohort_classes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "cohort_id",
            sa.String(36),
            sa.ForeignKey("course_cohorts.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # Nullable so ad-hoc classes (never on the syllabus) are representable
        # and deleting a syllabus row later cannot destroy cohort history.
        sa.Column(
            "course_class_id",
            sa.String(36),
            sa.ForeignKey("course_classes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_end", sa.DateTime(timezone=True), nullable=False),
        # SET NULL, not CASCADE: deleting an event in the events UI must not
        # erase the cohort's record of the class — it leaves a visibly unlinked
        # row the officer can regenerate.
        sa.Column(
            "event_id",
            sa.String(36),
            sa.ForeignKey("events.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column(
            "training_session_id",
            sa.String(36),
            sa.ForeignKey("training_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(*COHORT_CLASS_STATUS, name="cohortclassstatus"),
            nullable=False,
            server_default="scheduled",
            index=True,
        ),
        sa.Column(
            "class_course_id",
            sa.String(36),
            sa.ForeignKey("training_courses.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("credit_hours", sa.Float(), nullable=True),
        sa.Column(
            "instructor_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("instructor", sa.String(255), nullable=True),
        sa.Column(
            "location_id",
            sa.String(36),
            sa.ForeignKey("locations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("location", sa.String(300), nullable=True),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("training_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("training_requirements.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "phase_id",
            sa.String(36),
            sa.ForeignKey("program_phases.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("cohort_id", "sequence", name="uq_cohort_class_sequence"),
        # The idempotency key: a syllabus row can be materialized at most once
        # per cohort, so re-running generation can never duplicate a class.
        sa.UniqueConstraint(
            "cohort_id", "course_class_id", name="uq_cohort_class_source"
        ),
    )
    op.create_index(
        "idx_cohort_class_start",
        "course_cohort_classes",
        ["organization_id", "scheduled_start"],
    )

    op.create_table(
        "course_cohort_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "cohort_id",
            sa.String(36),
            sa.ForeignKey("course_cohorts.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "enrollment_id",
            sa.String(36),
            sa.ForeignKey("program_enrollments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(*COHORT_MEMBER_STATUS, name="cohortmemberstatus"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "added_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("cohort_id", "user_id", name="uq_cohort_member_user"),
    )


def downgrade() -> None:
    op.drop_table("course_cohort_members")
    op.drop_index("idx_cohort_class_start", table_name="course_cohort_classes")
    op.drop_table("course_cohort_classes")
    op.drop_index("idx_course_cohort_org_course", table_name="course_cohorts")
    op.drop_table("course_cohorts")
    op.drop_index("idx_course_class_org_course", table_name="course_classes")
    op.drop_table("course_classes")
    op.drop_column("training_courses", "program_id")
