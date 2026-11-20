"""Merge the three heads main carried on 2026-11-20

``0c22a95b94b8`` ("settle training attachment strings"), ``73f64017f9e2``
("guest headcount reminder email template") and ``a6c3e8d17f42`` ("evaluation
step assignee") each revise ``790a86084359``, so each saw a single head in its
own branch's CI run and all three landed on ``main``. ``alembic upgrade head``
fails until they are rejoined, and the startup fallback in ``main.py`` picks
one head by sorting, so an upgrading installation would skip the others.

Nothing is created here. Each revision already ran its own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 24c9eca002a2
Revises: 0c22a95b94b8, 73f64017f9e2, a6c3e8d17f42
Create Date: 2026-11-20 19:10:52.861116
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "24c9eca002a2"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("0c22a95b94b8", "73f64017f9e2", "a6c3e8d17f42")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into three heads needs no DDL."""
