"""Merge the history phase 5 head with the leave approver cover merge

Two merges of the 2026-11-22 fork reached main from different pull requests.
#4547 merged ``3f93727e84ba`` with ``a9763f96e072`` as ``67f75ff116ae``.
#4537 (history phase 5) carried ``3250c110534f``, which merges
``3f93727e84ba``, ``6a94645761c1`` and ``a9763f96e072``, and built
``9cce83b31c70`` on it. Both are on main, so main has two heads,
``9cce83b31c70`` and ``67f75ff116ae``, and ``alembic upgrade head`` refuses to
run.

This joins them. Every revision under ``67f75ff116ae`` is already under
``9cce83b31c70`` too, by way of ``3250c110534f``, so the merge carries no
operations; ``9cce83b31c70``'s history tables (``historical_members``,
``history_sources``, ``history_media``) do not touch the leave tables either.

Revision ID: fc5584a22199
Revises: 9cce83b31c70, 67f75ff116ae
Create Date: 2026-11-22 07:21:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "fc5584a22199"
down_revision = ("9cce83b31c70", "67f75ff116ae")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
