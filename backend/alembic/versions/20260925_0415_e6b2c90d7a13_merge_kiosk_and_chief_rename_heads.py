"""Merge the self-checkout kiosk and Chief rename heads.

Revision ID: e6b2c90d7a13
Revises: 2000f4561f52, d4e1a7c93b58

``2000f4561f52`` (inventory self-checkout kiosk columns) and ``d4e1a7c93b58``
(seed the top operational officer as "Chief") were written in parallel against
``b1eb0458782a`` and both merged to ``main``, which left two heads and made
``alembic upgrade head`` refuse to run. This revision joins them and has no
schema effect of its own; the parents touch unrelated tables
(``inventory_categories``; seeded position names) and apply in either order.
"""

revision = "e6b2c90d7a13"
down_revision = ("2000f4561f52", "d4e1a7c93b58")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
