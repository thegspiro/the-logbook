"""Merge the shift-equip-check-index, checklist-inline-groups, and minutes-attendance-listing heads

All three (``7e5d6cf3292c``, ``e99f068be43e``, ``6dc58d6997df``) revise
``89723c04ae94`` independently, leaving three heads once all three are on
``main``. ``alembic upgrade head`` fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 2315d544d60a
Revises: 6dc58d6997df, 7e5d6cf3292c, e99f068be43e
Create Date: 2026-10-18 21:54:26.537101
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "2315d544d60a"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("6dc58d6997df", "7e5d6cf3292c", "e99f068be43e")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into three heads needs no DDL."""
