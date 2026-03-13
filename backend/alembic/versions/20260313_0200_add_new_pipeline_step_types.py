"""Add new pipeline step types to PipelineStepType enum

Revision ID: 8f3a2c4d5e6b
Revises: a1b2c3d4e5f6
Create Date: 2026-03-13 02:00:00.000000

"""

from alembic import op

# revision identifiers
revision = "8f3a2c4d5e6b"
down_revision = None  # Will be set by Alembic chain
branch_labels = None
depends_on = None

# New enum values to add
NEW_VALUES = [
    "document_upload",
    "election_vote",
    "manual_approval",
    "meeting",
    "status_page_toggle",
    "automated_email",
    "reference_check",
    "checklist",
    "interview_requirement",
    "multi_approval",
    "medical_screening",
]

ALL_VALUES = [
    "action",
    "checkbox",
    "note",
    "form_submission",
] + NEW_VALUES


def upgrade() -> None:
    # MySQL: ALTER the column to include all enum values
    enum_values = ", ".join(f"'{v}'" for v in ALL_VALUES)
    op.execute(
        f"ALTER TABLE membership_pipeline_steps "
        f"MODIFY COLUMN step_type ENUM({enum_values}) NOT NULL DEFAULT 'checkbox'"
    )


def downgrade() -> None:
    # Revert to original 4 values
    original = "'action', 'checkbox', 'note', 'form_submission'"
    op.execute(
        f"ALTER TABLE membership_pipeline_steps "
        f"MODIFY COLUMN step_type ENUM({original}) NOT NULL DEFAULT 'checkbox'"
    )
