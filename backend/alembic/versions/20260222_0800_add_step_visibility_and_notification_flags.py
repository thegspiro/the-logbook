"""Add per-step notification and visibility flags, pipeline public status toggle

Adds notify_prospect_on_completion and public_visible to pipeline steps,
and public_status_enabled to pipelines.

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
    # Per-step: notify prospect when this step is completed
    op.add_column(
        "membership_pipeline_steps",
        sa.Column("notify_prospect_on_completion", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Per-step: show this step on the public application status page
    op.add_column(
        "membership_pipeline_steps",
        sa.Column("public_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # Pipeline-level: enable or disable public status page
    op.add_column(
        "membership_pipelines",
        sa.Column("public_status_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("membership_pipelines", "public_status_enabled")
    op.drop_column("membership_pipeline_steps", "public_visible")
    op.drop_column("membership_pipeline_steps", "notify_prospect_on_completion")
