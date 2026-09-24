"""Merge the two heads left by the inventory NFC and Compliance box merges.

Revision ID: 5e1c0b9f7a42
Revises: 944dfb53346d, 7d2b4e8a1c35

``3c918c06466d`` (Compliance Officer seed) and ``ced0061dedc8`` (inventory NFC
tags) were written in parallel against ``941e1251ad74``. Two branches then
rejoined them independently, each unaware of the other:

* ``944dfb53346d`` joins ``3c918c06466d`` with the NFC chain's tip,
  ``b713c2e8ee26``;
* ``7d2b4e8a1c35`` joins ``3c918c06466d`` with ``ced0061dedc8`` and switches the
  seeded Compliance boxes on.

Both are published on ``main``, so ``main`` carried two heads and
``alembic upgrade head`` refused to run. This revision joins them and has no
schema effect of its own; the two parents touch unrelated tables and apply in
either order.
"""

revision = "5e1c0b9f7a42"
down_revision = ("944dfb53346d", "7d2b4e8a1c35")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
