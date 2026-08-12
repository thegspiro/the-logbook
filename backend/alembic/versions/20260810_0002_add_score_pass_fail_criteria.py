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

Revision ID: 20260810_0002
Revises: 20260810_0001, 20260809_0002
Create Date: 2026-08-09 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260810_0002"
# 20260809_0002 was briefly released with this schema change before the
# migration was renumbered.  Keep both histories in the graph so databases
# stamped with that immutable, released revision can upgrade normally.
down_revision = ("20260810_0001", "20260809_0002")
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # skill_templates is a model-only table on some deployments — create_all()
    # materializes it with this column already present, so a fresh chain run has
    # nothing to alter and must not assume the table is there. Same guard as
    # 20260807_0009 and every skills-testing migration from 20260227_0300 on.
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_templates"):
        return
    if "score_pass_fail_criteria" in _columns(inspector, "skill_templates"):
        return

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
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_templates"):
        return
    if "score_pass_fail_criteria" not in _columns(inspector, "skill_templates"):
        return

    op.drop_column("skill_templates", "score_pass_fail_criteria")
