"""NFC phase 4c: tags on equipment-check compartments.

Revision ID: 45b36bae9098
Revises: e6b2c90d7a13

``inventory_nfc_tags`` gains a third kind of target:

* ``check_compartment_id`` (nullable FK to ``check_template_compartments``,
  CASCADE) is added, with its index.
* ``ck_inventory_nfc_tags_one_target`` is replaced so that exactly one of
  ``item_id`` / ``storage_area_id`` / ``check_compartment_id`` is set. Every
  existing row names an item or a storage area, so it satisfies the new
  constraint unchanged.

Each step is guarded, so a database whose table ``create_all`` already built
from the current models is left alone.

Downgrade is lossy by necessity: compartment tags have no place in the phase 3
shape, so they are deleted before the column goes and the two-target
constraint comes back.
"""

import sqlalchemy as sa
from alembic import op

revision = "45b36bae9098"
down_revision = "e6b2c90d7a13"
branch_labels = None
depends_on = None

TAGS = "inventory_nfc_tags"
CHECK = "ck_inventory_nfc_tags_one_target"
FK = "fk_inventory_nfc_tags_check_compartment_id_check_template_compartments"
IX = "ix_inventory_nfc_tags_check_compartment_id"

TWO_TARGETS = (
    "(item_id IS NOT NULL AND storage_area_id IS NULL) OR "
    "(item_id IS NULL AND storage_area_id IS NOT NULL)"
)
THREE_TARGETS = (
    "(item_id IS NOT NULL AND storage_area_id IS NULL "
    "AND check_compartment_id IS NULL) OR "
    "(item_id IS NULL AND storage_area_id IS NOT NULL "
    "AND check_compartment_id IS NULL) OR "
    "(item_id IS NULL AND storage_area_id IS NULL "
    "AND check_compartment_id IS NOT NULL)"
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _check_sql(table: str, name: str) -> str | None:
    for check in _inspector().get_check_constraints(table):
        if check.get("name") == name:
            return check.get("sqltext") or ""
    return None


def upgrade() -> None:
    if not _has_table(TAGS):
        return
    if not _has_column(TAGS, "check_compartment_id"):
        op.add_column(
            TAGS,
            sa.Column("check_compartment_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            op.f(FK),
            TAGS,
            "check_template_compartments",
            ["check_compartment_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(op.f(IX), TAGS, ["check_compartment_id"])

    existing = _check_sql(TAGS, CHECK)
    if existing is None or "check_compartment_id" not in existing:
        if existing is not None:
            op.drop_constraint(op.f(CHECK), TAGS, type_="check")
        op.create_check_constraint(op.f(CHECK), TAGS, THREE_TARGETS)


def downgrade() -> None:
    if not _has_table(TAGS):
        return
    if _check_sql(TAGS, CHECK) is not None:
        op.drop_constraint(op.f(CHECK), TAGS, type_="check")
    if _has_column(TAGS, "check_compartment_id"):
        # Compartment tags have no place in the two-target shape.
        op.execute(f"DELETE FROM {TAGS} WHERE check_compartment_id IS NOT NULL")
        op.drop_constraint(op.f(FK), TAGS, type_="foreignkey")
        op.drop_index(op.f(IX), table_name=TAGS)
        op.drop_column(TAGS, "check_compartment_id")
    op.create_check_constraint(op.f(CHECK), TAGS, TWO_TARGETS)
