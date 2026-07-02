"""Add platoon field to users

Adds a per-member ``platoon`` attribute (A/B/C/...) so duty-platoon
membership is a single org-wide source of truth, consumed by shift
pattern generation for platoon rotations instead of being snapshotted
inside each pattern.

Revision ID: 20260618_0100
Revises: 20260613_0001
Create Date: 2026-06-18 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260618_0100"
down_revision = "20260613_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("platoon", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "platoon")
