"""Merge the garment-style and Treasurer-grant migration heads.

Revision ID: d3f8b6a24c91
Revises: c4f7a2e91b38, ee7390dcdf47
Create Date: 2026-09-07 01:00:00.000000

The garment style axes (``b8e3f1a97c24`` → ``c4f7a2e91b38``) and the Treasurer
finance grant (``ee7390dcdf47``) were developed in parallel and both chain off
``d7c1b95e2a40``, so merging the branches left the revision graph with two heads
and made ``alembic upgrade head`` ambiguous ("Multiple head revisions are
present").

This revision rejoins them and has no schema effect of its own. The two parents
are independent — ``inventory_items.style_attributes`` plus
``member_size_preferences.garment_fit`` on one side, a positions/permissions
grant on the other — so they apply in either order.

A merge revision rather than re-pointing ``b8e3f1a97c24`` at the Treasurer head:
that is the convention every fork in this chain has followed, and unlike
re-parenting it stays correct whether or not an installation has already applied
either branch.
"""

# revision identifiers
revision = "d3f8b6a24c91"
down_revision = ("c4f7a2e91b38", "ee7390dcdf47")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
