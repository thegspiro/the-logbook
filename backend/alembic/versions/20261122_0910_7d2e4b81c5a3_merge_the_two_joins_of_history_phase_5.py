"""Merge the two joins of History phase 5 and the leave-cover merge

``1ba6979f9408`` (#4544) and ``fc5584a22199`` (#4549) both join the same pair,
``67f75ff116ae`` and ``9cce83b31c70``, and landed on main minutes apart. Each
was one head in its own branch's CI, so main has two heads and ``alembic
upgrade head`` refuses to run. Neither can be removed: both are on main and
either may already be recorded in a database's ``alembic_version``. Both are
no-op merges of the same parents, so this merge carries no operations.

Revision ID: 7d2e4b81c5a3
Revises: 1ba6979f9408, fc5584a22199
Create Date: 2026-11-22 09:10:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7d2e4b81c5a3"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("1ba6979f9408", "fc5584a22199")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
