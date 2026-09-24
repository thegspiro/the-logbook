"""NFC phase 2: tags on storage areas, and the staff tap log.

Revision ID: b713c2e8ee26
Revises: ced0061dedc8

Two changes, both additive for existing rows:

* ``inventory_nfc_tags`` may now name a storage area instead of an item:
  ``item_id`` becomes nullable, ``storage_area_id`` is added, and a check
  constraint requires exactly one of the two. Every existing row names an item
  and satisfies it.
* ``inventory_nfc_scans`` is created: one row per tap by an inventory manager.

Each step is guarded, so a database whose tables ``create_all`` already built
from the current models is left alone.

Downgrade is lossy by necessity: tags linked to storage areas cannot exist
under the phase 1 shape (``item_id NOT NULL``), so they are deleted before the
column goes, and the tap log is dropped.
"""

import sqlalchemy as sa
from alembic import op

revision = "b713c2e8ee26"
down_revision = "ced0061dedc8"
branch_labels = None
depends_on = None

TAGS = "inventory_nfc_tags"
SCANS = "inventory_nfc_scans"
CHECK = "ck_inventory_nfc_tags_one_target"
AREA_FK = "fk_inventory_nfc_tags_storage_area_id_storage_areas"
AREA_IX = "ix_inventory_nfc_tags_storage_area_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_check(table: str, name: str) -> bool:
    return name in {c.get("name") for c in _inspector().get_check_constraints(table)}


def upgrade() -> None:
    if _has_table(TAGS):
        if not _has_column(TAGS, "storage_area_id"):
            op.add_column(
                TAGS, sa.Column("storage_area_id", sa.String(length=36), nullable=True)
            )
            op.create_foreign_key(
                op.f(AREA_FK),
                TAGS,
                "storage_areas",
                ["storage_area_id"],
                ["id"],
                ondelete="CASCADE",
            )
            op.create_index(op.f(AREA_IX), TAGS, ["storage_area_id"])

        op.alter_column(
            TAGS, "item_id", existing_type=sa.String(length=36), nullable=True
        )

        if not _has_check(TAGS, CHECK):
            op.create_check_constraint(
                op.f(CHECK),
                TAGS,
                "(item_id IS NOT NULL AND storage_area_id IS NULL) OR "
                "(item_id IS NULL AND storage_area_id IS NOT NULL)",
            )

    if not _has_table(SCANS):
        op.create_table(
            SCANS,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(length=36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "item_id",
                sa.String(length=36),
                sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "tag_id",
                sa.String(length=36),
                sa.ForeignKey("inventory_nfc_tags.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "action",
                sa.Enum("lookup", "put_away", name="inventorynfcscanaction"),
                nullable=False,
            ),
            sa.Column(
                "storage_area_id",
                sa.String(length=36),
                sa.ForeignKey("storage_areas.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "from_storage_area_id",
                sa.String(length=36),
                sa.ForeignKey("storage_areas.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "scanned_by",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "scanned_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "idx_inventory_nfc_scan_org_item_time",
            SCANS,
            ["organization_id", "item_id", "scanned_at"],
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {SCANS}")

    if not _has_table(TAGS):
        return
    if _has_check(TAGS, CHECK):
        op.drop_constraint(op.f(CHECK), TAGS, type_="check")
    if _has_column(TAGS, "storage_area_id"):
        # Storage-area tags have no place in the phase 1 shape.
        op.execute(f"DELETE FROM {TAGS} WHERE item_id IS NULL")
        op.drop_constraint(op.f(AREA_FK), TAGS, type_="foreignkey")
        op.drop_index(op.f(AREA_IX), table_name=TAGS)
        op.drop_column(TAGS, "storage_area_id")
    op.alter_column(TAGS, "item_id", existing_type=sa.String(length=36), nullable=False)
