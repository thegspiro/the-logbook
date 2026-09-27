"""NFC phase 3: shelf audits.

Revision ID: 7ad83f52735c
Revises: c3a7e19d5b20

Three changes, all additive for existing rows:

* ``inventory_nfc_scans.action`` gains the value ``audit``, for taps made
  during a shelf audit. Existing ``lookup`` / ``put_away`` rows are untouched.
* ``inventory_nfc_audits`` is created: one row per shelf audit, with the
  expected/found/missing/unexpected counts and who ran and applied it.
* ``inventory_nfc_audit_items`` is created: one line per item the audit
  judged.

Each step is guarded, so a database whose tables ``create_all`` already built
from the current models is left alone.

Downgrade is lossy by necessity: both audit tables are dropped, and tap-log
rows recorded as ``audit`` are deleted because the phase 2 enum cannot hold
them.
"""

import sqlalchemy as sa
from alembic import op

revision = "7ad83f52735c"
down_revision = "c3a7e19d5b20"
branch_labels = None
depends_on = None

SCANS = "inventory_nfc_scans"
AUDITS = "inventory_nfc_audits"
AUDIT_ITEMS = "inventory_nfc_audit_items"

PHASE2_ACTIONS = ("lookup", "put_away")
PHASE3_ACTIONS = ("lookup", "put_away", "audit")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _action_enum(values: tuple[str, ...]) -> sa.Enum:
    return sa.Enum(*values, name="inventorynfcscanaction")


def upgrade() -> None:
    if _has_table(SCANS):
        # MODIFY with the full value list is idempotent: re-running it with
        # 'audit' already present changes nothing.
        op.alter_column(
            SCANS,
            "action",
            existing_type=_action_enum(PHASE2_ACTIONS),
            type_=_action_enum(PHASE3_ACTIONS),
            existing_nullable=False,
        )

    if not _has_table(AUDITS):
        op.create_table(
            AUDITS,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(length=36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "storage_area_id",
                sa.String(length=36),
                sa.ForeignKey("storage_areas.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("storage_area_name", sa.String(length=255), nullable=False),
            sa.Column(
                "expected_count", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column("found_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "missing_count", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "unexpected_count", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "audited_by",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "audited_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "applied_by",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_inventory_nfc_audit_org_area_time",
            AUDITS,
            ["organization_id", "storage_area_id", "audited_at"],
        )

    if not _has_table(AUDIT_ITEMS):
        op.create_table(
            AUDIT_ITEMS,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "audit_id",
                sa.String(length=36),
                sa.ForeignKey("inventory_nfc_audits.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "organization_id",
                sa.String(length=36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "item_id",
                sa.String(length=36),
                sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column(
                "result",
                sa.Enum(
                    "found", "missing", "unexpected", name="inventorynfcauditresult"
                ),
                nullable=False,
            ),
            sa.Column(
                "recorded_storage_area_id",
                sa.String(length=36),
                sa.ForeignKey("storage_areas.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "recorded_storage_area_name", sa.String(length=255), nullable=True
            ),
            sa.Column("moved", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            op.f("ix_inventory_nfc_audit_items_audit_id"), AUDIT_ITEMS, ["audit_id"]
        )
        op.create_index(
            "idx_inventory_nfc_audit_item_org_item",
            AUDIT_ITEMS,
            ["organization_id", "item_id"],
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {AUDIT_ITEMS}")
    op.execute(f"DROP TABLE IF EXISTS {AUDITS}")

    if _has_table(SCANS):
        # The phase 2 enum has no 'audit'; MySQL would refuse (or blank) them.
        op.execute(f"DELETE FROM {SCANS} WHERE action = 'audit'")
        op.alter_column(
            SCANS,
            "action",
            existing_type=_action_enum(PHASE3_ACTIONS),
            type_=_action_enum(PHASE2_ACTIONS),
            existing_nullable=False,
        )
