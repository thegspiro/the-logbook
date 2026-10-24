"""Merge the two heads ``main`` gained on 2026-10-23

``6dce1364ff7e`` (NOT NULL on columns of upgraded databases) and
``c561cf7730ce`` (pending directory account names) both descend from earlier
revisions and landed without seeing each other, leaving two heads, which
breaks ``alembic upgrade head`` and ``test_exactly_one_head``.

Nothing is created here. Each ancestor revision already ran its own DDL;
Alembic runs each revision exactly once no matter how many merge paths reach
it.

Revision ID: 9b2815e26b6d
Revises: 6dce1364ff7e, c561cf7730ce
Create Date: 2026-10-24 01:45:22.251828
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "9b2815e26b6d"
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
