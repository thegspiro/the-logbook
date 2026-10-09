"""Link finance receipts to stored documents.

Revision ID: c0bf0b155719
Revises: 6c25b7d68965
Create Date: 2026-10-09 03:41:46.435727

Purchase requests and expense line items gain an uploaded receipt: a Document
under Finance > Receipts (docs/FILE_STORAGE_HARDENING.md decision 13). The
older free-text receipt_url stays, untouched. Deleting the document clears
the link rather than the finance row.

Both tables are built by create_all on a fresh install, not by any migration
(docs/rules/migrations.md), so each step is skipped when the table is absent;
create_all builds it from the model, which already has the column.
"""

import sqlalchemy as sa
from alembic import op

revision = "c0bf0b155719"
down_revision = "6c25b7d68965"
branch_labels = None
depends_on = None

_TABLES = ("purchase_requests", "expense_line_items")


def _columns(table: str):
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    for table in _TABLES:
        columns = _columns(table)
        if columns is None or "receipt_document_id" in columns:
            continue
        op.add_column(
            table, sa.Column("receipt_document_id", sa.String(36), nullable=True)
        )
        op.create_foreign_key(
            f"fk_{table}_receipt_document_id",
            table,
            "documents",
            ["receipt_document_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in _TABLES:
        columns = _columns(table)
        if columns is None or "receipt_document_id" not in columns:
            continue
        op.drop_constraint(f"fk_{table}_receipt_document_id", table, type_="foreignkey")
        op.drop_column(table, "receipt_document_id")
