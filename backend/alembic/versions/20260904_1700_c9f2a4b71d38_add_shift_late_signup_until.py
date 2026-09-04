"""Add shifts.late_signup_until for leadership-opened late signup

Revision ID: c9f2a4b71d38
Revises: bbdaca0844df
Create Date: 2026-09-04

Signup now closes when a shift starts. This column is the per-shift escape
hatch: an absolute UTC instant, set by an officer on the night, until which the
shift keeps accepting additions regardless of the department's grace window.
NULL on every existing row, which resolves to that grace window — so no
backfill is needed and no department's shifts change meaning on upgrade.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c9f2a4b71d38"
down_revision = "bbdaca0844df"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("shifts")}
    if "late_signup_until" not in cols:
        op.add_column(
            "shifts", sa.Column("late_signup_until", sa.DateTime(), nullable=True)
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("shifts")}
    if "late_signup_until" in cols:
        op.drop_column("shifts", "late_signup_until")
