"""add score_pass_fail_criteria to skill_templates

A skill test's overall percentage is computed from score-type criteria only.
Pass/fail steps — which is how departments tend to write knowledge questions —
contributed nothing at all, so a candidate could miss half the questions on a
sheet without the percentage moving. Whether they should count is a department
decision rather than a global rule (an NREMT-style sheet wants every line worth
a point; a checklist-plus-critical-criteria sheet does not), so it is a
per-template setting.

Existing rows default to FALSE, which preserves the current arithmetic exactly:
every percentage already on record keeps the meaning it had when it was scored.
Tests also freeze the flag into their template snapshot at creation, so turning
it on later never re-scores a result taken under the old rule.

Revision ID: 20260809_0001
Revises: 20260808_0003
Create Date: 2026-08-09 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260809_0001"
down_revision = "20260808_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_templates",
        sa.Column(
            "score_pass_fail_criteria",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment=(
                "True when pass/fail steps carry points toward the overall "
                "percentage. False (the default) scores only score-type "
                "criteria, which is how every result predating this column "
                "was calculated."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("skill_templates", "score_pass_fail_criteria")
