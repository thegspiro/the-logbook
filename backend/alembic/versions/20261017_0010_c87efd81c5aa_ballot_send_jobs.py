"""ballot send jobs: one row per background ballot-email send

Sending ballots to a whole department ran inside the HTTP request and outlived
the browser's 30-second timeout at around forty members, so the secretary saw
an error for a send that was still going out. The send now runs after the
response, and this table records each one so the page can poll its outcome
and so a second send cannot start while one is still running.

The table is new and additive; no existing row is touched. ``elections`` is
created by the initial schema migration, but the step is still guarded on the
parent tables existing so a partially built database does not fail the whole
upgrade.

The downgrade drops the table. That loses only the history of past sends'
outcomes; the election's own ``email_sent`` / ``email_recipients`` record of
who received a ballot is unaffected.

Revision ID: c87efd81c5aa
Revises: 64bf75298e89
Create Date: 2026-10-17 00:10:47.413227

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c87efd81c5aa"
down_revision: Union[str, None] = "64bf75298e89"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "ballot_send_jobs"
_STATUS_INDEX = "ix_ballot_send_jobs_election_status"
_ORG_INDEX = "ix_ballot_send_jobs_organization_id"
_PARENTS = ("organizations", "elections", "users")


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if not all(parent in tables for parent in _PARENTS):
        return
    if _TABLE in tables:
        return

    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("election_id", sa.String(length=36), nullable=False),
        sa.Column("requested_by", sa.String(length=36), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("success", sa.Boolean(), nullable=True),
        sa.Column(
            "recipients_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "failed_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "skipped_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("skipped_details", sa.JSON(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["election_id"], ["elections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(_ORG_INDEX, _TABLE, ["organization_id"])
    op.create_index(_STATUS_INDEX, _TABLE, ["election_id", "status"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
