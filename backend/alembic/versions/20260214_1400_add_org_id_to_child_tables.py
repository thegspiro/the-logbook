"""Add organization_id FK to child tables for tenant isolation

Revision ID: 20260214_1400
Revises: 20260214_1300
Create Date: 2026-02-14

Adds organization_id foreign key to:
- event_rsvps (was only reachable via events.organization_id)
- meeting_attendees (was only reachable via meetings.organization_id)
- voting_tokens (was only reachable via elections.organization_id)

This provides defense-in-depth for multi-tenant data isolation,
ensuring that even direct queries on these child tables enforce
organization boundaries at the database level.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1400'
down_revision = '20260214_1300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- event_rsvps ---
    op.add_column(
        'event_rsvps',
        sa.Column('organization_id', sa.String(36), nullable=True),
    )
    # Backfill from parent events table
    op.execute(
        "UPDATE event_rsvps r "
        "JOIN events e ON r.event_id = e.id "
        "SET r.organization_id = e.organization_id"
    )
    op.alter_column('event_rsvps', 'organization_id', nullable=False, existing_type=sa.String(36))
    op.create_foreign_key(
        'fk_event_rsvps_organization_id',
        'event_rsvps', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index('ix_event_rsvps_organization_id', 'event_rsvps', ['organization_id'])

    # --- meeting_attendees ---
    op.add_column(
        'meeting_attendees',
        sa.Column('organization_id', sa.String(36), nullable=True),
    )
    # Backfill from parent meetings table
    op.execute(
        "UPDATE meeting_attendees a "
        "JOIN meetings m ON a.meeting_id = m.id "
        "SET a.organization_id = m.organization_id"
    )
    op.alter_column('meeting_attendees', 'organization_id', nullable=False, existing_type=sa.String(36))
    op.create_foreign_key(
        'fk_meeting_attendees_organization_id',
        'meeting_attendees', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index('idx_meeting_attendees_organization', 'meeting_attendees', ['organization_id'])

    # --- voting_tokens ---
    op.add_column(
        'voting_tokens',
        sa.Column('organization_id', sa.String(36), nullable=True),
    )
    # Backfill from parent elections table
    op.execute(
        "UPDATE voting_tokens vt "
        "JOIN elections el ON vt.election_id = el.id "
        "SET vt.organization_id = el.organization_id"
    )
    op.alter_column('voting_tokens', 'organization_id', nullable=False, existing_type=sa.String(36))
    op.create_foreign_key(
        'fk_voting_tokens_organization_id',
        'voting_tokens', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index('ix_voting_tokens_organization_id', 'voting_tokens', ['organization_id'])


def downgrade() -> None:
    # --- voting_tokens ---
    op.drop_index('ix_voting_tokens_organization_id', table_name='voting_tokens')
    op.drop_constraint('fk_voting_tokens_organization_id', 'voting_tokens', type_='foreignkey')
    op.drop_column('voting_tokens', 'organization_id')

    # --- meeting_attendees ---
    op.drop_index('idx_meeting_attendees_organization', table_name='meeting_attendees')
    op.drop_constraint('fk_meeting_attendees_organization_id', 'meeting_attendees', type_='foreignkey')
    op.drop_column('meeting_attendees', 'organization_id')

    # --- event_rsvps ---
    op.drop_index('ix_event_rsvps_organization_id', table_name='event_rsvps')
    op.drop_constraint('fk_event_rsvps_organization_id', 'event_rsvps', type_='foreignkey')
    op.drop_column('event_rsvps', 'organization_id')
