"""join the three merges of the admin hours fork

#2748 (``8c47e8945f69``) and #2749 (``f03c9f236904``) both sat on
``b795d1b3401b`` and left two heads. Three branches then joined that fork, each
on its own, and all three merged within forty seconds:

* #2663 re-parented ``81537606ee07`` (inventory label prints) onto both.
* #2751 added the merge revision ``c6863c42928f``.
* #2752 added the merge revision ``c4a1e7d2b9f3``.

Each join is valid alone; together they are three heads, and
``alembic upgrade head`` refuses to run. This joins them. Nothing is created
here: every revision below already runs on its own path, and Alembic applies a
revision once however many paths reach it.

Revision ID: 4acf7f8212a2
Revises: 81537606ee07, c6863c42928f, c4a1e7d2b9f3
Create Date: 2026-09-27 15:43:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "4acf7f8212a2"
# One line, unannotated: tests/test_alembic_migrations.py reads the parents with
# a single-line pattern, and the annotated form of a three-parent tuple wraps.
down_revision = ("81537606ee07", "c6863c42928f", "c4a1e7d2b9f3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into three heads needs no DDL."""
