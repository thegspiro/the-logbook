"""Rejoin the two heads #1879 and #1890 each left on main.

Revision ID: 4f54af873e99
Revises: e4f5a6b7c8d9, f4a9c2d81e70
Create Date: 2026-08-27 08:54:14.947873

Both branches were validated single-head against main *individually*, and both
set down_revision to a8f3c1d7e902 — the head at the time each was written.
Merging them one after the other is what forked the chain, so
`alembic upgrade head` fails on main with "Multiple head revisions are
present". Nothing about either migration is wrong; they simply have the same
parent.

This carries no DDL. It exists only to give the chain one head again, which is
why upgrade and downgrade are both no-ops.

The lesson is that a per-branch single-head check cannot catch this: it only
looks at one branch plus main. Two open PRs each adding a migration will always
fork the moment the second one merges, so the head has to be re-checked on main
after every merge, not only on the branch before it.
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "4f54af873e99"
down_revision: Union[str, None] = ("e4f5a6b7c8d9", "f4a9c2d81e70")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No schema change: this revision only rejoins the chain."""


def downgrade() -> None:
    """No schema change: this revision only rejoins the chain."""
