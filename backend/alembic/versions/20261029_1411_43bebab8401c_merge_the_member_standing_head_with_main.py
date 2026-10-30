"""Merge the member-standing head with main.

No schema change: joins ``30e5b112ec00`` (main) and ``d8f1a4c27b93`` (this
branch) so the chain has one head again.

Revision ID: 43bebab8401c
Revises: 30e5b112ec00, d8f1a4c27b93
Create Date: 2026-10-29 14:11:57.525542

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "43bebab8401c"
down_revision: Union[str, None] = ("30e5b112ec00", "d8f1a4c27b93")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
