"""Rejoin the two 20260816_0005 children into a single head

Two branches landed on main the same day, each adding a revision whose parent
is `20260816_0005`: the legacy shift-finalization backfill (`_0006`) and the
notification-preference unification (`_0007`). Neither is wrong and neither
depends on the other — they simply forked, which is what a fork looks like when
two green branches merge cleanly and their migration chains do not.

A fork is not cosmetic: `alembic upgrade head` has no single target, so it
fails outright rather than choosing, and a fresh install cannot migrate at all.
This is a merge revision — no schema work of its own, it only names both
parents so the chain has one head again.

Merge rather than renumbering one onto the other: both revisions have already
run wherever main has been deployed, and rewriting a `down_revision` under a
database that has recorded the old one strands it at a revision its chain no
longer contains — the same "stamped at a revision that no longer exists"
failure recorded in the screenshot currency log.

Revision ID: 20260816_0008
Revises: 20260816_0006, 20260816_0007
Create Date: 2026-08-17
"""

# revision identifiers, used by Alembic.
revision = "20260816_0008"
down_revision = ("20260816_0006", "20260816_0007")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists to rejoin two branches of the chain."""


def downgrade() -> None:
    """No-op: splitting the chain back into two heads is not a repair."""
