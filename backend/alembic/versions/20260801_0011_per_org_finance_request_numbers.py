"""Per-org uniqueness for finance request/report numbers

Request numbers are generated per organization (PR-YYYY-NNNN counted
within the org), but the columns carried a GLOBAL unique constraint —
so the first org to create PR-2026-0001 blocked every other org's first
purchase request of the year, and the count()+1 generator raced with
itself within an org. The fix is a composite unique per org, which the
service's new retry-on-conflict allocator relies on.

These tables are model-only (materialized by startup create_all, not a
migration), so this migration introspects before dropping/creating:
fresh installs already have the composite constraint and no legacy
index, while pre-existing installs have the legacy single-column unique
created from the old ``unique=True``.

Revision ID: 20260801_0011
Revises: 20260801_0010
Create Date: 2026-08-01 00:11:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0011"
down_revision = "20260801_0010"
branch_labels = None
depends_on = None

# (table, number column, new composite-unique name)
_TARGETS = [
    ("purchase_requests", "request_number", "uq_purchase_requests_org_number"),
    ("expense_reports", "report_number", "uq_expense_reports_org_number"),
    ("check_requests", "request_number", "uq_check_requests_org_number"),
]


def _indexes(inspector, table):
    return {
        idx["name"]: idx
        for idx in inspector.get_indexes(table)
        + [
            {
                "name": uc["name"],
                "column_names": uc["column_names"],
                "unique": True,
            }
            for uc in inspector.get_unique_constraints(table)
        ]
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table, column, uq_name in _TARGETS:
        if table not in existing_tables:
            # Fresh install where create_all hasn't run yet — the model
            # already defines the composite unique; nothing to repair.
            continue
        indexes = _indexes(inspector, table)

        # Drop any legacy single-column unique on the number column.
        for name, idx in indexes.items():
            if (
                name != uq_name
                and idx.get("unique")
                and idx["column_names"] == [column]
            ):
                op.drop_index(name, table_name=table)

        if uq_name not in indexes:
            op.create_unique_constraint(uq_name, table, ["organization_id", column])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table, column, uq_name in _TARGETS:
        if table not in existing_tables:
            continue
        indexes = _indexes(inspector, table)
        if uq_name in indexes:
            op.drop_constraint(uq_name, table, type_="unique")
        # Restoring the (incorrect) global unique could fail if two orgs
        # now share a number — recreate it only when the data allows.
        dup = bind.execute(
            sa.text(
                f"SELECT {column} FROM {table} "  # nosec B608 - constants
                f"GROUP BY {column} HAVING COUNT(*) > 1 LIMIT 1"
            )
        ).fetchone()
        if dup is None:
            op.create_index(column, table, [column], unique=True)
