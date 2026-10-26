"""merge guest-check-in-token and forms-allow-embed heads

Two branches extended the chain independently on 2026-10-25, both from
`3f2593e8071e`: `b7e4c2a91d35` (a guest check-in token for public events) and
`0a8d11fcada1` (`allow_embed` on forms). Neither conflicts with the other —
they touch different tables — but the chain was left with two heads, which
makes `alembic upgrade head` ambiguous and fails the Migration Chain job on
every pull request.

This is a pure join: both parents already did their work, so there is
nothing to run here.

Revision ID: 2382ef7e55c3
Revises: b7e4c2a91d35, 0a8d11fcada1
Create Date: 2026-10-26 03:03:15.513022

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "2382ef7e55c3"
down_revision: Union[str, None] = ("b7e4c2a91d35", "0a8d11fcada1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
