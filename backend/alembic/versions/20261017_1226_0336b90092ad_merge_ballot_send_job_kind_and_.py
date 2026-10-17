"""Merge the ballot-send-job kind and directory-account flags heads.

Revision ID: 0336b90092ad
Revises: 244b0fd07205, d3bb8f81ed07
Create Date: 2026-10-17 12:26:00.000000

``244b0fd07205`` (the ``kind`` column on ``ballot_send_jobs``) and
``d3bb8f81ed07`` (``license_pending`` and ``managed_on_premises`` on
``directory_account_provisions``) were written on separate branches, each from
the head ``main`` had when it was branched: ``244b0fd07205`` from
``c87efd81c5aa``, ``d3bb8f81ed07`` from ``73594b326e68`` (itself a child of
``c87efd81c5aa``). Both merged on 2026-10-17, each green against the ``main``
it was tested on, and together they left two heads, which stops
``alembic upgrade head``.

This revision rejoins them and has no schema effect of its own. The two
parents alter different tables, so they apply in either order.
"""

# revision identifiers
revision = "0336b90092ad"
down_revision = ("244b0fd07205", "d3bb8f81ed07")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
