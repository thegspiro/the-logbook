"""merge facility folder permissions and testing runs heads

Two branches extended the chain independently on 2026-08-27:
`a9c4e7b2f631` (gate facility document folders on permissions) and
`c4d8e2f7a913` (testing runs). Neither conflicts with the other — the files
do not overlap — but the chain was left with two heads, which makes
`alembic upgrade head` ambiguous.

This is a pure join: both parents already did their work, so there is
nothing to run here.

Revision ID: 5128feb36dd2
Revises: a9c4e7b2f631, c4d8e2f7a913
Create Date: 2026-08-27 23:49:04.041663

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "5128feb36dd2"
down_revision: Union[str, None] = ("a9c4e7b2f631", "c4d8e2f7a913")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
