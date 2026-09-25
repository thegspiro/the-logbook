"""merge the two parallel heads fixes

Two branches each repaired the same fork on main and both merged:

* #2715 added ``169772734c90``, joining ``883c6309dcec`` and ``ff6730a7db54``.
* #2718 carried ``a0e4764c1b55``, joining ``883c6309dcec`` and
  ``31e8ad77527b`` (the offline shelf-audit submission id, which follows
  ``ff6730a7db54``).

Each is a valid merge on its own; together they leave two heads again, and
``alembic upgrade head`` refuses to run. This joins them. Nothing is created
here — every revision below already ran on one side, and Alembic applies each
revision once however many paths reach it.

Revision ID: 8eeb495f35bd
Revises: 169772734c90, a0e4764c1b55
Create Date: 2026-09-25 13:36:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "8eeb495f35bd"
down_revision: Union[str, Sequence[str], None] = ("169772734c90", "a0e4764c1b55")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
