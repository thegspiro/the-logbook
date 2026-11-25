"""Outreach goals: a department's yearly targets for CRR counts and outreach figures.

Outreach rework, phase 4 (owner decisions, 2026-11-24). One new table;
nothing existing is altered. A goal targets either a CRR count
(``measure_id``) or one of Outreach Impact's headline figures
(``outreach_metric``), never both, for one calendar year.

Created only if absent, so a database whose table was already built from the
models by ``create_all`` upgrades cleanly (pitfall #26). The downgrade drops
the table and every goal in it.

Revision ID: 1735810be510
Revises: 66f64aabdda2
Create Date: 2026-11-24 01:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "1735810be510"
down_revision: Union[str, Sequence[str], None] = "66f64aabdda2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "outreach_goals"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column(
            "measure_id",
            sa.String(36),
            sa.ForeignKey("crr_activity_measures.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("outreach_metric", sa.String(30), nullable=True),
        sa.Column("target", sa.Integer(), nullable=False),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "(measure_id IS NULL) <> (outreach_metric IS NULL)",
            name="ck_outreach_goals_one_target",
        ),
        sa.CheckConstraint("target > 0", name="ck_outreach_goals_target"),
        sa.UniqueConstraint(
            "organization_id", "year", "measure_id", name="uq_outreach_goals_measure"
        ),
        sa.UniqueConstraint(
            "organization_id",
            "year",
            "outreach_metric",
            name="uq_outreach_goals_metric",
        ),
    )
    op.create_index("ix_outreach_goals_measure", TABLE, ["measure_id"])


def downgrade() -> None:
    if _has_table(TABLE):
        op.drop_table(TABLE)
