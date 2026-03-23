"""Sync email_template_type enum — add shift_assignment and shift_reminder

Revision ID: 20260323_0100
Revises: 20260321_0300
Create Date: 2026-03-23

Adds shift_assignment and shift_reminder to the MySQL ENUM column, and
also catches up election_report, ballot_eligibility_summary,
series_end_reminder, and shift_decline which were added to the Python
enum but never synced to the database column.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260323_0100"
down_revision = ("20260321_0300",)
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
    "election_report",
    "ballot_eligibility_summary",
    "election_rollback",
    "election_deleted",
    "member_archived",
    "event_request_status",
    "it_password_notification",
    "duplicate_application",
    "series_end_reminder",
    "shift_decline",
    "shift_assignment",
    "shift_reminder",
    "custom",
)

# Previous set (from migration 20260303_0100)
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
    "duplicate_application",
    "custom",
)


def upgrade() -> None:
    enum_values = ",".join(f"'{v}'" for v in ALL_TYPES)
    op.execute(
        f"ALTER TABLE email_templates MODIFY COLUMN template_type"
        f" ENUM({enum_values}) NOT NULL"
    )


def downgrade() -> None:
    enum_values = ",".join(f"'{v}'" for v in OLD_TYPES)
    op.execute(
        f"ALTER TABLE email_templates MODIFY COLUMN template_type"
        f" ENUM({enum_values}) NOT NULL"
    )
