"""Merge 2 migration heads on main

Written by scripts/rejoin_migration_heads.py. These heads each saw a single
head in their own branch's CI run, and all of them landed on ``main``:

- ``46accab49bc1`` ("History phase 7: what the department's website may show")
- ``5845dae0c277`` ("Training approval reminder becomes an email template")

``alembic upgrade head`` fails until they are rejoined. Nothing is created
here. Each revision already ran its own DDL; Alembic runs each revision exactly
once no matter how many merge paths reach it.

The revision id is derived from the heads, so any other merge of exactly these
heads is this same file and cannot fork the chain again.

Revision ID: fe08fa7323f2
Revises: 46accab49bc1, 5845dae0c277
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "fe08fa7323f2"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("46accab49bc1", "5845dae0c277")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into separate heads needs no DDL."""
