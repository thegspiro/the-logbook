"""Add missing model columns and tables across the application

Revision ID: 20260218_0300
Revises: 20260218_0200
Create Date: 2026-02-18

Adds columns and tables that exist in SQLAlchemy models but were never
added via migration. These work on fresh installs (Base.metadata.create_all)
but cause OperationalError on migrated databases.

Missing items:
- events table: 6 recurrence/template columns
- event_templates table: entire table (25 columns)
- elections table: voter_anonymity_salt column
- membership_pipelines table: is_active, inactivity_config columns
- membership_pipeline_steps table: config, inactivity_timeout_days columns
- prospect_documents table: entire table
- prospect_election_packages table: entire table
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260218_0300'
down_revision = '20260218_0200'
branch_labels = None
depends_on = None


def _column_exists(conn, table, column):
    """Check if a column already exists (idempotent for fast-path databases)."""
    result = conn.execute(sa.text("""
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table
        AND COLUMN_NAME = :column
    """), {"table": table, "column": column})
    return result.scalar() > 0


def _table_exists(conn, table):
    """Check if a table already exists."""
    result = conn.execute(sa.text("""
        SELECT COUNT(*)
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table
    """), {"table": table})
    return result.scalar() > 0


def upgrade() -> None:
    conn = op.get_bind()

    # ─── events: recurrence and template columns ───────────────────────

    if not _column_exists(conn, 'events', 'is_recurring'):
        op.add_column('events', sa.Column(
            'is_recurring', sa.Boolean(), nullable=False,
            server_default=sa.text('0'),
        ))

    if not _column_exists(conn, 'events', 'recurrence_pattern'):
        op.add_column('events', sa.Column(
            'recurrence_pattern',
            sa.Enum('daily', 'weekly', 'biweekly', 'monthly', 'custom',
                    name='recurrencepattern'),
            nullable=True,
        ))

    if not _column_exists(conn, 'events', 'recurrence_end_date'):
        op.add_column('events', sa.Column(
            'recurrence_end_date', sa.DateTime(), nullable=True,
        ))

    if not _column_exists(conn, 'events', 'recurrence_custom_days'):
        op.add_column('events', sa.Column(
            'recurrence_custom_days', sa.JSON(), nullable=True,
        ))

    if not _column_exists(conn, 'events', 'recurrence_parent_id'):
        op.add_column('events', sa.Column(
            'recurrence_parent_id', sa.String(36), nullable=True,
        ))
        # Add FK and index only if we just added the column
        op.create_foreign_key(
            'fk_events_recurrence_parent_id',
            'events', 'events',
            ['recurrence_parent_id'], ['id'],
        )
        op.create_index(
            'ix_events_recurrence_parent_id',
            'events', ['recurrence_parent_id'],
        )

    # template_id depends on event_templates existing, so create that first
    # (see below), then add the column.

    # ─── event_templates: entire table ─────────────────────────────────

    if not _table_exists(conn, 'event_templates'):
        op.create_table(
            'event_templates',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('organization_id', sa.String(36),
                      sa.ForeignKey('organizations.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('name', sa.String(200), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('event_type',
                      sa.Enum('business_meeting', 'public_education',
                              'training', 'social', 'fundraiser',
                              'ceremony', 'other', name='eventtype_tmpl'),
                      nullable=False, server_default='other'),
            sa.Column('default_title', sa.String(200), nullable=True),
            sa.Column('default_description', sa.Text(), nullable=True),
            sa.Column('default_location_id', sa.String(36),
                      sa.ForeignKey('locations.id'), nullable=True),
            sa.Column('default_location', sa.String(300), nullable=True),
            sa.Column('default_location_details', sa.Text(), nullable=True),
            sa.Column('default_duration_minutes', sa.Integer(), nullable=True),
            sa.Column('requires_rsvp', sa.Boolean(), nullable=False,
                      server_default=sa.text('0')),
            sa.Column('max_attendees', sa.Integer(), nullable=True),
            sa.Column('is_mandatory', sa.Boolean(), nullable=False,
                      server_default=sa.text('0')),
            sa.Column('eligible_roles', sa.JSON(), nullable=True),
            sa.Column('allow_guests', sa.Boolean(), nullable=False,
                      server_default=sa.text('0')),
            sa.Column('check_in_window_type',
                      sa.Enum('flexible', 'strict', 'window',
                              name='checkinwindowtype_tmpl'),
                      nullable=True),
            sa.Column('check_in_minutes_before', sa.Integer(), nullable=True,
                      server_default='30'),
            sa.Column('check_in_minutes_after', sa.Integer(), nullable=True,
                      server_default='15'),
            sa.Column('require_checkout', sa.Boolean(), nullable=False,
                      server_default=sa.text('0')),
            sa.Column('send_reminders', sa.Boolean(), nullable=False,
                      server_default=sa.text('1')),
            sa.Column('reminder_hours_before', sa.Integer(), nullable=False,
                      server_default='24'),
            sa.Column('custom_fields_template', sa.JSON(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False,
                      server_default=sa.text('1')),
            sa.Column('created_by', sa.String(36),
                      sa.ForeignKey('users.id'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False,
                      server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False,
                      server_default=sa.func.now()),
        )
        op.create_index('ix_event_templates_organization_id',
                        'event_templates', ['organization_id'])

    # Now add template_id to events (needs event_templates to exist for FK)
    if not _column_exists(conn, 'events', 'template_id'):
        op.add_column('events', sa.Column(
            'template_id', sa.String(36), nullable=True,
        ))
        op.create_foreign_key(
            'fk_events_template_id',
            'events', 'event_templates',
            ['template_id'], ['id'],
        )

    # ─── elections: voter_anonymity_salt ────────────────────────────────

    if not _column_exists(conn, 'elections', 'voter_anonymity_salt'):
        op.add_column('elections', sa.Column(
            'voter_anonymity_salt', sa.String(64), nullable=True,
        ))

    # ─── membership_pipelines: is_active, inactivity_config ────────────

    if not _column_exists(conn, 'membership_pipelines', 'is_active'):
        op.add_column('membership_pipelines', sa.Column(
            'is_active', sa.Boolean(), server_default=sa.text('1'),
            nullable=True,
        ))
        op.create_index('ix_membership_pipelines_is_active',
                        'membership_pipelines', ['is_active'])

    if not _column_exists(conn, 'membership_pipelines', 'inactivity_config'):
        op.add_column('membership_pipelines', sa.Column(
            'inactivity_config', sa.JSON(), nullable=True,
        ))

    # ─── membership_pipeline_steps: config, inactivity_timeout_days ────

    if not _column_exists(conn, 'membership_pipeline_steps', 'config'):
        op.add_column('membership_pipeline_steps', sa.Column(
            'config', sa.JSON(), nullable=True,
        ))

    if not _column_exists(conn, 'membership_pipeline_steps', 'inactivity_timeout_days'):
        op.add_column('membership_pipeline_steps', sa.Column(
            'inactivity_timeout_days', sa.Integer(), nullable=True,
        ))

    # ─── prospect_documents: entire table ──────────────────────────────

    if not _table_exists(conn, 'prospect_documents'):
        op.create_table(
            'prospect_documents',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('prospect_id', sa.String(36),
                      sa.ForeignKey('prospective_members.id',
                                    ondelete='CASCADE'),
                      nullable=False),
            sa.Column('step_id', sa.String(36),
                      sa.ForeignKey('membership_pipeline_steps.id',
                                    ondelete='SET NULL'),
                      nullable=True),
            sa.Column('document_type', sa.String(100), nullable=False),
            sa.Column('file_name', sa.String(255), nullable=False),
            sa.Column('file_path', sa.String(500), nullable=False),
            sa.Column('file_size', sa.Integer(), server_default='0'),
            sa.Column('mime_type', sa.String(100), nullable=True),
            sa.Column('uploaded_by', sa.String(36),
                      sa.ForeignKey('users.id', ondelete='SET NULL'),
                      nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
        )
        op.create_index('idx_prospect_doc_prospect',
                        'prospect_documents', ['prospect_id'])

    # ─── prospect_election_packages: entire table ──────────────────────

    if not _table_exists(conn, 'prospect_election_packages'):
        op.create_table(
            'prospect_election_packages',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('prospect_id', sa.String(36),
                      sa.ForeignKey('prospective_members.id',
                                    ondelete='CASCADE'),
                      nullable=False),
            sa.Column('pipeline_id', sa.String(36),
                      sa.ForeignKey('membership_pipelines.id',
                                    ondelete='SET NULL'),
                      nullable=True),
            sa.Column('step_id', sa.String(36),
                      sa.ForeignKey('membership_pipeline_steps.id',
                                    ondelete='SET NULL'),
                      nullable=True),
            sa.Column('election_id', sa.String(36),
                      sa.ForeignKey('elections.id', ondelete='SET NULL'),
                      nullable=True),
            sa.Column('status', sa.String(20), nullable=False,
                      server_default='draft'),
            sa.Column('applicant_snapshot', sa.JSON(), nullable=True),
            sa.Column('coordinator_notes', sa.Text(), nullable=True),
            sa.Column('package_config', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
        )
        op.create_index('idx_election_pkg_prospect',
                        'prospect_election_packages', ['prospect_id'])
        op.create_index('idx_election_pkg_status',
                        'prospect_election_packages', ['status'])


def downgrade() -> None:
    # Drop tables first (they reference other tables via FK)
    op.drop_table('prospect_election_packages')
    op.drop_table('prospect_documents')

    # Drop added columns
    op.drop_column('membership_pipeline_steps', 'inactivity_timeout_days')
    op.drop_column('membership_pipeline_steps', 'config')

    op.drop_index('ix_membership_pipelines_is_active',
                  table_name='membership_pipelines')
    op.drop_column('membership_pipelines', 'inactivity_config')
    op.drop_column('membership_pipelines', 'is_active')

    op.drop_column('elections', 'voter_anonymity_salt')

    op.drop_constraint('fk_events_template_id', 'events', type_='foreignkey')
    op.drop_column('events', 'template_id')

    op.drop_table('event_templates')

    op.drop_index('ix_events_recurrence_parent_id', table_name='events')
    op.drop_constraint('fk_events_recurrence_parent_id', 'events',
                       type_='foreignkey')
    op.drop_column('events', 'recurrence_parent_id')
    op.drop_column('events', 'recurrence_custom_days')
    op.drop_column('events', 'recurrence_end_date')
    op.drop_column('events', 'recurrence_pattern')
    op.drop_column('events', 'is_recurring')
