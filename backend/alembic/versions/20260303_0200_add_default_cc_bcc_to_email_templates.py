"""Add default_cc/default_bcc to email_templates and bcc_emails to scheduled_emails

Revision ID: 20260303_0200
Revises: 20260303_0100
Create Date: 2026-03-03

Adds per-template default CC and BCC recipient lists so admins can
configure which addresses are automatically included when an email
of that type is sent.  Also adds bcc_emails to the scheduled_emails
table so scheduled sends can carry BCC recipients.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260303_0200"
down_revision = "20260303_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_templates",
        sa.Column("default_cc", sa.JSON(), nullable=True),
    )
    op.add_column(
        "email_templates",
        sa.Column("default_bcc", sa.JSON(), nullable=True),
    )
    op.add_column(
        "scheduled_emails",
        sa.Column("bcc_emails", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scheduled_emails", "bcc_emails")
    op.drop_column("email_templates", "default_bcc")
    op.drop_column("email_templates", "default_cc")
