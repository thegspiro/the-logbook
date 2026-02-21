"""Add updated_by audit fields to events, event_templates, event_external_attendees

Adds updated_by tracking so modifications can be attributed to specific users.
Also adds updated_at to event_external_attendees for modification tracking.

Revision ID: 20260221_0400
Revises: 20260221_0300
Create Date: 2026-02-21
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "20260221_0400"
down_revision = "20260221_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("updated_by", sa.String(36), nullable=True))
    op.add_column("event_templates", sa.Column("updated_by", sa.String(36), nullable=True))
    op.add_column("event_external_attendees", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("event_external_attendees", sa.Column("updated_by", sa.String(36), nullable=True))


def downgrade() -> None:
    op.drop_column("event_external_attendees", "updated_by")
    op.drop_column("event_external_attendees", "updated_at")
    op.drop_column("event_templates", "updated_by")
    op.drop_column("events", "updated_by")
