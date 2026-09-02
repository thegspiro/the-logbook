"""Merge heads: issuance lot allocations and event attendee visibility.

Revision ID: a1d7f3c05e64
Revises: c3d0e5f7a924, c3a71e5d9b48

This branch's messaging/inventory line (through c3d0e5f7a924, which descends
from the recipient revoked_at revision) and main's event attendee visibility
revision are independent heads. Joining them here keeps `alembic upgrade head`
single-headed without repointing either side's already-pushed revisions.
"""

revision = "a1d7f3c05e64"
down_revision = ("c3d0e5f7a924", "c3a71e5d9b48")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
