"""Merge the member service periods and consent default heads.

Revision ID: c3a7e19d5b20
Revises: 500a63596f66, b4014469fd76

``500a63596f66`` (member service periods) and ``b4014469fd76`` (user consents
default to not granted) were written in parallel against ``5e1c0b9f7a42`` and
both merged to ``main``, which left two heads and made
``alembic upgrade head`` refuse to run. This revision joins them and has no
schema effect of its own; the parents touch unrelated tables and apply in
either order.
"""

revision = "c3a7e19d5b20"
down_revision = ("500a63596f66", "b4014469fd76")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
