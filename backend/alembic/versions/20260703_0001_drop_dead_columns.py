"""Drop dead/vestigial columns across non-training tables

These columns were defined on their models but never read or written anywhere
in the codebase (verified via a dead-code review). Removing them keeps the
schema in sync with the models after the corresponding model definitions were
deleted.

Dropped:
- audit_logs: sensitive_data_encrypted, server_id, process_id
- audit_log_checkpoints: verification_status, verification_details
- users: email_verified_at (email-verification flow never wired up; the paired
  email_verified boolean is kept)
- prospects: application_date, converted_to_user_id (FK), converted_at
  (conversion tracking superseded by the membership_pipeline module)
- sessions: device_info
- donations: receipt_sent_at, thank_you_sent_at (the paired *_sent booleans
  are kept)
- ip_exceptions: cidr_range (CIDR-range support never implemented)
- blocked_access_attempts: request_headers

Drops are guarded by an existence check so the migration is safe to run on
databases where a column may already be absent. converted_to_user_id carries a
MySQL auto-named FK, discovered and dropped via the inspector before the
column drop.

Revision ID: 20260703_0001
Revises: 20260702_0001
Create Date: 2026-07-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260703_0001"
down_revision = "20260702_0001"
branch_labels = None
depends_on = None


# Plain columns (no FK). (table, column, type-factory for downgrade re-add)
DEAD_COLUMNS = [
    ("audit_logs", "sensitive_data_encrypted", lambda: sa.Text()),
    ("audit_logs", "server_id", lambda: sa.String(length=100)),
    ("audit_logs", "process_id", lambda: sa.Integer()),
    ("audit_log_checkpoints", "verification_status", lambda: sa.String(length=20)),
    ("audit_log_checkpoints", "verification_details", lambda: sa.JSON()),
    ("users", "email_verified_at", lambda: sa.DateTime(timezone=True)),
    ("prospects", "application_date", lambda: sa.DateTime(timezone=True)),
    ("prospects", "converted_at", lambda: sa.DateTime(timezone=True)),
    ("sessions", "device_info", lambda: sa.JSON()),
    ("donations", "receipt_sent_at", lambda: sa.DateTime(timezone=True)),
    ("donations", "thank_you_sent_at", lambda: sa.DateTime(timezone=True)),
    ("ip_exceptions", "cidr_range", lambda: sa.String(length=50)),
    ("blocked_access_attempts", "request_headers", lambda: sa.Text()),
]

# FK column handled separately (drop constraint first).
FK_TABLE = "prospects"
FK_COLUMN = "converted_to_user_id"


def _has_column(inspector, table: str, column: str) -> bool:
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def _drop_user_fks(inspector, table: str, column: str) -> None:
    for fk in inspector.get_foreign_keys(table):
        if fk.get("referred_table") == "users" and fk.get(
            "constrained_columns"
        ) == [column]:
            name = fk.get("name")
            if name:
                op.drop_constraint(name, table, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, _type in DEAD_COLUMNS:
        if _has_column(inspector, table, column):
            op.drop_column(table, column)

    # FK column: drop the (auto-named) constraint, then the column.
    inspector.clear_cache()
    if _has_column(inspector, FK_TABLE, FK_COLUMN):
        _drop_user_fks(inspector, FK_TABLE, FK_COLUMN)
        op.drop_column(FK_TABLE, FK_COLUMN)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, type_factory in DEAD_COLUMNS:
        if not _has_column(inspector, table, column):
            op.add_column(table, sa.Column(column, type_factory(), nullable=True))

    inspector.clear_cache()
    if not _has_column(inspector, FK_TABLE, FK_COLUMN):
        op.add_column(
            FK_TABLE, sa.Column(FK_COLUMN, sa.String(length=36), nullable=True)
        )
        op.create_index(
            op.f(f"ix_{FK_TABLE}_{FK_COLUMN}"),
            FK_TABLE,
            [FK_COLUMN],
        )
        op.create_foreign_key(
            f"fk_{FK_TABLE}_{FK_COLUMN}_users",
            FK_TABLE,
            "users",
            [FK_COLUMN],
            ["id"],
        )
