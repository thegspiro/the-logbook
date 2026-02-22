"""Add interview and reference check tables and step types

- Add 'interview' and 'reference_check' values to the pipeline_step_type enum.
- Create prospect_interviews table for interview scheduling, notes, and questions.
- Create prospect_reference_checks table for reference verification records.

Revision ID: 20260222_0800
Revises: 20260222_0700
Create Date: 2026-02-22 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260222_0800"
down_revision: Union[str, None] = "20260222_0700"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Extend the pipeline step type enum ---
    # For MySQL/MariaDB, ALTER the column to include new values.
    # For SQLite (testing), enum values are stored as plain strings so no DDL needed.
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "mysql":
        op.execute(
            "ALTER TABLE membership_pipeline_steps "
            "MODIFY COLUMN step_type ENUM('action','checkbox','note','interview','reference_check') NOT NULL DEFAULT 'checkbox'"
        )

    # --- Create prospect_interviews table ---
    op.create_table(
        "prospect_interviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "prospect_id",
            sa.String(36),
            sa.ForeignKey("prospective_members.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "step_id",
            sa.String(36),
            sa.ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column(
            "status",
            sa.Enum("scheduled", "in_progress", "completed", "cancelled", name="interviewstatus"),
            nullable=False,
            server_default="scheduled",
        ),
        sa.Column("interviewer_ids", sa.JSON, nullable=True),
        sa.Column("questions", sa.JSON, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "completed_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "completed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("idx_interview_prospect", "prospect_interviews", ["prospect_id"])
    op.create_index("idx_interview_step", "prospect_interviews", ["step_id"])
    op.create_index("idx_interview_status", "prospect_interviews", ["status"])

    # --- Create prospect_reference_checks table ---
    op.create_table(
        "prospect_reference_checks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "prospect_id",
            sa.String(36),
            sa.ForeignKey("prospective_members.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "step_id",
            sa.String(36),
            sa.ForeignKey("membership_pipeline_steps.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reference_name", sa.String(200), nullable=False),
        sa.Column("reference_phone", sa.String(20), nullable=True),
        sa.Column("reference_email", sa.String(255), nullable=True),
        sa.Column("reference_relationship", sa.String(100), nullable=True),
        sa.Column("contact_method", sa.String(20), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "attempted", "completed", "unable_to_reach", name="referencecheckstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "contacted_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("questions", sa.JSON, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("verification_result", sa.String(20), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("idx_ref_check_prospect", "prospect_reference_checks", ["prospect_id"])
    op.create_index("idx_ref_check_step", "prospect_reference_checks", ["step_id"])
    op.create_index("idx_ref_check_status", "prospect_reference_checks", ["status"])


def downgrade() -> None:
    op.drop_table("prospect_reference_checks")
    op.drop_table("prospect_interviews")

    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "mysql":
        op.execute(
            "ALTER TABLE membership_pipeline_steps "
            "MODIFY COLUMN step_type ENUM('action','checkbox','note') NOT NULL DEFAULT 'checkbox'"
        )
