"""Add scheduled_emails table

Revision ID: 20260301_0200
Revises: 20260301_0100
Create Date: 2026-03-01

Adds the scheduled_emails table for scheduling emails to be sent at a
future date/time. Processed by the scheduled_emails scheduled task.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260301_0200"
down_revision = "20260301_0100"
branch_labels = None
depends_on = None

# All EmailTemplateType values (must match the model enum)
ALL_TEMPLATE_TYPES = (
    "welcome",
    "password_reset",
    "event_cancellation",
    "event_reminder",
    "training_approval",
    "ballot_notification",
    "member_dropped",
    "inventory_change",
    "cert_expiration",
    "post_event_validation",
    "post_shift_validation",
    "property_return_reminder",
    "inactivity_warning",
    "election_rollback",
    "election_deleted",
    "member_archived",
    "event_request_status",
    "it_password_notification",
    "custom",
)

SCHEDULED_STATUSES = ("pending", "sent", "failed", "cancelled")


def upgrade() -> None:
    op.create_table(
        "scheduled_emails",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("email_templates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "template_type",
            sa.Enum(*ALL_TEMPLATE_TYPES, name="emailtemplatetype"),
            nullable=False,
        ),
        sa.Column("to_emails", sa.JSON, nullable=False),
        sa.Column("cc_emails", sa.JSON, nullable=True),
        sa.Column("context", sa.JSON, nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*SCHEDULED_STATUSES, name="scheduledemailstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_scheduled_email_status",
        "scheduled_emails",
        ["status", "scheduled_at"],
    )
    op.create_index(
        "idx_scheduled_email_org",
        "scheduled_emails",
        ["organization_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("idx_scheduled_email_org", table_name="scheduled_emails")
    op.drop_index("idx_scheduled_email_status", table_name="scheduled_emails")
    op.drop_table("scheduled_emails")
    # Only drop the status enum if the DB dialect supports it
    op.execute("DROP TYPE IF EXISTS scheduledemailstatus")
