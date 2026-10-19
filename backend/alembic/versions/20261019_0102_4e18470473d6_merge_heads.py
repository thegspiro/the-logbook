"""Merge the finance-timestamp-backfill head with main's head

``da76465bc3d2`` (this branch's migration) revises a revision that ``main`` has since
built on, and ``d80493f28236`` is ``main``'s head. ``alembic upgrade head``
fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 4e18470473d6
Revises: d80493f28236, da76465bc3d2
Create Date: 2026-10-19 01:02:37.066522
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "4e18470473d6"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("d80493f28236", "da76465bc3d2")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
