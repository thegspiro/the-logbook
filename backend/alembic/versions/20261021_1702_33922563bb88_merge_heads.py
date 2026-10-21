"""Merge the membership-type-status and attribution-FK heads

#3518 and #3522 merged on 2026-10-21, each adding a revision on top of
``1eb43da769b2``: #3518's ``2794794bda6e`` (membership type drives account
status) and #3522's ``cbe0de50f202`` (attribution FKs set null on member
delete). Neither saw the other, leaving two heads, and ``alembic upgrade
head`` fails until they are rejoined.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 33922563bb88
Revises: 2794794bda6e, cbe0de50f202
Create Date: 2026-10-21 17:02:00.000000
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "33922563bb88"
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
