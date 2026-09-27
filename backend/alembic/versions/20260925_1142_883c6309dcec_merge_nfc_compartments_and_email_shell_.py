"""merge nfc compartments and email shell heads

Two pull requests merged into main minutes apart, each green against the main
it was tested on, leaving the chain with two heads:

* #2707 (inventory NFC compartment tags) added ``45b36bae9098``.
* #2708 (email redesign) added ``f0d76814a9ab``.

Alembic refuses ``upgrade head`` while more than one head exists, so this
stops migrations running at all, not only ``test_exactly_one_head``.

Nothing is created here — every table and column already came from one side or
the other, and Alembic runs each revision exactly once regardless of how many
merge paths reach it.

Revision ID: 883c6309dcec
Revises: 45b36bae9098, f0d76814a9ab
Create Date: 2026-09-25 11:42:13

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "883c6309dcec"
down_revision: Union[str, Sequence[str], None] = ("45b36bae9098", "f0d76814a9ab")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
