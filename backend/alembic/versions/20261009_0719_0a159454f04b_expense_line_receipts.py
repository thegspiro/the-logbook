"""Receipt files on expense report lines

Every expense line now carries an uploaded receipt (a PDF or photo stored
through FileStorageService under the organization's ``finance-receipts``
area), and a report cannot be submitted until each of its lines has one.

* ``expense_line_items.receipt_file_path``, ``receipt_file_name``,
  ``receipt_content_type``, ``receipt_file_size``, ``receipt_uploaded_by``
  (``SET NULL``) and ``receipt_uploaded_at``.

Existing lines keep NULLs. Reports submitted before this revision are not
affected; a draft submitted afterwards needs its receipts first. The older
free-text ``receipt_url`` column is left as it was.

``expense_line_items`` may be built by ``create_all`` rather than a migration,
so the step is skipped when the table is absent; ``create_all`` then builds it
from the model, columns included.

The downgrade drops the columns. The stored files stay on disk under
``<uploads>/<org>/finance-receipts/``, no longer referenced.

Revision ID: 0a159454f04b
Revises: af92f1496c43
Create Date: 2026-10-09 07:19:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0a159454f04b"
down_revision: Union[str, None] = "af92f1496c43"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LINES = "expense_line_items"
USERS = "users"
FK_UPLOADED_BY = "fk_expense_line_items_receipt_uploaded_by_users"
COLUMNS = (
    "receipt_file_path",
    "receipt_file_name",
    "receipt_content_type",
    "receipt_file_size",
    "receipt_uploaded_by",
    "receipt_uploaded_at",
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if not _has_table(LINES):
        return
    existing = _columns(LINES)
    added = (
        sa.Column("receipt_file_path", sa.String(500), nullable=True),
        sa.Column("receipt_file_name", sa.String(255), nullable=True),
        sa.Column("receipt_content_type", sa.String(100), nullable=True),
        sa.Column("receipt_file_size", sa.Integer(), nullable=True),
        sa.Column("receipt_uploaded_by", sa.String(36), nullable=True),
        sa.Column("receipt_uploaded_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in added:
        if column.name not in existing:
            op.add_column(LINES, column)
    if _has_table(USERS) and not _has_fk(LINES, FK_UPLOADED_BY):
        op.create_foreign_key(
            FK_UPLOADED_BY,
            LINES,
            USERS,
            ["receipt_uploaded_by"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if not _has_table(LINES):
        return
    if _has_fk(LINES, FK_UPLOADED_BY):
        op.drop_constraint(FK_UPLOADED_BY, LINES, type_="foreignkey")
    existing = _columns(LINES)
    for name in COLUMNS:
        if name in existing:
            op.drop_column(LINES, name)
