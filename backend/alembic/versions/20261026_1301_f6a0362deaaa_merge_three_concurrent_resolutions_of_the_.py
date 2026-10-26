"""merge three concurrent resolutions of the same fork

Three sessions independently rejoined the same two heads
(`0a8d11fcada1`, `b7e4c2a91d35`) within a few hours of each other and each
opened its own merge revision for the pair: `5510d5ff49eb` (riding along
with the contact-encryption migration, `afff97c41`), `2382ef7e55c3`
(`3fa79a736`, porting the join from #3736), and `9ab7b4276c22`
(the direct sibling). All three merged clean on GitHub because the chain's
own merge check runs per-PR against whatever was on `main` at open time, not
against the other two PRs doing the same thing concurrently — so the single
fork became three heads instead of one.

This is a pure join of those three merge points: all of them already did
their work (none of the three carries any schema change of its own), so
there is nothing to run here, same as each of the revisions it joins.

Revision ID: f6a0362deaaa
Revises: 5510d5ff49eb, 2382ef7e55c3, 9ab7b4276c22
Create Date: 2026-10-26 13:01:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "f6a0362deaaa"
down_revision: Union[str, None] = ("5510d5ff49eb", "2382ef7e55c3", "9ab7b4276c22")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
