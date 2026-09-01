"""Add department_message_recipients.revoked_at and created_at

Inbox visibility is authorized on the recipient row alone — ``get_inbox``,
``get_unread_count`` and ``_visible_message_or_none`` all join to it and ask
nothing else. Reconciling a published message's audience deletes the rows of
members who fell out of it, but deliberately keeps any row carrying a
``read_at``/``acknowledged_at`` receipt, because that receipt is the only
record that the member read (and possibly formally acknowledged) the notice.

The two rules collided: a member removed from an audience kept full access to
the message, because the row kept for evidence was also the row that granted
access. ``revoked_at`` splits the two — the receipt stays, the access does not.

``created_at`` comes along because the table had none: it records when a
member entered the audience, which is not the message's own creation time once
an audience is widened after publication.

Guarded on the table existing: fresh installs come up through ``create_all`` +
stamp-head rather than this chain (CLAUDE.md pitfall #26), so a database can
reach this revision without the table having been built by a migration.
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c9d4e6f813"
down_revision = "f7a1c3b5d9e2"
branch_labels = None
depends_on = None

_TABLE = "department_message_recipients"
_COLUMNS = ("revoked_at", "created_at")


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table(_TABLE):
        return
    for column in _COLUMNS:
        if not _has_column(_TABLE, column):
            op.add_column(
                _TABLE,
                sa.Column(
                    column,
                    sa.DateTime(timezone=True),
                    nullable=True,
                    server_default=sa.func.now() if column == "created_at" else None,
                ),
            )


def downgrade() -> None:
    for column in _COLUMNS:
        if _has_column(_TABLE, column):
            op.drop_column(_TABLE, column)
