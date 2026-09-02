"""Add department_message_recipients.created_at

The row records that a member was placed in a message's audience, and until
now nothing recorded *when*. Its three existing stamps are all state changes
against a row already there — ``read_at``, ``acknowledged_at``, ``revoked_at``
— so an audience reconciliation that adds a member leaves no trace of the
addition, and a receipt cannot be read against the send it belongs to.

That matters here because the audience is mutable after publication: rows are
added when a targeting rule widens and revoked when it narrows. Without a
creation stamp, "was this member in the audience when the notice went out, or
added afterwards?" is unanswerable from the table that is supposed to be the
evidence.

Backfilled from the parent message's ``created_at`` rather than left NULL:
every existing row was written by the send or by a reconciliation of it, so
the message's own timestamp is the closest true value and is never later than
the row it explains. Rows whose parent is missing a timestamp fall back to
``NOW()``.

Guarded on the table existing: fresh installs come up through ``create_all``
+ stamp-head rather than this chain (CLAUDE.md pitfall #26), so a database can
reach this revision without the table having been built by a migration.
"""

import sqlalchemy as sa
from alembic import op

revision = "e93b6a4d21c7"
down_revision = "a1d7f3c05e64"
branch_labels = None
depends_on = None

_TABLE = "department_message_recipients"
_COLUMN = "created_at"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table(_TABLE) or _has_column(_TABLE, _COLUMN):
        return

    # Added WITHOUT the server default the model declares, deliberately. MySQL
    # and MariaDB apply a DEFAULT CURRENT_TIMESTAMP to the rows already in the
    # table at ALTER time, so every existing row would be stamped with the
    # moment of the deploy and the backfill below — which keys off NULL —
    # would match nothing and silently do nothing. The default is attached
    # after the backfill, once the existing rows carry their true values.
    op.add_column(
        _TABLE,
        sa.Column(_COLUMN, sa.DateTime(timezone=True), nullable=True),
    )

    if _has_table("department_messages"):
        op.execute(
            sa.text(
                "UPDATE department_message_recipients r "
                "JOIN department_messages m ON m.id = r.message_id "
                "SET r.created_at = COALESCE(m.created_at, NOW()) "
                "WHERE r.created_at IS NULL"
            )
        )
    op.execute(
        sa.text(
            "UPDATE department_message_recipients "
            "SET created_at = NOW() WHERE created_at IS NULL"
        )
    )

    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=True,
        server_default=sa.func.now(),
    )


def downgrade() -> None:
    if _has_column(_TABLE, _COLUMN):
        op.drop_column(_TABLE, _COLUMN)
