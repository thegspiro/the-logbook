"""Merge the minutes-section-motions head with main's head

``751a14709cc4`` (this branch's migration) revises a revision that ``main`` has since
built on, and ``7ce50d36b948`` is ``main``'s head (#3437). ``alembic upgrade head``
fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: ca0c2111466f
Revises: 751a14709cc4, 7ce50d36b948
Create Date: 2026-10-19 00:57:42.265812
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "ca0c2111466f"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("751a14709cc4", "7ce50d36b948")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
