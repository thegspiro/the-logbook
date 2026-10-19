"""Merge the QuickBooks chart-of-accounts head with main's head

``a33ffa561e4f`` (this branch's migration) revises a revision that ``main`` has since
built on, and ``2315d544d60a`` is ``main``'s head. ``alembic upgrade head``
fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 01cdde60c919
Revises: 2315d544d60a, a33ffa561e4f
Create Date: 2026-10-19 00:57:43.498925
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "01cdde60c919"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("2315d544d60a", "a33ffa561e4f")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
