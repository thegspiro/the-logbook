"""Make notification_logs.sent_at NOT NULL and index the keyset ordering.

Cursor pagination over the notification lists orders by ``(sent_at, id)``,
which only works if both halves are always present. ``sent_at`` carried a
server default but was nullable, so a row inserted with an explicit ``NULL``
would sort last under ``ORDER BY sent_at DESC`` and be unreachable by any
cursor — silently absent from a list that claims to be complete. No writer
passes ``sent_at`` today; this closes the hole rather than leaving the
pagination resting on that staying true.

The backfill takes ``created_at`` where it exists, since the two are written
together by every insert path, and ``UTC_TIMESTAMP()`` otherwise so the column
can be made NOT NULL even for a row that somehow has neither.

``idx_notif_logs_recipient_sent`` covers the query the Send Log now issues on
every request: organization + recipient, ordered by the keyset pair. The
existing ``idx_notif_logs_org_sent`` still serves the organization-wide scope.

Reversible: the downgrade drops the index and restores nullability. It does not
put the NULLs back — they were unreachable rows, and there is nothing to
identify which had been NULL.

Sequenced after ``d5f2b8c04a19`` only to keep the chain linear. This has been
re-parented three times as permission-repair migrations landed on main ahead of
it (``c7a4e91d3b68``, ``b6e4a0d17c93``, then ``d5f2b8c04a19``); nothing here
depends on any of them — they rewrite seeded ``positions`` rows, this one alters
``notification_logs`` — so the order between them is arbitrary and only the
single head matters.
"""

import sqlalchemy as sa
from alembic import op

revision = "c8f4a1e6b309"
down_revision = "d5f2b8c04a19"
branch_labels = None
depends_on = None

_INDEX = "idx_notif_logs_recipient_sent"
_TABLE = "notification_logs"


def _index_exists(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {ix["name"] for ix in inspector.get_indexes(_TABLE)}


def upgrade() -> None:
    op.execute(
        sa.text(
            f"UPDATE {_TABLE} "
            "SET sent_at = COALESCE(created_at, UTC_TIMESTAMP()) "
            "WHERE sent_at IS NULL"
        )
    )
    op.alter_column(
        _TABLE,
        "sent_at",
        existing_type=sa.DateTime(),
        nullable=False,
        existing_server_default=sa.text("CURRENT_TIMESTAMP"),
    )
    if not _index_exists(_INDEX):
        op.create_index(
            _INDEX,
            _TABLE,
            ["organization_id", "recipient_id", "sent_at", "id"],
        )


def downgrade() -> None:
    if _index_exists(_INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    op.alter_column(
        _TABLE,
        "sent_at",
        existing_type=sa.DateTime(),
        nullable=True,
        existing_server_default=sa.text("CURRENT_TIMESTAMP"),
    )
