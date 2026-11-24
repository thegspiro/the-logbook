"""Merge 2 migration heads on main

Written by scripts/rejoin_migration_heads.py. These heads each saw a single
head in their own branch's CI run, and all of them landed on ``main``:

- ``5c2e8a417d90`` ("CRR activities: the activity log, its Admin Hours link, and the CRR grants")
- ``9c41e7b2d5a3`` ("Anonymised members' names as instructors read "Former member"")

``alembic upgrade head`` fails until they are rejoined. Nothing is created
here. Each revision already ran its own DDL; Alembic runs each revision exactly
once no matter how many merge paths reach it.

The revision id is derived from the heads, so any other merge of exactly these
heads is this same file and cannot fork the chain again.

Revision ID: e7ed388345a4
Revises: 5c2e8a417d90, 9c41e7b2d5a3
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "e7ed388345a4"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("5c2e8a417d90", "9c41e7b2d5a3")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into separate heads needs no DDL."""
