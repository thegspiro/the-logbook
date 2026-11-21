"""Leave requests: an approver's own request goes to the Chief; approver cover

Revision ID: a9763f96e072
Revises: 3daf47506e9e
Create Date: 2026-11-21 12:00:00.000000

- ``leave_requests.routed_to_chief``: set on a request made by a member who
  held an approver position, which then skips those positions and goes to the
  Chief. ``NOT NULL`` with a ``0`` server default, so every request already
  stored keeps today's rule (owner decision 2026-11-21: new requests only).
- ``leave_request_votes.seat_id`` and ``on_behalf_of``: the approver a vote
  counts for, and the approver a stand-in voted in place of. ``seat_id`` is
  added nullable, every existing vote is backfilled with its own voter (each
  was cast by an approver for themselves), and only then made ``NOT NULL``.
  The one-vote-per-approver-per-round constraint moves from the voter to the
  seat; the existing rows already satisfy it, because the backfilled seat is
  the voter the old constraint was unique on.
- ``leave_approver_covers``: an approver's away period and their stand-in.

Downgrade deletes every vote a stand-in cast for someone else before
restoring the per-voter constraint, which such votes could break (a stand-in
who voted for themselves and for the approver they covered holds two votes in
one round). Those votes cannot be kept in the old shape; this is stated here
because the deletion cannot be undone by upgrading again.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9763f96e072"
down_revision: Union[str, None] = "3daf47506e9e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUESTS = "leave_requests"
VOTES = "leave_request_votes"
COVERS = "leave_approver_covers"
OLD_UNIQUE = "uq_leave_request_vote_round"
NEW_UNIQUE = "uq_leave_request_vote_seat_round"
ON_BEHALF_FK = "fk_leave_request_votes_on_behalf_of"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _unique_names(table: str) -> set:
    return {u["name"] for u in _inspector().get_unique_constraints(table)}


def upgrade() -> None:
    # Each table may have been built by create_all from the current models
    # (CLAUDE.md pitfall #26), already carrying these columns; every step
    # checks before it acts.
    if _has_table(REQUESTS) and not _has_column(REQUESTS, "routed_to_chief"):
        op.add_column(
            REQUESTS,
            sa.Column(
                "routed_to_chief",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )

    if _has_table(VOTES):
        if not _has_column(VOTES, "seat_id"):
            op.add_column(VOTES, sa.Column("seat_id", sa.String(36), nullable=True))
        op.execute(
            sa.text(f"UPDATE {VOTES} SET seat_id = voter_id WHERE seat_id IS NULL")
        )
        op.alter_column(VOTES, "seat_id", existing_type=sa.String(36), nullable=False)
        if not _has_column(VOTES, "on_behalf_of"):
            op.add_column(
                VOTES, sa.Column("on_behalf_of", sa.String(36), nullable=True)
            )
            op.create_foreign_key(
                ON_BEHALF_FK,
                VOTES,
                "users",
                ["on_behalf_of"],
                ["id"],
                ondelete="SET NULL",
            )
        names = _unique_names(VOTES)
        if NEW_UNIQUE not in names:
            op.create_unique_constraint(
                NEW_UNIQUE, VOTES, ["request_id", "seat_id", "round"]
            )
        if OLD_UNIQUE in names:
            op.drop_constraint(OLD_UNIQUE, VOTES, type_="unique")

    if not _has_table(COVERS):
        op.create_table(
            COVERS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "approver_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "stand_in_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_leave_approver_covers_org_approver",
            COVERS,
            ["organization_id", "approver_id"],
        )
        op.create_index(
            "ix_leave_approver_covers_org_end",
            COVERS,
            ["organization_id", "end_date"],
        )


def downgrade() -> None:
    if _has_table(COVERS):
        op.drop_table(COVERS)

    if _has_table(VOTES) and _has_column(VOTES, "seat_id"):
        op.execute(sa.text(f"DELETE FROM {VOTES} WHERE seat_id <> voter_id"))
        names = _unique_names(VOTES)
        if OLD_UNIQUE not in names:
            op.create_unique_constraint(
                OLD_UNIQUE, VOTES, ["request_id", "voter_id", "round"]
            )
        if NEW_UNIQUE in names:
            op.drop_constraint(NEW_UNIQUE, VOTES, type_="unique")
        if _has_column(VOTES, "on_behalf_of"):
            # Looked up rather than assumed: a table create_all built names its
            # foreign keys itself.
            for fk in _inspector().get_foreign_keys(VOTES):
                if fk["constrained_columns"] == ["on_behalf_of"] and fk.get("name"):
                    op.drop_constraint(fk["name"], VOTES, type_="foreignkey")
            op.drop_column(VOTES, "on_behalf_of")
        op.drop_column(VOTES, "seat_id")

    if _has_table(REQUESTS) and _has_column(REQUESTS, "routed_to_chief"):
        op.drop_column(REQUESTS, "routed_to_chief")
