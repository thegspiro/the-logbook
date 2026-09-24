"""Merge the inventory NFC-tag and Compliance Officer seed migration heads.

Revision ID: 7b2e4c9d1a53
Revises: ced0061dedc8, 3c918c06466d
Create Date: 2026-09-24 20:10:00.000000

Inventory NFC tags (``ced0061dedc8``) and the Compliance Officer position and
suggestion-box seed (``3c918c06466d``) were developed in parallel and both
chain off ``941e1251ad74``, so merging them left two heads and made
``alembic upgrade head`` ambiguous ("Multiple head revisions are present").

This revision rejoins them and has no schema effect of its own. The parents are
independent — NFC tag columns on inventory on one side, seeded position and
suggestion-box rows on the other — so they apply in either order.
"""

# revision identifiers
revision = "7b2e4c9d1a53"
down_revision = ("ced0061dedc8", "3c918c06466d")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
