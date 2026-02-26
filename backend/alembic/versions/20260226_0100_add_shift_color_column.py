"""Add color column to shifts table

Revision ID: 20260226_0100
Revises: 20260225_0100
Create Date: 2026-02-26

Adds a color column to the shifts table so shifts can carry the hex color
from their originating template for consistent calendar rendering.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "20260226_0100"
down_revision = "20260225_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shifts", sa.Column("color", sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column("shifts", "color")
