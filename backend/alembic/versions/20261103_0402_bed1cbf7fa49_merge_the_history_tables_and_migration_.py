"""merge the history-tables and migration-fork-fix heads

Two branches landed on main within minutes of each other on 2026-11-03:
`038ade7a5cd0` (the new History module's tables: past members, Honor
Roll, titles and clearance), built on `02c94bb742d6`, and `cbb9726e8af7`
(itself a merge revision rejoining the leave-month-rule and outside-shift-
evaluations-relink heads, PR #3965). Neither touches the other's tables,
but the chain was left with two heads again, which makes
`alembic upgrade head` ambiguous.

This is a pure join: both parents already did their work, so there is
nothing to run here.

Revision ID: bed1cbf7fa49
Revises: 038ade7a5cd0, cbb9726e8af7
Create Date: 2026-11-03 04:02:31.946970

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "bed1cbf7fa49"
down_revision: Union[str, None] = ("038ade7a5cd0", "cbb9726e8af7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
