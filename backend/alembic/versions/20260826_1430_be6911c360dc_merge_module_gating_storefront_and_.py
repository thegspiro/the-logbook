"""Merge the module-gating/storefront chain with member qualifications

Two heads, both descended from ``b3e8d1f45a27`` (corporate storefront grants):

* ``4b71d80aa2c1`` — the module-gating branch's own merge with main's
  corporate-storefront chain
* ``a7b8c9d0e1f2`` — ``member_qualifications``, added on the other path via
  ``f1a2b3c4d5e6`` (split member class/status)

``head`` is ambiguous with two of them, so ``alembic upgrade head`` aborts
before running anything — which takes out every CI job that builds the schema
from migrations, and every fresh install, not merely the newest revision.

The two chains do not touch the same rows. ``4b71d80aa2c1``'s side grants and
regates existing module/position access; ``a7b8c9d0e1f2`` creates the new
``member_qualifications`` table outright. Disjoint objects, so the merge needs
no reconciliation beyond the graph.

Nothing is created here. Alembic runs each revision exactly once regardless of
how many merge paths reach it.

Revision ID: be6911c360dc
Revises: 4b71d80aa2c1, a7b8c9d0e1f2
Create Date: 2026-08-26 14:30:00.000000
"""

# revision identifiers
revision = "be6911c360dc"
down_revision = ("4b71d80aa2c1", "a7b8c9d0e1f2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
