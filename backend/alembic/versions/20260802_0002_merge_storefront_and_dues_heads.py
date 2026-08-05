"""Merge the storefront and dues-ledger migration heads

The department storefront (20260801_0020) and the dues payments ledger
(20260802_0001) were developed in parallel and both chain off 20260801_0019,
so merging them left the revision graph with two heads and made
``alembic upgrade head`` ambiguous ("Multiple head revisions are present").

This revision merges the two branches. It has no schema effect of its own;
the two parents are independent (store_* tables vs. dues_payments) and apply
in either order.

Revision ID: 20260802_0002
Revises: 20260801_0020, 20260802_0001
Create Date: 2026-08-04
"""

# revision identifiers
revision = "20260802_0002"
down_revision = ("20260801_0020", "20260802_0001")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
