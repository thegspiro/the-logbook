"""Merge the two heads left by #3612 and #3613

``6dce1364ff7e`` (#3612, NOT NULL on columns upgraded databases already have)
and ``c561cf7730ce`` (#3613, directory account name sync) were merged into
``main`` independently, each on top of a different parent, so ``main`` was
left with two heads and ``alembic upgrade head`` refused to choose.

Nothing is created here. Each ancestor revision already ran its own DDL;
Alembic runs each revision exactly once no matter how many merge paths reach
it.

Revision ID: 2538fbf21c61
Revises: 6dce1364ff7e, c561cf7730ce
Create Date: 2026-10-24 00:31:00.000000
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "2538fbf21c61"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("6dce1364ff7e", "c561cf7730ce")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
