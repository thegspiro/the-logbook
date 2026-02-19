"""Add display_code to locations for public kiosk URLs

Adds a short, non-guessable display_code column to the locations table.
This enables public tablet/kiosk displays at /display/{code} that show
QR codes for event check-in without requiring authentication.

Backfills existing locations with unique display codes.

Revision ID: 20260218_0900
Revises: 20260218_0800
Create Date: 2026-02-18
"""
from alembic import op
import sqlalchemy as sa
import secrets
import string

# revision identifiers
revision = '20260218_0900'
down_revision = '20260218_0800'
branch_labels = None
depends_on = None


def _generate_display_code(length=8):
    """Generate a short, URL-safe display code."""
    alphabet = string.ascii_lowercase + string.digits
    alphabet = alphabet.replace('0', '').replace('o', '').replace('l', '').replace('1', '')
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def upgrade() -> None:
    # Add display_code column (nullable initially for backfill)
    op.add_column('locations', sa.Column('display_code', sa.String(12), nullable=True))

    # Backfill existing locations with unique display codes
    conn = op.get_bind()
    locations = conn.execute(sa.text("SELECT id FROM locations WHERE display_code IS NULL"))
    used_codes = set()
    for row in locations:
        code = _generate_display_code()
        while code in used_codes:
            code = _generate_display_code()
        used_codes.add(code)
        conn.execute(
            sa.text("UPDATE locations SET display_code = :code WHERE id = :id"),
            {"code": code, "id": row[0]},
        )

    # Add unique index after backfill
    op.create_index('ix_locations_display_code', 'locations', ['display_code'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_locations_display_code', table_name='locations')
    op.drop_column('locations', 'display_code')
