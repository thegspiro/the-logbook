"""merge forms-embed and event-guest-check-in heads

Two branches extended the chain independently on 2026-10-25: `0a8d11fcada1`
(``allow_embed`` on forms) and `b7e4c2a91d35` (``events.guest_check_in_token``).
Neither conflicts with the other — the files do not overlap — but the chain
was left with two heads, which makes `alembic upgrade head` ambiguous.

This is a pure join: both parents already did their work, so there is
nothing to run here.

Revision ID: 9ab7b4276c22
Revises: 0a8d11fcada1, b7e4c2a91d35
Create Date: 2026-10-26 03:55:50.367383

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "9ab7b4276c22"
down_revision: Union[str, None] = ("0a8d11fcada1", "b7e4c2a91d35")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
