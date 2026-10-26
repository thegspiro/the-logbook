"""merge phone-encryption and the two guest-check-in/forms-embed joins

Three branches each merged to `main` on 2026-10-25/26 and each rejoined the
guest-check-in-token (`b7e4c2a91d35`) and forms-allow-embed (`0a8d11fcada1`)
heads on its own, so the chain ended with three heads: `5510d5ff49eb` (encrypt
contact phone numbers), `2382ef7e55c3` and `9ab7b4276c22` (two pure joins of
the same pair). `alembic upgrade head` is ambiguous against more than one head,
so the backend's startup migration and the Migration Chain job both refuse.

This is a pure join: every parent already did its work, so there is nothing to
run here. Landing it makes the chain linear again; a branch that adds its own
migration afterwards should chain from this revision.

Revision ID: 3e8ac9cb7e0f
Revises: 5510d5ff49eb, 2382ef7e55c3, 9ab7b4276c22
Create Date: 2026-10-26 12:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "3e8ac9cb7e0f"
down_revision: Union[str, None] = ("5510d5ff49eb", "2382ef7e55c3", "9ab7b4276c22")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
