"""Merge the module-gating branch with main's corporate-storefront chain

Two heads, both descended from ``a1f7c34e9b02``:

* ``cff6124cbb3f`` — this branch, which itself merged the three heads left by
  the storefront-variant, storefront-backfill and baseline-grant pull requests
* ``b3e8d1f45a27`` — main's crew-seat rename, storefront personalization and
  corporate-position store grants

``head`` is ambiguous with two of them, so ``alembic upgrade head`` aborts
before running anything — which takes out every CI job that builds the schema
from migrations, and every fresh install, not merely the newest revision.

The two chains do not touch the same rows. ``a4f8c1b92d17`` and
``c4f8a2e70d19`` backfill storefront grants onto ``member``, ``firefighter``
and ``engineer``; ``b3e8d1f45a27`` grants the thirteen corporate positions —
treasurer, secretary, historian and the rest. Disjoint slugs, so neither
migration's frozen ``_PRIOR_DEFAULTS`` snapshot can be invalidated by the
other landing first, and the merge needs no reconciliation beyond the graph.

Nothing is created here. Alembic runs each revision exactly once regardless of
how many merge paths reach it.

Revision ID: 4b71d80aa2c1
Revises: cff6124cbb3f, b3e8d1f45a27
Create Date: 2026-08-26 13:00:00.000000
"""

# revision identifiers
revision = "4b71d80aa2c1"
down_revision = ("cff6124cbb3f", "b3e8d1f45a27")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
