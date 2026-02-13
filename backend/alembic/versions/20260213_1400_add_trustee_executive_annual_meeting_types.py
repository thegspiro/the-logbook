"""Add trustee, executive, and annual meeting types

Revision ID: a7f3e2d91b04
Revises: (auto)
Create Date: 2026-02-13 14:00:00.000000

"""
from alembic import op

# revision identifiers
revision = 'a7f3e2d91b04'
down_revision = None  # Will be set by Alembic chain
branch_labels = None
depends_on = None


def upgrade() -> None:
    # MySQL requires ALTER TABLE ... MODIFY COLUMN to extend ENUM values
    # We need to update the enum on both meeting_minutes and minutes_templates tables.
    new_enum = "'business','special','committee','board','trustee','executive','annual','other'"

    op.execute(
        f"ALTER TABLE meeting_minutes MODIFY COLUMN meeting_type ENUM({new_enum}) NOT NULL DEFAULT 'business'"
    )
    op.execute(
        f"ALTER TABLE minutes_templates MODIFY COLUMN meeting_type ENUM({new_enum}) NOT NULL DEFAULT 'business'"
    )


def downgrade() -> None:
    old_enum = "'business','special','committee','board','other'"

    op.execute(
        f"ALTER TABLE meeting_minutes MODIFY COLUMN meeting_type ENUM({old_enum}) NOT NULL DEFAULT 'business'"
    )
    op.execute(
        f"ALTER TABLE minutes_templates MODIFY COLUMN meeting_type ENUM({old_enum}) NOT NULL DEFAULT 'business'"
    )
