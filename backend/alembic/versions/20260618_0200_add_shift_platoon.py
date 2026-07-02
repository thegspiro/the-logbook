"""Add platoon field to shifts

Records which duty platoon (A/B/C…) a shift belongs to when it is generated
from a platoon rotation, so the UI can label the shift and show its platoon
roster (who is on, on leave, or open for hold-over).

Revision ID: 20260618_0200
Revises: 20260618_0100
Create Date: 2026-06-18 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260618_0200"
down_revision = "20260618_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shifts", sa.Column("platoon", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("shifts", "platoon")
