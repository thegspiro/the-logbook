"""null dedup hash on voided votes

``votes.vote_dedup_hash`` is UNIQUE and is the database-level backstop
against double voting. A voided (soft-deleted) vote kept its hash, so the
member whose ballot an officer voided could never vote again: eligibility
reported ``has_voted: false`` and both vote routes died on
``IntegrityError 1062`` against ``ix_votes_dedup_hash`` (W50-6).

``ElectionService.soft_delete_vote`` now clears the hash as it voids the
row; this revision settles the rows voided before that change so those
members can vote again without an officer's intervention.

Idempotent: the WHERE clause only touches voided rows that still carry a
hash, so a re-run finds nothing to do.

**This backfill is irreversible by design.** The hash is derived from the
election's voter-anonymity salt (destroyed at close), the ballot item and a
method-dependent discriminator, so nothing here can recompute it, and the
only thing restoring it would achieve is to lock a voided voter out again.
Downgrade therefore changes no rows.

Revision ID: 6394fbf42581
Revises: 601fdb28ab8c
Create Date: 2026-09-30 08:40:22.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6394fbf42581"
down_revision: Union[str, None] = "f26349cdfbfd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "votes"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded on the table and both columns: CI upgrades an empty database
    # and the column arrived in a later revision than the table.
    if not (
        _has_table(TABLE)
        and _has_column(TABLE, "vote_dedup_hash")
        and _has_column(TABLE, "deleted_at")
    ):
        return
    op.execute(
        sa.text(
            "UPDATE votes SET vote_dedup_hash = NULL "
            "WHERE deleted_at IS NOT NULL AND vote_dedup_hash IS NOT NULL"
        )
    )


def downgrade() -> None:
    """Irreversible data backfill; see the module docstring.

    The cleared hashes cannot be recomputed, and the service keeps clearing
    them on void, so the pre-revision rows cannot be reconstructed. Leaving
    the rows as they are is the correct rollback.
    """
    return
