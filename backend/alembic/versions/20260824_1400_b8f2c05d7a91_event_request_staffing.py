"""Add volunteer-staffing columns to event requests.

Revision ID: b8f2c05d7a91
Revises: 31e2816df7c3

``shifts.is_outreach`` marks a shift as a community-outreach signup sheet
rather than duty coverage, so standing shift claims skip it — "every Saturday
day shift" must not seat a member on a school visit they never volunteered for,
nor spend one of that sheet's limited seats doing so. It defaults to 0, which is
what every existing shift is.

``staffing_shift_id`` links a scheduled outreach request to the shift members
sign up on, so "who is covering the fire safety demo" is answered by the same
open-shift flow that fills every other seat rather than by a list only the
request pipeline can see. ``volunteer_call_sent_at`` records when the
membership was last emailed asking for help on that request.

Both are nullable with no backfill: NULL means "no signup sheet opened" and
"no call sent", which is true of every request written before this migration.

The FK is ``ON DELETE SET NULL`` (and the column is therefore nullable, per
CLAUDE.md pitfall #2) — deleting a shift must not delete the outreach request
it was covering; it only means the sheet is gone and a new one can be opened.
"""

import sqlalchemy as sa
from alembic import op

revision = "b8f2c05d7a91"
down_revision = "31e2816df7c3"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    """Whether the table exists yet.

    Not every table in this schema is created by a migration —
    ``event_requests`` among them is only ever built by ``create_all`` at
    startup, and CI runs ``alembic upgrade head`` against an empty database
    before that ever happens. Reflecting a column on a table that is not there
    raises ``NoSuchTableError`` and takes the whole upgrade down, so the column
    steps below skip instead: a table created later by ``create_all`` is built
    from the models, which already declare these columns.
    """
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_table("event_requests") and not _has_column(
        "event_requests", "staffing_shift_id"
    ):
        op.add_column(
            "event_requests",
            sa.Column("staffing_shift_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_event_requests_staffing_shift",
            "event_requests",
            "shifts",
            ["staffing_shift_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if _has_table("shifts") and not _has_column("shifts", "is_outreach"):
        op.add_column(
            "shifts",
            sa.Column(
                "is_outreach",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    if _has_table("event_requests") and not _has_column(
        "event_requests", "volunteer_call_sent_at"
    ):
        op.add_column(
            "event_requests",
            sa.Column(
                "volunteer_call_sent_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )


def downgrade() -> None:
    if _has_column("shifts", "is_outreach"):
        op.drop_column("shifts", "is_outreach")
    if _has_column("event_requests", "volunteer_call_sent_at"):
        op.drop_column("event_requests", "volunteer_call_sent_at")
    if _has_column("event_requests", "staffing_shift_id"):
        op.drop_constraint(
            "fk_event_requests_staffing_shift", "event_requests", type_="foreignkey"
        )
        op.drop_column("event_requests", "staffing_shift_id")
