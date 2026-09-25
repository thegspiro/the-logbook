"""merge the duplicate three-way merges

#2722 (``d93f53426d5f``) and #2724 (``8eeb495f35bd``) were opened within
minutes of each other to join the same two heads, ``169772734c90`` and
``a0e4764c1b55``, and both merged. Each is a valid merge on its own; together
they leave two heads again, and ``alembic upgrade head`` refuses to run.

Nothing is created here. Both parents are no-op merge revisions over the same
two revisions, so the graph below them is a diamond that Alembic walks once.

Revision ID: 5c2a9e71d4b3
Revises: 8eeb495f35bd, d93f53426d5f
Create Date: 2026-09-25 16:00:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "5c2a9e71d4b3"
down_revision: Union[str, Sequence[str], None] = ("8eeb495f35bd", "d93f53426d5f")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
