"""Merge the NFC compartment tags and email masthead heads.

Revision ID: ff6730a7db54
Revises: 45b36bae9098, f0d76814a9ab

``45b36bae9098`` (NFC tags on equipment-check compartments) and
``f0d76814a9ab`` (email templates' centred masthead shell) were written in
parallel and both merged to ``main``, which left two heads and made
``alembic upgrade head`` refuse to run. This revision joins them and has no
schema effect of its own; the parents touch unrelated tables
(``inventory_nfc_tags``; email template rows) and apply in either order.
"""

revision = "ff6730a7db54"
down_revision = ("45b36bae9098", "f0d76814a9ab")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
