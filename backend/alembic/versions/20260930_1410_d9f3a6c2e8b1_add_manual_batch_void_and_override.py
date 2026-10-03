"""add manual_ballot_batches void trail and over-count mark

A voided paper-ballot batch card showed no reason, voider or time, because
the batch listing had no such keys: the facts sat only on each soft-deleted
vote row and in the audit log. A pending batch recorded past the
plausibility guard carried no mark either, so the officers asked to attest
it could not see they were confirming an implausible count (W50-66).

``over_count_override`` defaults to false — a batch recorded before this
revision never overrode anything the listing can prove. ``voided_by`` /
``voided_at`` / ``void_reason`` are backfilled for already-voided batches
from their votes, which carried the same facts on every row.

Idempotent: each column is added only when absent, the backfill only
touches rows still missing a void time, and the whole step is skipped when
``manual_ballot_batches`` does not exist yet (CI upgrades an empty
database; ``create_all`` builds the columns from the model).

Revision ID: d9f3a6c2e8b1
Revises: c4e8a1f7d2b6
Create Date: 2026-09-30 14:10:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9f3a6c2e8b1"
down_revision: Union[str, None] = "c4e8a1f7d2b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "manual_ballot_batches"
FK_NAME = "fk_manual_ballot_batches_voided_by_users"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {fk["name"] for fk in inspector.get_foreign_keys(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    existing = _columns(TABLE)
    if "over_count_override" not in existing:
        op.add_column(
            TABLE,
            sa.Column(
                "over_count_override",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    if "voided_by" not in existing:
        op.add_column(TABLE, sa.Column("voided_by", sa.String(36), nullable=True))
    # Guarded separately from the column: main.py's _add_missing_model_columns
    # adds a bare column with no constraint, so a database that acquired
    # voided_by that way has the column but not the FK.
    if _has_table("users") and not _has_fk(TABLE, FK_NAME):
        op.create_foreign_key(
            FK_NAME, TABLE, "users", ["voided_by"], ["id"], ondelete="SET NULL"
        )
    if "voided_at" not in existing:
        op.add_column(
            TABLE, sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True)
        )
    if "void_reason" not in existing:
        op.add_column(TABLE, sa.Column("void_reason", sa.Text(), nullable=True))

    if not _has_table("votes"):
        return
    # A batch void soft-deleted every vote in one action with one reason,
    # so any single row of the batch carries the whole trail.
    op.execute(
        sa.text(
            "UPDATE manual_ballot_batches b "
            "JOIN ("
            "  SELECT manual_batch_id, MIN(id) AS vote_id FROM votes "
            "  WHERE is_manual = 1 AND deleted_at IS NOT NULL "
            "    AND manual_batch_id IS NOT NULL "
            "  GROUP BY manual_batch_id"
            ") first ON first.manual_batch_id = b.id "
            "JOIN votes v ON v.id = first.vote_id "
            "SET b.voided_by = v.deleted_by, b.voided_at = v.deleted_at, "
            "    b.void_reason = v.deletion_reason "
            "WHERE b.status = 'voided' AND b.voided_at IS NULL"
        )
    )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    existing = _columns(TABLE)
    if _has_fk(TABLE, FK_NAME):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    if "voided_by" in existing:
        op.drop_column(TABLE, "voided_by")
    for column in ("void_reason", "voided_at", "over_count_override"):
        if column in existing:
            op.drop_column(TABLE, column)
