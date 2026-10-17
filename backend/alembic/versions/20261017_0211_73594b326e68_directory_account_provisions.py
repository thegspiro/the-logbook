"""directory account provisions

Revision ID: 73594b326e68
Revises: c87efd81c5aa
Create Date: 2026-10-17 02:11:35.975448

Generalizes ``google_account_provisions`` so it can hold accounts from more
than one directory (Microsoft 365 is next):

- the table becomes ``directory_account_provisions``;
- ``google_user_id`` becomes ``external_user_id`` (the directory's own id);
- ``provider`` is added, ``NOT NULL DEFAULT 'google'``, so every existing row
  reads as the Google account it is;
- the foreign keys and indexes, whose names carry the table's name, are
  renamed to what the model's naming convention now produces.

No row is changed or dropped on upgrade.

**Why each step is guarded.** The table may be absent (no earlier revision
built it, CLAUDE.md pitfall #26), already renamed (a re-run), or built fresh
under the new name by ``create_all`` from the model, in which case there is
nothing to rename. Each step checks the shape it is about to change. Should
``create_all`` have built an empty ``directory_account_provisions`` beside
the populated old table, the empty one is dropped and the old one renamed
over it; if both hold rows, nothing is moved and a warning is printed, since
choosing between them is not something a migration should do silently.

**Downgrade** reverses each step. Rows for any directory other than Google
are deleted first: the old table has no ``provider`` column, and every row it
holds would be read back as a Google account, so a Microsoft account left in
it would be suspended and retried through Google.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "73594b326e68"
down_revision: Union[str, None] = "c87efd81c5aa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD_TABLE = "google_account_provisions"
NEW_TABLE = "directory_account_provisions"
OLD_ID_COLUMN = "google_user_id"
NEW_ID_COLUMN = "external_user_id"
PROVIDER_COLUMN = "provider"
GOOGLE = "google"


def _inspector() -> sa.engine.reflection.Inspector:
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _row_count(table: str) -> int:
    return int(
        op.get_bind().execute(sa.text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0
    )


def _move_table(source: str, target: str) -> None:
    """Rename *source* to *target*, settling a *target* create_all built."""
    if not _has_table(source):
        return
    if _has_table(target):
        if _row_count(target):
            print(
                f"WARNING: both {source} and {target} hold rows; {source} was "
                "left in place. Reconcile them by hand."
            )
            return
        op.execute(f"DROP TABLE IF EXISTS `{target}`")
    op.rename_table(source, target)


def _rename_named_objects(table: str, old_name: str, new_name: str) -> None:
    """Rename the foreign keys and indexes whose names embed the table name.

    The naming convention spells a constraint's name from its table's
    (``fk_<table>_<column>_<referred>``, ``ix_<table>_...``), so renaming the
    table leaves them describing a table that no longer exists. MySQL cannot
    rename a foreign key, so each is dropped and recreated identically; the
    index backing it stays, and is renamed with the others.
    """
    prefixes = (f"fk_{old_name}_", f"ix_{old_name}_")

    def renamed(name: str) -> str:
        for prefix in prefixes:
            if name.startswith(prefix):
                return prefix.replace(old_name, new_name, 1) + name[len(prefix) :]
        return name

    for fk in _inspector().get_foreign_keys(table):
        name = fk.get("name") or ""
        if renamed(name) == name:
            continue
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(
            renamed(name),
            table,
            fk["referred_table"],
            fk["constrained_columns"],
            fk["referred_columns"],
            ondelete=(fk.get("options") or {}).get("ondelete"),
        )
    for index in _inspector().get_indexes(table):
        name = index.get("name") or ""
        if renamed(name) != name:
            op.execute(
                f"ALTER TABLE `{table}` RENAME INDEX `{name}` TO `{renamed(name)}`"
            )


def upgrade() -> None:
    _move_table(OLD_TABLE, NEW_TABLE)
    if not _has_table(NEW_TABLE):
        return
    columns = _columns(NEW_TABLE)
    if OLD_ID_COLUMN in columns and NEW_ID_COLUMN not in columns:
        op.alter_column(
            NEW_TABLE,
            OLD_ID_COLUMN,
            new_column_name=NEW_ID_COLUMN,
            existing_type=sa.String(64),
            existing_nullable=True,
        )
    if PROVIDER_COLUMN not in columns:
        op.add_column(
            NEW_TABLE,
            sa.Column(
                PROVIDER_COLUMN,
                sa.String(20),
                nullable=False,
                server_default=GOOGLE,
            ),
        )
    _rename_named_objects(NEW_TABLE, OLD_TABLE, NEW_TABLE)


def downgrade() -> None:
    if not _has_table(NEW_TABLE):
        return
    columns = _columns(NEW_TABLE)
    if PROVIDER_COLUMN in columns:
        op.execute(
            sa.text(
                f"DELETE FROM `{NEW_TABLE}` WHERE `{PROVIDER_COLUMN}` <> :google"
            ).bindparams(google=GOOGLE)
        )
        op.drop_column(NEW_TABLE, PROVIDER_COLUMN)
    if NEW_ID_COLUMN in columns and OLD_ID_COLUMN not in columns:
        op.alter_column(
            NEW_TABLE,
            NEW_ID_COLUMN,
            new_column_name=OLD_ID_COLUMN,
            existing_type=sa.String(64),
            existing_nullable=True,
        )
    _rename_named_objects(NEW_TABLE, NEW_TABLE, OLD_TABLE)
    _move_table(NEW_TABLE, OLD_TABLE)
