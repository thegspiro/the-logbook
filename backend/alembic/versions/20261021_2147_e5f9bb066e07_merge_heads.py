"""Merge the duplicate merge-head revisions left by #3531

#3518/#3522's two heads (``2794794bda6e``, ``cbe0de50f202``) were each merged
independently by two different PRs within the same minute on 2026-10-21:
``33922563bb88`` (PR #3531) and ``75a6edc2ae4a`` (PR #3529). Both are no-op
merges of the identical pair of heads, and neither saw the other land, so
``main`` forked again immediately after the first fork was fixed.

Nothing is created here. Each ancestor revision already ran its own DDL;
Alembic runs each revision exactly once no matter how many merge paths reach
it.

Revision ID: e5f9bb066e07
Revises: 33922563bb88, 75a6edc2ae4a
Create Date: 2026-10-21 21:47:04.298489
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "e5f9bb066e07"
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
