"""Merge the storefront-variant, storefront-backfill and baseline-grant heads

Three pull requests branched from ``c4a91b7e2f08`` and merged without seeing
each other, leaving ``alembic upgrade head`` unresolvable:

* ``c6a3f8b41e29`` — storefront product variant ordering (via ``a4f8c1b92d17``
  and ``b5e2d9a37c48``)
* ``c4f8a2e70d19`` — the second storefront member-grant backfill
* ``a1f7c34e9b02`` — revoking ``notifications.view`` from baseline positions

The failure is not cosmetic: ``head`` is ambiguous, so the upgrade aborts
before running anything, which takes out every CI job that builds the schema
from migrations as well as any fresh install.

``a4f8c1b92d17`` and ``c4f8a2e70d19`` are two independent backfills of the same
storefront grants, written against different guards. Both are idempotent with
respect to ``storefront.view`` / ``storefront.order``, so running them in
either order converges: whichever lands first appends the grants, and the
other finds them already present and skips the row.

Nothing is created here. Alembic runs each revision exactly once regardless of
how many merge paths reach it.

Revision ID: 20260826_0001
Revises: c6a3f8b41e29, c4f8a2e70d19, a1f7c34e9b02
Create Date: 2026-08-26 00:01:00.000000
"""

# revision identifiers
revision = "20260826_0001"
down_revision = ("c6a3f8b41e29", "c4f8a2e70d19", "a1f7c34e9b02")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into three heads needs no DDL."""
