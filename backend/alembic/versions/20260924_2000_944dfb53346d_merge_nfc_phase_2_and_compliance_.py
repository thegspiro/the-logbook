"""Merge the inventory NFC and Compliance Officer migration heads.

Revision ID: 944dfb53346d
Revises: b713c2e8ee26, 3c918c06466d
Create Date: 2026-09-24 20:00:58.688625

Inventory NFC tags (``ced0061dedc8`` → ``b713c2e8ee26``) and the Compliance
Officer seed (``3c918c06466d``) were developed in parallel and both chain off
``941e1251ad74``, so merging the branches left the revision graph with two heads
and made ``alembic upgrade head`` ambiguous ("Multiple head revisions are
present").

This revision rejoins them and has no schema effect of its own. The two parents
are independent — the ``inventory_nfc_tags`` / ``inventory_nfc_scans`` tables on
one side, a seeded position and suggestion box on the other — so they apply in
either order.

A merge revision rather than re-pointing ``ced0061dedc8`` at the Compliance
Officer head: ``ced0061dedc8`` is already published on ``main``, and a merge
revision stays correct whether or not an installation has applied either branch.
"""

# revision identifiers
revision = "944dfb53346d"
down_revision = ("b713c2e8ee26", "3c918c06466d")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
