"""Add dropped member statuses and member_dropped enums

Revision ID: 20260214_0500
Revises: 20260214_0400
Create Date: 2026-02-14

Adds dropped_voluntary and dropped_involuntary to user_status enum.
Adds member_dropped to email_template_type and notification_trigger enums.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '20260214_0500'
down_revision = '20260214_0400'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new UserStatus values
    op.execute("ALTER TABLE users MODIFY COLUMN status ENUM('active','inactive','suspended','probationary','retired','dropped_voluntary','dropped_involuntary') NOT NULL DEFAULT 'active'")

    # Add member_dropped to email template type
    op.execute("ALTER TABLE email_templates MODIFY COLUMN template_type ENUM('welcome','password_reset','event_cancellation','event_reminder','training_approval','ballot_notification','member_dropped','custom') NOT NULL")

    # Add member_dropped to notification trigger
    op.execute("ALTER TABLE notification_rules MODIFY COLUMN `trigger` ENUM('event_reminder','training_expiry','schedule_change','new_member','member_dropped','maintenance_due','election_started','form_submitted','action_item_assigned','meeting_scheduled','document_uploaded') NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE notification_rules MODIFY COLUMN `trigger` ENUM('event_reminder','training_expiry','schedule_change','new_member','maintenance_due','election_started','form_submitted','action_item_assigned','meeting_scheduled','document_uploaded') NOT NULL")
    op.execute("ALTER TABLE email_templates MODIFY COLUMN template_type ENUM('welcome','password_reset','event_cancellation','event_reminder','training_approval','ballot_notification','custom') NOT NULL")
    op.execute("ALTER TABLE users MODIFY COLUMN status ENUM('active','inactive','suspended','probationary','retired') NOT NULL DEFAULT 'active'")
