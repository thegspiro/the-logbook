"""Add maintenance attachments and historic repair support

Revision ID: 20260214_1800
Revises: 20260214_1700
Create Date: 2026-02-14

Adds to apparatus_maintenance:
- attachments (JSON) — file references for photos, invoices, email chains
- is_historic (Boolean) — marks back-dated entries from before system adoption
- occurred_date (Date) — actual date work was performed
- historic_source (String) — provenance of the record (e.g. paper logbook)
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1800'
down_revision = '20260214_1700'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'apparatus_maintenance',
        sa.Column('attachments', sa.JSON(), nullable=True),
    )
    op.add_column(
        'apparatus_maintenance',
        sa.Column('is_historic', sa.Boolean(), nullable=False, server_default=sa.text('0')),
    )
    op.add_column(
        'apparatus_maintenance',
        sa.Column('occurred_date', sa.Date(), nullable=True),
    )
    op.add_column(
        'apparatus_maintenance',
        sa.Column('historic_source', sa.String(200), nullable=True),
    )

    op.create_index(
        'idx_apparatus_maint_historic', 'apparatus_maintenance', ['is_historic'],
    )
    op.create_index(
        'idx_apparatus_maint_occurred', 'apparatus_maintenance', ['occurred_date'],
    )


def downgrade() -> None:
    op.drop_index('idx_apparatus_maint_occurred', table_name='apparatus_maintenance')
    op.drop_index('idx_apparatus_maint_historic', table_name='apparatus_maintenance')
    op.drop_column('apparatus_maintenance', 'historic_source')
    op.drop_column('apparatus_maintenance', 'occurred_date')
    op.drop_column('apparatus_maintenance', 'is_historic')
    op.drop_column('apparatus_maintenance', 'attachments')
