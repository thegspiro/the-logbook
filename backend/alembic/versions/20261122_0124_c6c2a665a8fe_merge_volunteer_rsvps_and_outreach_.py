"""Merge the volunteer-RSVPs head with the outreach-rename head

``c7e1a94d2f58`` ("volunteer RSVPs are crew") and ``1a5c18b46791`` ("rename
outreach positions and report") both revise ``3daf47506e9e``, so each saw a
single head in its own branch's CI run and both landed on ``main``.
``alembic upgrade head`` fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic runs
each revision exactly once no matter how many merge paths reach it.

Revision ID: c6c2a665a8fe
Revises: c7e1a94d2f58, 1a5c18b46791
Create Date: 2026-11-22 01:24:27.382655
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "c6c2a665a8fe"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("c7e1a94d2f58", "1a5c18b46791")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
