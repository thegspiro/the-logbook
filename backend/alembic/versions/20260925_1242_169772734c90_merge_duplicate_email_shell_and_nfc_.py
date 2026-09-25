"""merge duplicate email-shell and nfc heads merges

#2711 (``ff6730a7db54``) and #2712 (``883c6309dcec``) were opened within
minutes of each other to join the same two heads — ``45b36bae9098``
(inventory NFC compartment tags) and ``f0d76814a9ab`` (email redesign) — and
both merged. Each is a valid merge on its own; together they leave the chain
with two heads again, which stops ``alembic upgrade head``.

Nothing is created here. Both parents are no-op merge revisions over the same
two revisions, so the graph below them is a diamond that Alembic walks once.

Revision ID: 169772734c90
Revises: 883c6309dcec, ff6730a7db54
Create Date: 2026-09-25 12:42:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "169772734c90"
down_revision: Union[str, Sequence[str], None] = ("883c6309dcec", "ff6730a7db54")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
