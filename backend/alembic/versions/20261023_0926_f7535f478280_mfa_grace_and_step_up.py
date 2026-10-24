"""MFA grace period for privileged members, and step-up on a session

``users.mfa_grace_started_at`` is when the server first saw a member who holds
a privileged permission without MFA enrolled; the grace period before the
enrollment gate closes is measured from it. ``sessions.stepup_verified_at`` is
when that session last re-verified its owner (``POST /auth/step-up``), which
unlocks exports, security changes and similar actions for a short window.

Both nullable and additive: NULL grace means "not started" and NULL step-up
means "never verified", so every existing row reads as it should. The
downgrade drops both columns; a grace clock in progress restarts if the
migration is re-applied.

Revision ID: f7535f478280
Revises: cc8c16cb6d98
Create Date: 2026-10-23 09:26:41.318902

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7535f478280"
down_revision: Union[str, None] = "cc8c16cb6d98"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("users", "mfa_grace_started_at"),
    ("sessions", "stepup_verified_at"),
)


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # A table only create_all builds is built from the models, which already
    # declare these columns, so an absent table is skipped rather than an error.
    for table, column in _COLUMNS:
        cols = _columns(table)
        if cols and column not in cols:
            op.add_column(
                table, sa.Column(column, sa.DateTime(timezone=True), nullable=True)
            )


def downgrade() -> None:
    for table, column in _COLUMNS:
        if column in _columns(table):
            op.drop_column(table, column)
