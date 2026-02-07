"""Fix logo column size to support base64 images

Revision ID: 20260207_0400
Revises: 20260206_0303
Create Date: 2026-02-07

Changes the organizations.logo column from TEXT (64KB limit) to LONGTEXT
to support base64-encoded images which can be several hundred KB.

Base64 images are typically 33% larger than the original image size.
A 250KB image becomes ~330KB in base64, which exceeds the TEXT limit.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


# revision identifiers, used by Alembic.
revision = '20260207_0400'
down_revision = '20260206_0303'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Change logo column from TEXT to LONGTEXT.

    TEXT: 65,535 bytes (64KB)
    LONGTEXT: 4,294,967,295 bytes (4GB)
    """
    # Alter the column to LONGTEXT
    op.alter_column(
        'organizations',
        'logo',
        existing_type=sa.Text(),
        type_=mysql.LONGTEXT(),
        existing_nullable=True
    )


def downgrade() -> None:
    """Revert logo column back to TEXT."""
    # WARNING: This will truncate any logos larger than 64KB
    op.alter_column(
        'organizations',
        'logo',
        existing_type=mysql.LONGTEXT(),
        type_=sa.Text(),
        existing_nullable=True
    )
