"""Merge the inline-checklist-groups and finance-timestamp-backfill heads

#3422 and #3425 merged within minutes of each other on 2026-10-19. #3422's
``d80493f28236`` revises ``2315d544d60a``; #3425's merge revision
``4e18470473d6`` joins ``2315d544d60a`` with its own backfill
``da76465bc3d2``. Neither saw the other, leaving two heads, and
``alembic upgrade head`` fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 7ce50d36b948
Revises: 4e18470473d6, d80493f28236
Create Date: 2026-10-19 11:28:14.357428
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7ce50d36b948"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("4e18470473d6", "d80493f28236")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
