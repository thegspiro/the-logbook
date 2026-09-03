"""Add created_by and source to meeting_action_items.

An action item created through the Claude MCP connection is attributed to
the administrator who issued the service key and marked ``source = "mcp"``,
so it is distinguishable from one a person entered in the app. Both columns
are NULL for every existing row, which is what "entered by a person" means
here; nothing is backfilled.

**Reversible.** The downgrade drops both columns. The provenance is lost,
nothing else references it.

Revision ID: 7bfe85f2e4e5
Revises: c4d5e6f7a8b9
Create Date: 2026-09-03 11:30:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7bfe85f2e4e5"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None

_TABLE = "meeting_action_items"
_FK = "fk_meeting_action_items_created_by_users"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def _foreign_keys_on(table: str, column: str) -> list[str]:
    """Names of the foreign keys constraining ``column`` alone.

    An installation built by ``create_all`` carries the model's constraint
    under a name the database generated, not ``_FK``; the downgrade drops
    whatever is there rather than the name this file chose.
    """
    inspector = sa.inspect(op.get_bind())
    return [
        fk["name"]
        for fk in inspector.get_foreign_keys(table)
        if fk.get("name") and fk.get("constrained_columns") == [column]
    ]


def upgrade() -> None:
    # The table is renamed into existence by 20260312_0200, so it is
    # present on every upgrade path; the column guards keep the step
    # idempotent on an installation that already ran ``create_all``.
    if not _has_table(_TABLE):
        return
    if not _has_column(_TABLE, "created_by"):
        op.add_column(
            _TABLE, sa.Column("created_by", sa.String(length=36), nullable=True)
        )
        op.create_foreign_key(
            _FK, _TABLE, "users", ["created_by"], ["id"], ondelete="SET NULL"
        )
    if not _has_column(_TABLE, "source"):
        op.add_column(_TABLE, sa.Column("source", sa.String(length=32), nullable=True))


def downgrade() -> None:
    if not _has_table(_TABLE):
        return
    if _has_column(_TABLE, "source"):
        op.drop_column(_TABLE, "source")
    if _has_column(_TABLE, "created_by"):
        for name in _foreign_keys_on(_TABLE, "created_by"):
            op.drop_constraint(name, _TABLE, type_="foreignkey")
        op.drop_column(_TABLE, "created_by")
