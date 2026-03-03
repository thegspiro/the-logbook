"""Add duplicate_application to email template_type enum

Revision ID: 20260303_0100
Revises: 20260301_0200
Create Date: 2026-03-03

The duplicate_application value was added to the Python EmailTemplateType
enum and used in ensure_default_templates, but was missing from the MySQL
ENUM column definition, causing a DataError (1265) on insert.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260303_0100"
down_revision = "20260301_0200"
branch_labels = None
depends_on = None

# Complete list matching EmailTemplateType in models/email_template.py
ALL_TYPES = (
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
    "duplicate_application",
    "custom",
)

# Previous set (from migration 20260301_0100, missing duplicate_application)
OLD_TYPES = (
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


def upgrade() -> None:
    enum_values = ",".join(f"'{v}'" for v in ALL_TYPES)
    op.execute(
        f"ALTER TABLE email_templates MODIFY COLUMN template_type ENUM({enum_values}) NOT NULL"
    )


def downgrade() -> None:
    enum_values = ",".join(f"'{v}'" for v in OLD_TYPES)
    op.execute(
        f"ALTER TABLE email_templates MODIFY COLUMN template_type ENUM({enum_values}) NOT NULL"
    )
