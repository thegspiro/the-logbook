"""Merge the two duplicate merge heads main carried after #4549

On 2026-11-22 two branches each wrote a merge of the same pair of heads,
``67f75ff116ae`` and ``9cce83b31c70``: ``fc5584a22199`` (#4549) and
``1ba6979f9408`` (#4537's follow-up). Each was the single head in its own
branch's CI, so both reached main, and ``alembic upgrade head`` refuses to run
with two heads. Both are no-op merges of the same parents, so this one joins
them and carries no operations either.

Revision ID: 85680aed8332
Revises: 1ba6979f9408, fc5584a22199
Create Date: 2026-11-22 09:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "85680aed8332"
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
