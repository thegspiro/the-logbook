"""Add user_consents table (ISO/IEC 27701 consent tracking)

Current-state consent per (user, type); the change history lives in the
tamper-evident audit log as ``consent_updated`` events.

Revision ID: 20260801_0014
Revises: 20260801_0013
Create Date: 2026-08-01 00:14:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0014"
down_revision = "20260801_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_consents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "consent_type",
            sa.Enum(
                "photo_use",
                "public_roster_listing",
                "sms_notifications",
                name="consenttype",
            ),
            nullable=False,
        ),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "idx_user_consent_unique",
        "user_consents",
        ["user_id", "consent_type"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_user_consent_unique", table_name="user_consents")
    op.drop_table("user_consents")
