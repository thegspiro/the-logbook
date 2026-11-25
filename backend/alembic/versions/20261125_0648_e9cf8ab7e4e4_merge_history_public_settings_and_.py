"""merge history public settings and training approval reminder heads

Two pull requests branched off ``d41f7a2c9e58`` and merged on the same day
without seeing each other, leaving the chain with two heads:

* History phase 7 added ``history_public_settings``, chained through
  ``8d4ee6cc92ca`` to ``46accab49bc1``.
* The training sign-off reminder email type added ``5845dae0c277``, branched
  directly off ``d41f7a2c9e58`` — a prior merge conflict had already re-pointed
  it there, onto what was, at the time of that fix, believed to be the current
  head, but ``46accab49bc1`` had already landed on ``main`` ahead of it.

Alembic refuses ``upgrade head`` while more than one head exists, so this
stops migrations running at all, not only ``test_exactly_one_head``.

Nothing is created here — every table and column already came from one side
or the other, and Alembic runs each revision exactly once regardless of how
many merge paths reach it.

Revision ID: e9cf8ab7e4e4
Revises: 46accab49bc1, 5845dae0c277
Create Date: 2026-11-25 06:48:50.029907

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "e9cf8ab7e4e4"
down_revision: Union[str, Sequence[str], None] = ("46accab49bc1", "5845dae0c277")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
