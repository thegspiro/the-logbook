"""Merge 3 migration heads on main

Written by scripts/rejoin_migration_heads.py. These heads each saw a single
head in their own branch's CI run, and all of them landed on ``main``:

- ``39818e142d35`` ("Merge 2 migration heads on main")
- ``5c8e1f3a9d27`` ("Let a coordinator approve self sign-ups for apparatus nights")
- ``b37218495d33`` ("Drop the redundant idx_meeting_attendees_meeting index")

``alembic upgrade head`` fails until they are rejoined. Nothing is created
here. Each revision already ran its own DDL; Alembic runs each revision exactly
once no matter how many merge paths reach it.

The revision id is derived from the heads, so any other merge of exactly these
heads is this same file and cannot fork the chain again.

Revision ID: 986d6575af35
Revises: 39818e142d35, 5c8e1f3a9d27, b37218495d33
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "986d6575af35"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("39818e142d35", "5c8e1f3a9d27", "b37218495d33")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into separate heads needs no DDL."""
