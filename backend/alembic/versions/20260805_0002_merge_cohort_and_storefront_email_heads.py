"""Merge the course-cohort and storefront-email heads

Two pull requests merged twelve minutes apart, and each had independently
reconciled the same earlier fork:

* #1163 (storefront email templates) added
  ``20260802_0002_merge_storefront_and_dues_heads``, then built a chain of
  storefront revisions on top of it, ending at ``20260802_0010``.
* #1162 (multi-class courses) added ``20260805_0001``, whose ``down_revision``
  is the same ``(20260801_0020, 20260802_0001)`` tuple.

Neither branch could see the other's merge revision, so resolving the fork
twice produced a new one. This revision joins the two resolutions. Nothing is
created here — every table and column already came from one side or the other,
and Alembic runs each revision exactly once regardless of how many merge paths
reach it.

Revision ID: 20260805_0002
Revises: 20260802_0010, 20260805_0001
Create Date: 2026-08-05 15:40:00.000000
"""

# revision identifiers
revision = "20260805_0002"
down_revision = ("20260802_0010", "20260805_0001")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
