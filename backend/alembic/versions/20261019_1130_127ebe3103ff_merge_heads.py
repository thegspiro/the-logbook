"""Merge the finance-timestamp/checklist-items-location merge heads

Two independent pull requests each merged their own fork of the Alembic
chain without seeing the other's branch: the finance-timestamp-backfill
merge (``4e18470473d6``) and the checklist-items-between-locations
migration (``d80493f28236``). ``alembic upgrade head`` fails until they
are rejoined.

Nothing is created here. Both revisions already ran their own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 127ebe3103ff
Revises: 4e18470473d6, d80493f28236
Create Date: 2026-10-19 11:30:04.534601

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "127ebe3103ff"
down_revision: Union[str, Sequence[str], None] = ("4e18470473d6", "d80493f28236")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
