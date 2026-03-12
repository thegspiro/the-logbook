"""create message_history table

Revision ID: 20260308_0300
Revises: 20260308_0200
Create Date: 2026-03-08 03:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260308_0300"
down_revision = "20260308_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "message_history",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("to_email", sa.String(320), nullable=False),
        sa.Column("cc_emails", sa.JSON, nullable=True),
        sa.Column("bcc_emails", sa.JSON, nullable=True),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("template_type", sa.String(50), nullable=True),
        sa.Column(
            "status",
            sa.Enum("sent", "failed", name="messagehistorystatus"),
            nullable=False,
            server_default="sent",
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("recipient_count", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "sent_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_message_history_org", "message_history", ["organization_id", "sent_at"]
    )
    op.create_index(
        "idx_message_history_status", "message_history", ["status", "sent_at"]
    )


def downgrade() -> None:
    op.drop_index("idx_message_history_status", table_name="message_history")
    op.drop_index("idx_message_history_org", table_name="message_history")
    op.drop_table("message_history")
    op.execute("DROP TYPE IF EXISTS messagehistorystatus")
