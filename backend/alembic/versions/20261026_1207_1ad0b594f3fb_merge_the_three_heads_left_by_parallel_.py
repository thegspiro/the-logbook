"""merge the three heads left by parallel merges

Three revisions all descend from the 2026-10-25 fork at `b7e4c2a91d35` and
`0a8d11fcada1`, and each was written to rejoin it without knowing about the
others:

- `5510d5ff49eb` encrypts contact phone numbers and addresses, and revises
  both forked heads;
- `2382ef7e55c3` and `9ab7b4276c22` are pure merge revisions of the same two.

They landed on main within hours of each other, leaving three heads. With
more than one head, `alembic upgrade head` refuses to run, so the backend's
startup migration and the Migration Chain job both fail.

This is a pure join: every parent already did its work, so there is nothing
to run here.

Revision ID: 1ad0b594f3fb
Revises: 5510d5ff49eb, 2382ef7e55c3, 9ab7b4276c22
Create Date: 2026-10-26 12:07:29.823561

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1ad0b594f3fb"
down_revision: Union[str, None] = ("5510d5ff49eb", "2382ef7e55c3", "9ab7b4276c22")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
