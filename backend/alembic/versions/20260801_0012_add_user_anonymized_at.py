"""Add users.anonymized_at for the member-anonymization workflow

Set when a departed member's PII has been scrubbed while their operational
history (training, attendance, property custody) is retained. The timestamp
doubles as the flag; NULL means not anonymized.

Revision ID: 20260801_0012
Revises: 20260801_0011
Create Date: 2026-08-01 00:12:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0012"
down_revision = "20260801_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("anonymized_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "anonymized_at")
