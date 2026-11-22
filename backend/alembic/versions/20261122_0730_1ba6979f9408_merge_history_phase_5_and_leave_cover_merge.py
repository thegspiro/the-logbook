"""Merge History phase 5 and the leave-cover merge, the two heads main carried

On 2026-11-22 main joined its earlier three-way fork twice. #4549 landed
``67f75ff116ae`` (``3f93727e84ba`` with ``a9763f96e072``), and #4537 re-pointed
History phase 5 (ending at ``9cce83b31c70``) at ``3250c110534f``, which joins all
three. Each was one head in its own branch's CI, so both reached main and
``alembic upgrade head`` refuses to run. ``67f75ff116ae`` is itself a no-op
merge whose parents are already ancestors of ``3250c110534f``, and Alembic runs
each revision once however many merge paths reach it, so this merge carries no
operations.

Revision ID: 1ba6979f9408
Revises: 67f75ff116ae, 9cce83b31c70
Create Date: 2026-11-22 07:30:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1ba6979f9408"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("67f75ff116ae", "9cce83b31c70")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
