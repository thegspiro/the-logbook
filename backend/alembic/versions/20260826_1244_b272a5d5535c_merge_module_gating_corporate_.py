"""Merge the module-gating/corporate-storefront chain with the member-qualifications chain

Two heads, both descended from ``b3e8d1f45a27`` (corporate-position store
grants):

* ``4b71d80aa2c1`` — merges the module-gating branch with main's
  corporate-storefront chain (itself a merge of three earlier heads)
* ``a7b8c9d0e1f2`` — ``f1a2b3c4d5e6`` (split ``member_class``/``member_status``)
  followed by the new ``member_qualifications`` table

``head`` is ambiguous with two of them, so ``alembic upgrade head`` aborts
before running anything — which takes out every CI job that builds the schema
from migrations, and every fresh install, not merely the newest revision.

The two chains do not touch the same rows or tables: one is module-visibility
gating plus storefront grants/personalization, the other is member
classification columns plus a brand-new ``member_qualifications`` table.
Disjoint concerns, so the merge needs no reconciliation beyond the graph.

Nothing is created here. Alembic runs each revision exactly once regardless of
how many merge paths reach it.

Revision ID: b272a5d5535c
Revises: 4b71d80aa2c1, a7b8c9d0e1f2
Create Date: 2026-08-26 12:44:49.787550
"""

# revision identifiers
revision = "b272a5d5535c"
down_revision = ("4b71d80aa2c1", "a7b8c9d0e1f2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
