"""Fix organization_type enum values case mismatch

Revision ID: 20260207_0500
Revises: 20260207_0401
Create Date: 2026-02-07

ISSUE:
The organization_type enum in the database has UPPERCASE values
(FIRE_DEPARTMENT, EMS_ONLY, FIRE_EMS_COMBINED), but the application
sends lowercase values (fire_department, ems_only, fire_ems_combined).

This causes the error:
"'fire_ems_combined' is not among the defined enum values"

ROOT CAUSE:
MySQL ENUMs are case-sensitive. The enum was created with wrong case.

FIX:
Recreate the enum with correct lowercase values to match the application.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


# revision identifiers, used by Alembic.
revision = '20260207_0500'
down_revision = '20260207_0401'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Fix the organization_type enum values to use lowercase.

    MySQL ENUM is case-sensitive, so we need to:
    1. Change the column to VARCHAR temporarily
    2. Drop the old enum type
    3. Create new enum with correct values
    4. Convert the column back to the new enum
    """

    # Step 1: Change column to VARCHAR to preserve data
    op.alter_column(
        'organizations',
        'organization_type',
        type_=sa.String(50),
        existing_nullable=False,
        existing_server_default='fire_department'
    )

    # Step 2: Drop the old enum type (MySQL specific)
    # Note: In MySQL, we don't explicitly drop enum types, they're column-specific

    # Step 3: Convert back to ENUM with correct lowercase values
    op.alter_column(
        'organizations',
        'organization_type',
        type_=sa.Enum('fire_department', 'ems_only', 'fire_ems_combined', name='organizationtype'),
        existing_nullable=False,
        existing_server_default='fire_department'
    )


def downgrade() -> None:
    """
    Revert to uppercase enum values (not recommended).

    This is provided for rollback capability but should not be used
    as it will break the application.
    """
    # Convert to VARCHAR
    op.alter_column(
        'organizations',
        'organization_type',
        type_=sa.String(50),
        existing_nullable=False
    )

    # Convert back to uppercase enum (will break application)
    op.alter_column(
        'organizations',
        'organization_type',
        type_=sa.Enum('FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED', name='organizationtype'),
        existing_nullable=False,
        existing_server_default='FIRE_DEPARTMENT'
    )
