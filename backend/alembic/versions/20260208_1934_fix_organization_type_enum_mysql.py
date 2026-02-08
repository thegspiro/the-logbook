"""Fix organization_type enum using raw MySQL commands

Revision ID: 20260208_1934
Revises: 20260207_0501
Create Date: 2026-02-08 19:34

ISSUE:
The previous migration (20260207_0500) tried to fix the organization_type
enum case mismatch but didn't work correctly in MySQL. The enum still has
UPPERCASE values instead of lowercase.

ROOT CAUSE:
SQLAlchemy's sa.Enum() doesn't properly handle MySQL enum modifications.
We need to use raw SQL to modify the ENUM column.

FIX:
Use raw MySQL ALTER TABLE MODIFY COLUMN to directly change the enum values.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260208_1934'
down_revision = '20260207_0501'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Fix the organization_type enum using raw MySQL commands.

    MySQL ENUMs can be modified using ALTER TABLE MODIFY COLUMN with the new enum values.
    """
    # Use raw SQL to modify the enum column with correct lowercase values
    op.execute("""
        ALTER TABLE organizations
        MODIFY COLUMN organization_type
        ENUM('fire_department', 'ems_only', 'fire_ems_combined')
        NOT NULL
        DEFAULT 'fire_department'
    """)

    # Update any existing uppercase values to lowercase (if any exist)
    op.execute("""
        UPDATE organizations
        SET organization_type = LOWER(organization_type)
        WHERE organization_type IN ('FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED')
    """)


def downgrade() -> None:
    """
    Revert to uppercase enum values (not recommended).
    """
    # Convert back to uppercase (will break application)
    op.execute("""
        ALTER TABLE organizations
        MODIFY COLUMN organization_type
        ENUM('FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED')
        NOT NULL
        DEFAULT 'FIRE_DEPARTMENT'
    """)

    # Update values to uppercase
    op.execute("""
        UPDATE organizations
        SET organization_type = UPPER(organization_type)
    """)
