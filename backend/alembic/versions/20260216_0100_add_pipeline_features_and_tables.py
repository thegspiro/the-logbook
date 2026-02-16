"""Add pipeline features: is_active, inactivity_config, step config, documents, election packages

Adds new columns to membership_pipelines and membership_pipeline_steps,
and creates prospect_documents and prospect_election_packages tables.

Revision ID: 20260216_0100
Revises: 20260215_0200
Create Date: 2026-02-16
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260216_0100'
down_revision = '20260215_0200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Add columns to membership_pipelines ---
    op.add_column('membership_pipelines', sa.Column('is_active', sa.Boolean, server_default='1', nullable=False))
    op.add_column('membership_pipelines', sa.Column('inactivity_config', sa.JSON, nullable=True))
    op.create_index('idx_pipeline_org_active', 'membership_pipelines', ['organization_id', 'is_active'])

    # --- Add columns to membership_pipeline_steps ---
    op.add_column('membership_pipeline_steps', sa.Column('config', sa.JSON, nullable=True))
    op.add_column('membership_pipeline_steps', sa.Column('inactivity_timeout_days', sa.Integer, nullable=True))

    # --- Create prospect_documents table ---
    op.create_table(
        'prospect_documents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('prospect_id', sa.String(36), sa.ForeignKey('prospective_members.id', ondelete='CASCADE'), nullable=False),
        sa.Column('step_id', sa.String(36), sa.ForeignKey('membership_pipeline_steps.id', ondelete='SET NULL'), nullable=True),
        sa.Column('document_type', sa.String(100), nullable=False),
        sa.Column('file_name', sa.String(500), nullable=False),
        sa.Column('file_path', sa.String(1000), nullable=False),
        sa.Column('file_size', sa.Integer, server_default='0'),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('uploaded_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_prospect_doc_prospect', 'prospect_documents', ['prospect_id'])
    op.create_index('idx_prospect_doc_type', 'prospect_documents', ['document_type'])

    # --- Create prospect_election_packages table ---
    op.create_table(
        'prospect_election_packages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('prospect_id', sa.String(36), sa.ForeignKey('prospective_members.id', ondelete='CASCADE'), nullable=False),
        sa.Column('pipeline_id', sa.String(36), sa.ForeignKey('membership_pipelines.id', ondelete='SET NULL'), nullable=True),
        sa.Column('step_id', sa.String(36), sa.ForeignKey('membership_pipeline_steps.id', ondelete='SET NULL'), nullable=True),
        sa.Column('election_id', sa.String(36), nullable=True),
        sa.Column('status', sa.String(50), server_default='draft', nullable=False),
        sa.Column('applicant_snapshot', sa.JSON, nullable=True),
        sa.Column('coordinator_notes', sa.Text, nullable=True),
        sa.Column('package_config', sa.JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_election_pkg_prospect', 'prospect_election_packages', ['prospect_id'])
    op.create_index('idx_election_pkg_status', 'prospect_election_packages', ['status'])
    op.create_index('idx_election_pkg_pipeline', 'prospect_election_packages', ['pipeline_id'])

    print("Added pipeline features: is_active, inactivity_config, step config, prospect_documents, prospect_election_packages")


def downgrade() -> None:
    op.drop_table('prospect_election_packages')
    op.drop_table('prospect_documents')

    op.drop_column('membership_pipeline_steps', 'inactivity_timeout_days')
    op.drop_column('membership_pipeline_steps', 'config')

    op.drop_index('idx_pipeline_org_active', table_name='membership_pipelines')
    op.drop_column('membership_pipelines', 'inactivity_config')
    op.drop_column('membership_pipelines', 'is_active')

    print("Reverted pipeline features")
