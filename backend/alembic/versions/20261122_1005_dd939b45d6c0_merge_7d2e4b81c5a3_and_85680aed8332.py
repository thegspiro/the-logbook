"""Merge 7d2e4b81c5a3 and 85680aed8332, two joins of the same pair

Both revisions are no-op merges of ``1ba6979f9408`` and ``fc5584a22199``.
``7d2e4b81c5a3`` landed with #4554 and ``85680aed8332`` with #4555, minutes
apart, each as the single head of its own branch, so main carries two heads
and ``alembic upgrade head`` refuses to run. This joins them and carries no
operations.

Revision ID: dd939b45d6c0
Revises: 7d2e4b81c5a3, 85680aed8332
Create Date: 2026-11-22 10:05:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "dd939b45d6c0"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("7d2e4b81c5a3", "85680aed8332")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
