"""Merge the return-receipt branch with the facilities-view revocation branch

Two heads, both descended from ``a8f3c1d7e902``:

* ``f4a9c2d81e70`` — adds physical receipt evidence and return-request
  stages to ``return_requests``
* ``e4f5a6b7c8d9`` — revokes ``facilities.view`` from the baseline member
  and junior-rank positions

``head`` is ambiguous with two of them, so ``alembic upgrade head`` aborts
before running anything — which takes out every CI job that builds the
schema from migrations, and every fresh install, not merely the newest
revision.

The two chains do not touch the same rows: one alters columns on
``return_requests``, the other rewrites ``permissions`` JSON on rows in
``positions``. Disjoint tables, so the merge needs no reconciliation beyond
the graph.

Nothing is created here. Alembic runs each revision exactly once regardless
of how many merge paths reach it.

Revision ID: d5e6f7a8b9c0
Revises: f4a9c2d81e70, e4f5a6b7c8d9
Create Date: 2026-08-27 09:00:00.000000
"""

# revision identifiers
revision = "d5e6f7a8b9c0"
down_revision = ("f4a9c2d81e70", "e4f5a6b7c8d9")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
