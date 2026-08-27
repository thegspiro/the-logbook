"""Track completion state for streamed finance exports.

Revision ID: f4a1c9d82e30
Revises: 472a1e34aa84
"""

import sqlalchemy as sa
from alembic import op

revision = "f4a1c9d82e30"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


_TABLE = "finance_export_logs"
_COLUMNS = ("status", "error_message", "completed_at")


def _has_table(inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded on the table as well as each column. No migration creates
    # `finance_export_logs` — it comes into being when main.py's fast-path init
    # calls create_all() and stamps Alembic at head — and CI runs
    # `alembic upgrade head` against an empty database before anything does
    # that, so an unguarded add_column here aborts the whole upgrade rather
    # than just this step (CLAUDE.md pitfall 26). Skipping is correct, not
    # merely safe: create_all builds the table from the models, which already
    # declare all three columns. The per-column guard covers the other order
    # too — an installation that started the app first has them already.
    inspector = sa.inspect(op.get_bind())
    if not _has_table(inspector, _TABLE):
        return

    if not _has_column(inspector, _TABLE, "status"):
        op.add_column(
            _TABLE,
            sa.Column(
                "status", sa.String(20), nullable=False, server_default="successful"
            ),
        )
    if not _has_column(inspector, _TABLE, "error_message"):
        op.add_column(_TABLE, sa.Column("error_message", sa.String(500), nullable=True))
    if not _has_column(inspector, _TABLE, "completed_at"):
        op.add_column(
            _TABLE, sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not _has_table(inspector, _TABLE):
        return
    for column in reversed(_COLUMNS):
        if _has_column(inspector, _TABLE, column):
            op.drop_column(_TABLE, column)
