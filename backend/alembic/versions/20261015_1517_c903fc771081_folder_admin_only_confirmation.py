"""Record when a folder was confirmed as meant for administrators only.

Revision ID: c903fc771081
Revises: bb60bd43bede
Create Date: 2026-10-15 15:17:00.000000

Decision 30 (docs/FILE_STORAGE_HARDENING.md): a folder can come to open to
full administrators alone without anyone saving it, when the last member
holding its permission or position loses it. The Documents page now lists
such folders for administrators. A folder an administrator has confirmed as
deliberately administrators-only is left off that list, and these two
nullable columns on ``document_folders`` record the confirmation:

* ``admin_only_confirmed_at`` — when it was confirmed;
* ``admin_only_confirmed_by`` — who confirmed it. ``SET NULL`` when that
  member's row is deleted: the confirmation stands, only its author is lost.

Every existing row gets NULL, meaning "not confirmed". A folder confirmed
through the save-time question before this revision was not recorded, so it
appears on the list once and is confirmed again there.

**Why each step is guarded.** ``document_folders`` is built by
``create_all()`` and by no migration (CLAUDE.md pitfall #26), and CI runs
``alembic upgrade head`` against an empty database before anything calls
``create_all``. Skipping is correct rather than merely safe: ``create_all``
builds the table from the model, which declares both columns. Each step is
also guarded on its result being absent, so a re-run changes nothing.

**Downgrade** drops the key and both columns. Every recorded confirmation is
lost; on a later upgrade those folders are listed once more.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c903fc771081"
down_revision: Union[str, None] = "bb60bd43bede"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "document_folders"
CONFIRMED_AT = "admin_only_confirmed_at"
CONFIRMED_BY = "admin_only_confirmed_by"
# The name create_all gives the model's key (NAMING_CONVENTION in
# app/core/database.py), so both build paths produce the same schema.
FK_CONFIRMED_BY = "fk_document_folders_admin_only_confirmed_by_users"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_foreign_key(table: str, name: str) -> bool:
    return name in {fk["name"] for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, CONFIRMED_AT):
        op.add_column(
            TABLE,
            sa.Column(CONFIRMED_AT, sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column(TABLE, CONFIRMED_BY):
        op.add_column(TABLE, sa.Column(CONFIRMED_BY, sa.String(36), nullable=True))
    if not _has_foreign_key(TABLE, FK_CONFIRMED_BY):
        op.create_foreign_key(
            FK_CONFIRMED_BY,
            TABLE,
            "users",
            [CONFIRMED_BY],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_foreign_key(TABLE, FK_CONFIRMED_BY):
        op.drop_constraint(FK_CONFIRMED_BY, TABLE, type_="foreignkey")
    if _has_column(TABLE, CONFIRMED_BY):
        op.drop_column(TABLE, CONFIRMED_BY)
    if _has_column(TABLE, CONFIRMED_AT):
        op.drop_column(TABLE, CONFIRMED_AT)
