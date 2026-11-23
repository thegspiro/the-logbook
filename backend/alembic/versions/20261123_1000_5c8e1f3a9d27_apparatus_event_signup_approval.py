"""Let a coordinator approve self sign-ups for apparatus nights

Revision ID: 5c8e1f3a9d27
Revises: b6e3d1f47a29
Create Date: 2026-11-23 10:00:00.000000

Adds ``require_signup_approval`` to ``apparatus_event_templates`` and
``event_apparatus_plans``, and creates ``apparatus_event_seat_requests``.

Existing rows: each new column is ``NOT NULL`` with a server default of
``0``, so every template and night already stored reads "approval off" and
keeps taking seats at once, exactly as before. No row is rewritten, and no
constraint is added to an existing column. The downgrade drops only what this
revision created.

Each step checks first, so a database whose tables were built by
``create_all`` from the current models (which already declare all of this)
upgrades without error, and so does a second run.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "5c8e1f3a9d27"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMN = "require_signup_approval"
_FLAGGED = ("apparatus_event_templates", "event_apparatus_plans")
_TABLE = "apparatus_event_seat_requests"


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    tables = _tables()
    for table in _FLAGGED:
        # Built only by create_all on some installs (pitfall #26); a table
        # created later comes from the models, which already carry the column.
        if table not in tables or _COLUMN in _columns(table):
            continue
        op.add_column(
            table,
            sa.Column(_COLUMN, sa.Boolean(), nullable=False, server_default="0"),
        )

    if _TABLE in tables:
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "seat_id",
            sa.String(36),
            sa.ForeignKey("event_apparatus_seats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("pending_user_id", sa.String(36), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "decided_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.String(300), nullable=True),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        "ux_apparatus_event_seat_requests_pending",
        _TABLE,
        ["event_id", "pending_user_id"],
        unique=True,
    )
    op.create_index(
        "ix_apparatus_event_seat_requests_seat", _TABLE, ["seat_id", "status"]
    )
    op.create_index(
        "ix_apparatus_event_seat_requests_org_status",
        _TABLE,
        ["organization_id", "status"],
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
    tables = _tables()
    for table in _FLAGGED:
        if table in tables and _COLUMN in _columns(table):
            op.drop_column(table, _COLUMN)
