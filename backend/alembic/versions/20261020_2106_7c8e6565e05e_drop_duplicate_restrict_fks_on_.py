"""Drop the duplicate RESTRICT foreign keys on apparatus user-attribution columns.

Revision ID: 7c8e6565e05e
Revises: 59449acab7ba
Create Date: 2026-10-20 21:06:00

20260214_1700 meant to replace each column's original foreign key to
``users.id`` with an ``ON DELETE SET NULL`` one. Its drop step passed
``constraint_name=None`` inside ``try/except: pass``, so it raised and was
swallowed every time, and the new key was added *beside* the old one. An
upgraded database therefore carries two keys on each column, and the original
one (RESTRICT) wins: deleting a member who ever logged maintenance, fuel, a
status change and so on fails with errno 1451.

``user_deletion_service`` cannot work around this, because it decides which
references to clear from the models, and the models declare these columns
``SET NULL``. A fresh install (``create_all``) has only the SET NULL key, so
this revision is a no-op there.

For each column: if no SET NULL key to ``users.id`` exists, one is created
under 20260214_1700's name; then every other key from that column to
``users.id`` is dropped. Names are read from information_schema because the
originals were unnamed and MySQL generated them.

Downgrade is a deliberate no-op. Restoring the RESTRICT keys would put the
delete failure back, and their generated names were never recorded.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c8e6565e05e"
down_revision: Union[str, None] = "59449acab7ba"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of 20260214_1700's fk_updates list: (table, column, SET NULL name).
_COLUMNS = [
    ("apparatus", "status_changed_by", "fk_apparatus_status_changed_by"),
    ("apparatus", "archived_by", "fk_apparatus_archived_by"),
    ("apparatus", "created_by", "fk_apparatus_created_by"),
    ("apparatus_custom_fields", "created_by", "fk_custom_fields_created_by"),
    ("apparatus_photos", "uploaded_by", "fk_photos_uploaded_by"),
    ("apparatus_documents", "uploaded_by", "fk_documents_uploaded_by"),
    ("apparatus_maintenance", "completed_by", "fk_maintenance_completed_by"),
    ("apparatus_maintenance", "created_by", "fk_maintenance_created_by"),
    ("apparatus_fuel_logs", "recorded_by", "fk_fuel_logs_recorded_by"),
    ("apparatus_operators", "certified_by", "fk_operators_certified_by"),
    ("apparatus_operators", "created_by", "fk_operators_created_by"),
    ("apparatus_equipment", "assigned_by", "fk_equipment_assigned_by"),
    ("apparatus_location_history", "created_by", "fk_location_history_created_by"),
    ("apparatus_status_history", "changed_by", "fk_status_history_changed_by"),
    ("apparatus_nfpa_compliance", "last_checked_by", "fk_nfpa_last_checked_by"),
    ("apparatus_report_configs", "created_by", "fk_report_configs_created_by"),
    (
        "apparatus_service_providers",
        "archived_by",
        "fk_service_providers_archived_by",
    ),
    (
        "apparatus_service_providers",
        "created_by",
        "fk_service_providers_created_by",
    ),
    ("apparatus_components", "created_by", "fk_components_created_by"),
    ("apparatus_component_notes", "reported_by", "fk_component_notes_reported_by"),
    ("apparatus_component_notes", "resolved_by", "fk_component_notes_resolved_by"),
]


def _user_fks(table: str, column: str) -> list[tuple[str, str]]:
    """(constraint name, delete rule) of every key from table.column to users.id."""
    rows = op.get_bind().execute(
        sa.text(
            "SELECT k.constraint_name, r.delete_rule "
            "FROM information_schema.key_column_usage k "
            "JOIN information_schema.referential_constraints r "
            "  ON r.constraint_schema = k.constraint_schema "
            " AND r.constraint_name = k.constraint_name "
            " AND r.table_name = k.table_name "
            "WHERE k.table_schema = DATABASE() "
            "  AND k.table_name = :table AND k.column_name = :column "
            "  AND k.referenced_table_name = 'users' "
            "  AND k.referenced_column_name = 'id'"
        ),
        {"table": table, "column": column},
    )
    return [(row[0], row[1]) for row in rows]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, set_null_name in _COLUMNS:
        if not inspector.has_table(table):
            continue
        if column not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        keys = _user_fks(table, column)
        if not any(rule == "SET NULL" for _, rule in keys):
            op.create_foreign_key(
                set_null_name, table, "users", [column], ["id"], ondelete="SET NULL"
            )
        for name, rule in keys:
            if rule != "SET NULL":
                op.drop_constraint(name, table, type_="foreignkey")


def downgrade() -> None:
    """Deliberately irreversible; see the module docstring.

    The dropped keys only blocked member deletion, which the models never
    intended, and their MySQL-generated names were not recorded.
    """
    return
