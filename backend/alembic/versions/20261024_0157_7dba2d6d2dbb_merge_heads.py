"""merge not-null-columns and directory-account-name-pending heads

Two branches extended the chain independently on 2026-10-23: `6dce1364ff7e`
(NOT NULL on the 99 columns upgraded databases already enforce) and
`c561cf7730ce` (a pending-name column for directory accounts). Neither
conflicts with the other — the files do not overlap — but the chain was left
with two heads, which makes `alembic upgrade head` ambiguous.

This is a pure join: both parents already did their work, so there is
nothing to run here.

Revision ID: 7dba2d6d2dbb
Revises: 6dce1364ff7e, c561cf7730ce
Create Date: 2026-10-24 01:57:15.556790

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7dba2d6d2dbb"
down_revision: Union[str, None] = ("6dce1364ff7e", "c561cf7730ce")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
