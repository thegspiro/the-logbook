"""Increase organization logo column size to support large base64 images

Revision ID: 20260207_0502
Revises: 20260207_0501
Create Date: 2026-02-07

Changes TEXT (65KB) to MEDIUMTEXT (16MB) to support large base64-encoded logos
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '20260207_0502'
down_revision = '20260207_0501'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Change logo column from TEXT (65KB) to MEDIUMTEXT (16MB)
    # This supports base64-encoded images up to ~12MB original size
    op.alter_column(
        'organizations',
        'logo',
        existing_type=sa.Text(),
        type_=mysql.MEDIUMTEXT(),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Revert to TEXT (may truncate large logos)
    op.alter_column(
        'organizations',
        'logo',
        existing_type=mysql.MEDIUMTEXT(),
        type_=sa.Text(),
        existing_nullable=True,
    )
