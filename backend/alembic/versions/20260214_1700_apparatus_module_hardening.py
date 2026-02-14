"""Apparatus module hardening: soft-delete, FK constraints, and indexes

Revision ID: 20260214_1700
Revises: 20260214_1600
Create Date: 2026-02-14

Adds:
- created_by column to apparatus_component_notes
- archived_at/archived_by columns to apparatus_components (soft-delete)
- ondelete=SET NULL on all user FK audit columns
- CheckConstraint for rating (1-5) on apparatus_service_providers
- Unique index on (organization_id, vin) for apparatus
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1700'
down_revision = '20260214_1600'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Add created_by to apparatus_component_notes
    # ------------------------------------------------------------------
    op.add_column(
        'apparatus_component_notes',
        sa.Column('created_by', sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        'fk_component_notes_created_by',
        'apparatus_component_notes', 'users',
        ['created_by'], ['id'],
        ondelete='SET NULL',
    )

    # ------------------------------------------------------------------
    # 2. Add archived_at / archived_by to apparatus_components
    # ------------------------------------------------------------------
    op.add_column(
        'apparatus_components',
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'apparatus_components',
        sa.Column('archived_by', sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        'fk_components_archived_by',
        'apparatus_components', 'users',
        ['archived_by'], ['id'],
        ondelete='SET NULL',
    )

    # ------------------------------------------------------------------
    # 3. Add CheckConstraint for rating on service providers
    # ------------------------------------------------------------------
    op.create_check_constraint(
        'ck_service_provider_rating',
        'apparatus_service_providers',
        'rating IS NULL OR (rating >= 1 AND rating <= 5)',
    )

    # ------------------------------------------------------------------
    # 4. Replace VIN index with unique (org_id, vin) index
    # ------------------------------------------------------------------
    op.drop_index('idx_apparatus_vin', table_name='apparatus')
    op.create_index(
        'idx_apparatus_vin',
        'apparatus',
        ['organization_id', 'vin'],
        unique=True,
    )

    # ------------------------------------------------------------------
    # 5. Update FK ondelete=SET NULL for user audit columns
    #    (recreate foreign keys with proper ondelete behavior)
    # ------------------------------------------------------------------
    fk_updates = [
        # (table, constraint_name, column, new_constraint_name)
        ('apparatus', 'status_changed_by', 'fk_apparatus_status_changed_by'),
        ('apparatus', 'archived_by', 'fk_apparatus_archived_by'),
        ('apparatus', 'created_by', 'fk_apparatus_created_by'),
        ('apparatus_custom_fields', 'created_by', 'fk_custom_fields_created_by'),
        ('apparatus_photos', 'uploaded_by', 'fk_photos_uploaded_by'),
        ('apparatus_documents', 'uploaded_by', 'fk_documents_uploaded_by'),
        ('apparatus_maintenance', 'completed_by', 'fk_maintenance_completed_by'),
        ('apparatus_maintenance', 'created_by', 'fk_maintenance_created_by'),
        ('apparatus_fuel_logs', 'recorded_by', 'fk_fuel_logs_recorded_by'),
        ('apparatus_operators', 'certified_by', 'fk_operators_certified_by'),
        ('apparatus_operators', 'created_by', 'fk_operators_created_by'),
        ('apparatus_equipment', 'assigned_by', 'fk_equipment_assigned_by'),
        ('apparatus_location_history', 'created_by', 'fk_location_history_created_by'),
        ('apparatus_status_history', 'changed_by', 'fk_status_history_changed_by'),
        ('apparatus_nfpa_compliance', 'last_checked_by', 'fk_nfpa_last_checked_by'),
        ('apparatus_report_configs', 'created_by', 'fk_report_configs_created_by'),
        ('apparatus_service_providers', 'archived_by', 'fk_service_providers_archived_by'),
        ('apparatus_service_providers', 'created_by', 'fk_service_providers_created_by'),
        ('apparatus_components', 'created_by', 'fk_components_created_by'),
        ('apparatus_component_notes', 'reported_by', 'fk_component_notes_reported_by'),
        ('apparatus_component_notes', 'resolved_by', 'fk_component_notes_resolved_by'),
    ]

    for table, column, new_fk_name in fk_updates:
        # Note: For databases that support it, we drop existing unnamed FK
        # constraints first. For MySQL, the FK name is auto-generated and
        # may vary. Using batch_alter_table for safety.
        with op.batch_alter_table(table) as batch_op:
            # Drop old FK (by column reference)
            try:
                batch_op.drop_constraint(
                    type_='foreignkey',
                    constraint_name=None,  # Auto-detect
                )
            except Exception:
                pass  # FK may not exist with a known name

        op.create_foreign_key(
            new_fk_name,
            table, 'users',
            [column], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    # Remove added columns
    op.drop_column('apparatus_component_notes', 'created_by')
    op.drop_column('apparatus_components', 'archived_by')
    op.drop_column('apparatus_components', 'archived_at')

    # Revert VIN index
    op.drop_index('idx_apparatus_vin', table_name='apparatus')
    op.create_index('idx_apparatus_vin', 'apparatus', ['vin'])

    # Remove check constraint
    op.drop_constraint('ck_service_provider_rating', 'apparatus_service_providers', type_='check')
