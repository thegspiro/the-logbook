"""Make step_progress.step_id nullable and add unique email constraint

- prospect_step_progress.step_id: NOT NULL → nullable with SET NULL on delete.
  This preserves progress history when a pipeline step is deleted.
- prospective_members: Replace non-unique idx_prospect_org_email with unique
  idx_prospect_org_email_unique to enforce one prospect per email per org.

Revision ID: 20260222_0700
Revises: 20260222_0600
Create Date: 2026-02-22 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260222_0700"
down_revision: Union[str, None] = "20260222_0600"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # 1. Make step_id nullable on prospect_step_progress
    if dialect == "mysql":
        # MySQL: drop FK, alter column, re-add FK with SET NULL
        op.execute(
            "ALTER TABLE prospect_step_progress "
            "DROP FOREIGN KEY IF EXISTS prospect_step_progress_ibfk_2"
        )
        op.alter_column(
            "prospect_step_progress",
            "step_id",
            existing_type=sa.String(36),
            nullable=True,
        )
        op.create_foreign_key(
            "fk_step_progress_step_id",
            "prospect_step_progress",
            "membership_pipeline_steps",
            ["step_id"],
            ["id"],
            ondelete="SET NULL",
        )
    elif dialect == "postgresql":
        op.alter_column(
            "prospect_step_progress",
            "step_id",
            existing_type=sa.String(36),
            nullable=True,
        )
        # Update FK to SET NULL
        op.drop_constraint(
            "prospect_step_progress_step_id_fkey",
            "prospect_step_progress",
            type_="foreignkey",
        )
        op.create_foreign_key(
            "prospect_step_progress_step_id_fkey",
            "prospect_step_progress",
            "membership_pipeline_steps",
            ["step_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # 2. Drop old non-unique email index, add unique one
    try:
        op.drop_index("idx_prospect_org_email", table_name="prospective_members")
    except Exception:
        pass  # Index may not exist
    op.create_index(
        "idx_prospect_org_email_unique",
        "prospective_members",
        ["organization_id", "email"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Revert unique email index to non-unique
    op.drop_index("idx_prospect_org_email_unique", table_name="prospective_members")
    op.create_index(
        "idx_prospect_org_email",
        "prospective_members",
        ["organization_id", "email"],
    )

    # Revert step_id to NOT NULL (rows with NULL step_id would need cleanup first)
    if dialect == "mysql":
        op.execute(
            "DELETE FROM prospect_step_progress WHERE step_id IS NULL"
        )
        op.alter_column(
            "prospect_step_progress",
            "step_id",
            existing_type=sa.String(36),
            nullable=False,
        )
    elif dialect == "postgresql":
        op.execute(
            "DELETE FROM prospect_step_progress WHERE step_id IS NULL"
        )
        op.alter_column(
            "prospect_step_progress",
            "step_id",
            existing_type=sa.String(36),
            nullable=False,
        )
        op.drop_constraint(
            "prospect_step_progress_step_id_fkey",
            "prospect_step_progress",
            type_="foreignkey",
        )
        op.create_foreign_key(
            "prospect_step_progress_step_id_fkey",
            "prospect_step_progress",
            "membership_pipeline_steps",
            ["step_id"],
            ["id"],
            ondelete="CASCADE",
        )
