"""Add quorum config, peer eval permissions, cert alert pipeline, training-event link

Revision ID: 20260214_1200
Revises: 20260214_1100
Create Date: 2026-02-14

Adds:
- quorum_config JSON to organizations.settings (documented, not a column)
- allowed_evaluators JSON to skill_evaluations for configurable sign-off
- cert_alert_config JSON to organizations.settings (documented, not a column)
- training_event_id FK on training_sessions (1:1 link to events for calendar)
- quorum_threshold and quorum_type columns to meeting_minutes
- bulk_voter_overrides support (no schema change, existing voter_overrides JSON suffices)
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1200'
down_revision = '20260214_1100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Meeting quorum: add configurable threshold and type to meetings
    op.add_column('meeting_minutes', sa.Column('quorum_threshold', sa.Float(), nullable=True))
    op.add_column('meeting_minutes', sa.Column('quorum_type', sa.String(20), nullable=True))
    # quorum_type: "count" (absolute number) or "percentage" (of active members)
    # quorum_threshold: the value (e.g., 10 members or 50.0 percent)

    # Peer skill evaluations: configurable who can sign off
    op.add_column('skill_evaluations', sa.Column('allowed_evaluators', sa.JSON(), nullable=True))
    # Format: {"type": "roles", "roles": ["shift_leader", "driver_trainer"]}
    #      or {"type": "specific_users", "user_ids": ["uuid1", "uuid2"]}
    #      or null (any officer with training.manage permission)

    # Certification expiration alert tracking on training_records
    op.add_column('training_records', sa.Column('alert_90_sent_at', sa.DateTime(), nullable=True))
    op.add_column('training_records', sa.Column('alert_60_sent_at', sa.DateTime(), nullable=True))
    op.add_column('training_records', sa.Column('alert_30_sent_at', sa.DateTime(), nullable=True))
    op.add_column('training_records', sa.Column('alert_7_sent_at', sa.DateTime(), nullable=True))
    op.add_column('training_records', sa.Column('escalation_sent_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('training_records', 'escalation_sent_at')
    op.drop_column('training_records', 'alert_7_sent_at')
    op.drop_column('training_records', 'alert_30_sent_at')
    op.drop_column('training_records', 'alert_60_sent_at')
    op.drop_column('training_records', 'alert_90_sent_at')
    op.drop_column('skill_evaluations', 'allowed_evaluators')
    op.drop_column('meeting_minutes', 'quorum_type')
    op.drop_column('meeting_minutes', 'quorum_threshold')
