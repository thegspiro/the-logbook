"""Link apparatus photos and documents to stored documents.

Revision ID: 6c25b7d68965
Revises: b38df38d849b
Create Date: 2026-10-09 04:21:00.000000

Apparatus photos and documents become real documents in the vehicle's folder
(docs/FILE_STORAGE_HARDENING.md decision 12). ``document_id`` is the link; it
cascades so deleting the document removes the row that pointed at it. Rows
written before this hold a typed URL in ``file_path`` and keep it, with no
link; nothing here rewrites them.
"""

import sqlalchemy as sa
from alembic import op

revision = "6c25b7d68965"
down_revision = "b38df38d849b"
branch_labels = None
depends_on = None

_TABLES = ("apparatus_photos", "apparatus_documents")


def _columns(table: str):
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    for table in _TABLES:
        columns = _columns(table)
        if columns is None or "document_id" in columns:
            continue
        op.add_column(table, sa.Column("document_id", sa.String(36), nullable=True))
        op.create_index(f"ix_{table}_document_id", table, ["document_id"])
        op.create_foreign_key(
            f"fk_{table}_document_id",
            table,
            "documents",
            ["document_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    for table in _TABLES:
        columns = _columns(table)
        if columns is None or "document_id" not in columns:
            continue
        op.drop_constraint(f"fk_{table}_document_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_document_id", table_name=table)
        op.drop_column(table, "document_id")
