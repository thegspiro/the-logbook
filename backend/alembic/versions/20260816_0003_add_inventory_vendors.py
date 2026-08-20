"""Add inventory vendors and vendor contacts

Vendors were a free-text column on items and reorder requests, so "Galls",
"galls" and "Galls Inc." were three suppliers, none of which carried a phone
number. This gives them a row per organization, a contact list, and a link from
the items and reorders that name them.

The existing free-text values are migrated: every distinct name (case-folded)
becomes a vendor, and the rows that named it are linked to it. The free-text
columns are left in place — they still carry the value for rows nobody has
reviewed, and CSV imports still write them.

Revision ID: 20260816_0003
Revises: 20260816_0002

(Renumbered from 20260816_0002: the storage-area barcode backfill on main
already held that id — two branches numbered from 20260816_0001 the same day,
the recurring collision ALEMBIC_MIGRATIONS.md warns about. Chained after the
barcode backfill to keep the graph linear.)
Create Date: 2026-08-16 00:00:00.000000
"""

import uuid

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260816_0003"
down_revision = "20260816_0002"
branch_labels = None
depends_on = None

_VENDORS = "inventory_vendors"
_CONTACTS = "inventory_vendor_contacts"


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _column_exists(inspector, table: str, column: str) -> bool:
    if not _table_exists(inspector, table):
        return False
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Fresh installs materialize both tables from the models via create_all
    # before this migration replays.
    if not _table_exists(inspector, _VENDORS):
        op.create_table(
            _VENDORS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("account_number", sa.String(100), nullable=True),
            sa.Column("website", sa.String(255), nullable=True),
            sa.Column("phone", sa.String(50), nullable=True),
            sa.Column("email", sa.String(255), nullable=True),
            sa.Column("fax", sa.String(50), nullable=True),
            sa.Column("address_line1", sa.String(255), nullable=True),
            sa.Column("address_line2", sa.String(255), nullable=True),
            sa.Column("city", sa.String(100), nullable=True),
            sa.Column("state", sa.String(100), nullable=True),
            sa.Column("postal_code", sa.String(20), nullable=True),
            sa.Column("country", sa.String(100), nullable=True),
            sa.Column("payment_terms", sa.String(100), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "is_preferred",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default="1",
                index=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                onupdate=sa.func.now(),
            ),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Index(
                "idx_inventory_vendors_org_active", "organization_id", "is_active"
            ),
            sa.UniqueConstraint(
                "organization_id", "name", name="uq_inventory_vendor_org_name"
            ),
        )

    if not _table_exists(inspector, _CONTACTS):
        op.create_table(
            _CONTACTS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "vendor_id",
                sa.String(36),
                sa.ForeignKey("inventory_vendors.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("title", sa.String(150), nullable=True),
            sa.Column("email", sa.String(255), nullable=True),
            sa.Column("phone", sa.String(50), nullable=True),
            sa.Column("phone_extension", sa.String(20), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                onupdate=sa.func.now(),
            ),
            sa.Index(
                "idx_inventory_vendor_contacts_org_vendor",
                "organization_id",
                "vendor_id",
            ),
        )

    inspector = sa.inspect(bind)
    if not _column_exists(inspector, "inventory_items", "vendor_id"):
        op.add_column(
            "inventory_items",
            sa.Column("vendor_id", sa.String(36), nullable=True),
        )
        op.create_index(
            "ix_inventory_items_vendor_id", "inventory_items", ["vendor_id"]
        )
        op.create_foreign_key(
            "fk_inventory_items_vendor_id",
            "inventory_items",
            _VENDORS,
            ["vendor_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _column_exists(inspector, "reorder_requests", "vendor_id"):
        op.add_column(
            "reorder_requests",
            sa.Column("vendor_id", sa.String(36), nullable=True),
        )
        op.create_index(
            "ix_reorder_requests_vendor_id", "reorder_requests", ["vendor_id"]
        )
        op.create_foreign_key(
            "fk_reorder_requests_vendor_id",
            "reorder_requests",
            _VENDORS,
            ["vendor_id"],
            ["id"],
            ondelete="SET NULL",
        )

    _backfill_vendors(bind)


def _backfill_vendors(bind) -> None:
    """Turn the free-text vendor names already on file into vendor rows.

    Names are grouped case-insensitively per organization; the first spelling
    encountered wins as the display name. Rows whose name maps to a vendor that
    somehow already exists (a re-run, or a name entered through the new screen
    first) are linked to that vendor rather than duplicated.
    """
    existing = {
        (row[0], (row[1] or "").strip().lower()): row[2]
        for row in bind.execute(
            sa.text("SELECT organization_id, name, id FROM inventory_vendors")
        )
    }

    sources = (
        ("inventory_items", "vendor"),
        ("reorder_requests", "vendor"),
    )
    for table, column in sources:
        rows = bind.execute(
            sa.text(
                f"SELECT DISTINCT organization_id, {column} FROM {table} "
                f"WHERE {column} IS NOT NULL AND TRIM({column}) <> ''"
            )
        ).fetchall()
        for org_id, raw_name in rows:
            name = (raw_name or "").strip()
            if not name or not org_id:
                continue
            key = (org_id, name.lower())
            vendor_id = existing.get(key)
            if vendor_id is None:
                vendor_id = str(uuid.uuid4())
                bind.execute(
                    sa.text(
                        "INSERT INTO inventory_vendors "
                        "(id, organization_id, name, is_preferred, is_active) "
                        "VALUES (:id, :org_id, :name, 0, 1)"
                    ),
                    {"id": vendor_id, "org_id": org_id, "name": name[:255]},
                )
                existing[key] = vendor_id

            bind.execute(
                sa.text(
                    f"UPDATE {table} SET vendor_id = :vendor_id "
                    f"WHERE organization_id = :org_id "
                    f"AND vendor_id IS NULL "
                    f"AND LOWER(TRIM({column})) = :name_key"
                ),
                {
                    "vendor_id": vendor_id,
                    "org_id": org_id,
                    "name_key": name.lower(),
                },
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _column_exists(inspector, "reorder_requests", "vendor_id"):
        op.drop_constraint(
            "fk_reorder_requests_vendor_id", "reorder_requests", type_="foreignkey"
        )
        op.drop_index("ix_reorder_requests_vendor_id", table_name="reorder_requests")
        op.drop_column("reorder_requests", "vendor_id")

    if _column_exists(inspector, "inventory_items", "vendor_id"):
        op.drop_constraint(
            "fk_inventory_items_vendor_id", "inventory_items", type_="foreignkey"
        )
        op.drop_index("ix_inventory_items_vendor_id", table_name="inventory_items")
        op.drop_column("inventory_items", "vendor_id")

    if _table_exists(inspector, _CONTACTS):
        op.drop_table(_CONTACTS)
    if _table_exists(inspector, _VENDORS):
        op.drop_table(_VENDORS)
