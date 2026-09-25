"""merge the footer and suggestion heads

Two pull requests built on ``1ae1ffbc445e`` and both merged, leaving two
heads:

* #2731 added ``3f3b315165ed`` (drop the seeded "do not reply" footer line).
* #2730 added ``0010291816fd`` then ``e79309de6735`` (suggestion status
  history and the idea board).

Alembic refuses ``upgrade head`` while more than one head exists. Nothing is
created here — the two branches touch unrelated tables, and every revision
below already ran on one side or the other.

Revision ID: 53ce8e3e29a5
Revises: 3f3b315165ed, e79309de6735
Create Date: 2026-09-25 18:08:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "53ce8e3e29a5"
down_revision: Union[str, Sequence[str], None] = ("3f3b315165ed", "e79309de6735")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
