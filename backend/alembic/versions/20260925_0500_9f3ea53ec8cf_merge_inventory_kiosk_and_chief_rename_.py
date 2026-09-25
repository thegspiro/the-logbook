"""merge inventory kiosk and chief rename heads

Two pull requests branched off the same parent and merged on the same day
without seeing each other, leaving the chain with two heads:

* The inventory self-checkout kiosk added ``2000f4561f52``.
* Renaming the seeded "Fire Chief" position to "Chief" added
  ``d4e1a7c93b58``.

Alembic refuses ``upgrade head`` while more than one head exists, so this
stops migrations running at all, not only ``test_exactly_one_head``.

Nothing is created here — every table and column already came from one side or
the other, and Alembic runs each revision exactly once regardless of how many
merge paths reach it.

Revision ID: 9f3ea53ec8cf
Revises: 2000f4561f52, d4e1a7c93b58
Create Date: 2026-09-25 05:00:22.549311

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "9f3ea53ec8cf"
down_revision: Union[str, Sequence[str], None] = ("2000f4561f52", "d4e1a7c93b58")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
