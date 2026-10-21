"""Merge the membership-type and attribution-FK heads

#3522's ``cbe0de50f202`` (attribution FKs set null on member delete) and the
membership-type change's ``2794794bda6e`` (membership type drives account
status) both revise ``1eb43da769b2`` and merged to ``main`` minutes apart on
2026-10-21. Neither saw the other, leaving two heads, and
``alembic upgrade head`` fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 75a6edc2ae4a
Revises: 2794794bda6e, cbe0de50f202
Create Date: 2026-10-21 17:01:22.221407
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "75a6edc2ae4a"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("2794794bda6e", "cbe0de50f202")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
