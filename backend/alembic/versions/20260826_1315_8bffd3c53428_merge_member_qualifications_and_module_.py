"""Merge the member-qualifications chain with the module-gating chain

Two heads, left on ``main`` by two pull requests that merged within minutes of
each other and neither of which could see the other's revision:

* ``a7b8c9d0e1f2`` — member class / status and the ``member_qualifications``
  table (#1841)
* ``4b71d80aa2c1`` — itself the merge of the module-gating branch with main's
  corporate-storefront chain (#1840)

``head`` is ambiguous with two of them, so ``alembic upgrade head`` aborts
before running anything. That is not one failing revision: it takes out every
CI job that builds the schema from migrations — both matrix databases across
integration and contract, plus the migration-chain check in Backend Lint — and
every fresh install, which is how this arrives as five red checks on a branch
whose diff never touched either chain.

The two chains are disjoint. ``a7b8c9d0e1f2`` creates a new table and adds two
columns to ``users``; the module-gating chain rewrites ``positions``
permission rows and organization module settings. Neither reads what the other
writes, and neither carries a frozen snapshot the other could invalidate, so
the merge needs no reconciliation beyond the revision graph.

Nothing is created here. Alembic runs each revision exactly once regardless of
how many merge paths reach it.

Revision ID: 8bffd3c53428
Revises: 4b71d80aa2c1, a7b8c9d0e1f2
Create Date: 2026-08-26 13:15:01.415017
"""

# revision identifiers, used by Alembic.
revision = "8bffd3c53428"
down_revision = ("4b71d80aa2c1", "a7b8c9d0e1f2")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: unmerging the graph would re-fork it."""
