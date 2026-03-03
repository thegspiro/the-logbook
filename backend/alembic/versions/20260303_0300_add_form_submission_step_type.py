"""Add form_submission to PipelineStepType enum and unique constraint on prospective_members

Revision ID: 20260303_0300
Revises: 20260303_0250
Create Date: 2026-03-03

Adds:
- 'form_submission' value to the pipeline_step_type enum
- Partial unique index on (organization_id, email) for active prospects
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260303_0300"
down_revision = "20260303_0250"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # MySQL: ALTER the enum column to include the new value.
    op.execute(
        "ALTER TABLE membership_pipeline_steps "
        "MODIFY COLUMN step_type "
        "ENUM('action','checkbox','note','form_submission') NOT NULL "
        "DEFAULT 'checkbox'"
    )

    # Partial unique constraint: only one active prospect per org+email.
    # MySQL doesn't support partial unique indexes, so we use a generated
    # column + unique index trick: a virtual column that is NULL for
    # non-active rows (unique indexes ignore NULLs in MySQL 8).
    op.execute(
        "ALTER TABLE prospective_members "
        "ADD COLUMN active_email VARCHAR(255) GENERATED ALWAYS AS ("
        "  CASE WHEN status = 'active' THEN email ELSE NULL END"
        ") STORED"
    )
    op.create_index(
        "uq_prospect_org_active_email",
        "prospective_members",
        ["organization_id", "active_email"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_prospect_org_active_email", table_name="prospective_members")
    op.execute("ALTER TABLE prospective_members DROP COLUMN active_email")

    # Revert enum — any rows with 'form_submission' must be changed first.
    op.execute(
        "UPDATE membership_pipeline_steps "
        "SET step_type = 'checkbox' WHERE step_type = 'form_submission'"
    )
    op.execute(
        "ALTER TABLE membership_pipeline_steps "
        "MODIFY COLUMN step_type "
        "ENUM('action','checkbox','note') NOT NULL "
        "DEFAULT 'checkbox'"
    )
