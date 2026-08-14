"""Merge the event-reminder and August release migration heads.

Revision ID: 20260814_0005
Revises: 20260814_0004, 20260813_0020
"""

revision = "20260814_0005"
down_revision = ("20260814_0004", "20260813_0020")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the two schema histories; both parents contain the data changes."""


def downgrade() -> None:
    """Split back to the two parent heads without reverting either parent."""
