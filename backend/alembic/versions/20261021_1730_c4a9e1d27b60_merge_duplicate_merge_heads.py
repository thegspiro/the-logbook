"""Merge the two merge revisions left by a double fix

``75a6edc2ae4a`` and ``33922563bb88`` were written independently, minutes
apart on 2026-10-21, to rejoin the same pair of heads (``2794794bda6e`` and
``cbe0de50f202``). Each succeeded, and together they are two heads again, so
``alembic upgrade head`` fails until they are rejoined.

Neither is removed: either may already be stamped in a database, and deleting
a revision a database points at breaks that database's upgrade.

Nothing is created here. Both parents are themselves no-ops.

Revision ID: c4a9e1d27b60
Revises: 33922563bb88, 75a6edc2ae4a
Create Date: 2026-10-21 17:30:00.000000
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "c4a9e1d27b60"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("33922563bb88", "75a6edc2ae4a")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
