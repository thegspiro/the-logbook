"""Sync email_template_type enum with Python model

Revision ID: 20260301_0100
Revises: 20260228_0100
Create Date: 2026-03-01

The EmailTemplateType Python enum was extended with 11 new values
(inventory_change, cert_expiration, post_event_validation,
post_shift_validation, property_return_reminder, inactivity_warning,
election_rollback, election_deleted, member_archived,
event_request_status, it_password_notification) but the MySQL ENUM
column was never updated past the 20260214_0500 migration. This
caused a DataError when ensure_default_templates tried to insert
templates with the newer types.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260301_0100"
down_revision = "20260228_0100"
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
    "custom",
)

# Previous set (from migration 20260214_0500)
OLD_TYPES = (
    "welcome",
    "password_reset",
    "event_cancellation",
    "event_reminder",
    "training_approval",
    "ballot_notification",
    "member_dropped",
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
