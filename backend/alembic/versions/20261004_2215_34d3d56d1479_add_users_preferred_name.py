"""Add ``users.preferred_name`` — the name a member goes by.

A member may be known by a name other than their legal first name (John Terry
Heather goes by "Terry"). Everyday screens show the preferred name in place of
the first name; reports, training records, certificates, ballots and legal
documents keep reading ``first_name``. NULL means the member goes by their
first name, so every existing row keeps rendering exactly as before and no
backfill is needed.

Idempotent: the column is added only when absent, so an installation whose
``repair_schema`` already added it from the model is left alone.

**Downgrade** drops the column, discarding any preferred names entered since.

Revision ID: 34d3d56d1479
Revises: edf608b5a8ea
Create Date: 2026-10-04 22:15:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "34d3d56d1479"
down_revision = "edf608b5a8ea"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("users", "preferred_name"):
        op.add_column(
            "users",
            sa.Column("preferred_name", sa.String(length=100), nullable=True),
        )


def downgrade() -> None:
    if _has_column("users", "preferred_name"):
        op.drop_column("users", "preferred_name")
