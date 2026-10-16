"""calendar sync mappings: one row per event published to an external calendar

The calendar_sync scheduled task (behind CALENDAR_SYNC_ENABLED) pushes
department events one way into a Google or Outlook calendar. Each row records
which external event a Logbook event became, the digest of what was last sent,
and the retry state of a failed push or delete.

``event_id`` deliberately has no foreign key: a row must outlive its event so
the next pass can delete the external copy. The organization and integration
foreign keys cascade, so disconnecting (deleting) an integration or an
organization removes its rows.

``integrations`` is built by ``create_all`` rather than by any migration, so
the table is not created on a database where ``integrations`` does not exist
yet: the model declares it, and ``create_all`` builds both together.

The downgrade drops the table. That forgets which external events were
published, so a later re-upgrade re-publishes into the same calendar; Google's
deterministic event ids and Graph's transactionId keep that from creating
duplicates for events the providers still hold.

Revision ID: c869ec90a41b
Revises: f236c56b1b49
Create Date: 2026-10-16 15:25:24.128209

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c869ec90a41b"
down_revision: Union[str, None] = "f236c56b1b49"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INTEGRATIONS = "integrations"
_TABLE = "calendar_sync_mappings"
_UNIQUE = "uq_calendar_sync_mappings_integration_event"
_RETRY_INDEX = "ix_calendar_sync_mappings_status_next_attempt"
_ORG_INDEX = "ix_calendar_sync_mappings_organization_id"


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if _INTEGRATIONS not in tables:
        return

    if _TABLE not in tables:
        op.create_table(
            _TABLE,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("integration_id", sa.String(length=36), nullable=False),
            sa.Column("event_id", sa.String(length=36), nullable=False),
            sa.Column("external_event_id", sa.String(length=512), nullable=True),
            sa.Column("external_calendar_id", sa.String(length=512), nullable=True),
            sa.Column("content_hash", sa.String(length=64), nullable=True),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column(
                "attempt_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["integration_id"], ["integrations.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("integration_id", "event_id", name=_UNIQUE),
        )

    indexes = {ix["name"] for ix in sa.inspect(op.get_bind()).get_indexes(_TABLE)}
    if _RETRY_INDEX not in indexes:
        op.create_index(_RETRY_INDEX, _TABLE, ["status", "next_attempt_at"])
    if _ORG_INDEX not in indexes:
        op.create_index(_ORG_INDEX, _TABLE, ["organization_id"])


def downgrade() -> None:
    op.execute(sa.text(f"DROP TABLE IF EXISTS {_TABLE}"))
