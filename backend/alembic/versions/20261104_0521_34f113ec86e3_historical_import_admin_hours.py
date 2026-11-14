"""Historical import: administrative hours

Lets a historical data import write administrative hours.

* ``admin_hours_entries.entry_method`` gains ``import``, so an entry brought in
  from a previous system is told apart from one a member typed or scanned.
  Existing rows keep their values; none of them was imported.
* ``historical_imports`` gains three nullable JSON columns: ``admin_settings``
  (which columns describe an entry and which category each row goes to),
  ``member_mappings`` (who a member the file names is, when nothing matched)
  and ``results`` (what each step committed). Existing imports have none of
  these and read them as empty.

The downgrade drops the three columns and narrows the enum. An imported entry
has no honest older ``entry_method``; it is set to ``manual``, the value nearest
in meaning (entered by a person rather than by a device), so narrowing the enum
cannot fail on it. The entries themselves are kept.

Revision ID: 34f113ec86e3
Revises: c0ae312b2385
Create Date: 2026-11-04 05:21:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "34f113ec86e3"
down_revision: Union[str, None] = "c0ae312b2385"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ENTRIES = "admin_hours_entries"
IMPORTS = "historical_imports"
_OLD = ("qr_scan", "nfc_station", "manual", "event_attendance")
_NEW = ("qr_scan", "nfc_station", "manual", "event_attendance", "import")
_JSON_COLUMNS = ("admin_settings", "member_mappings", "results")


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if _has_table(ENTRIES):
        # MySQL changes an ENUM's values only through ALTER COLUMN.
        op.alter_column(
            ENTRIES,
            "entry_method",
            type_=sa.Enum(*_NEW, name="adminhoursentrymethod"),
            existing_type=sa.Enum(*_OLD, name="adminhoursentrymethod"),
            existing_nullable=False,
        )
    if _has_table(IMPORTS):
        for column in _JSON_COLUMNS:
            if not _has_column(IMPORTS, column):
                op.add_column(IMPORTS, sa.Column(column, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_table(IMPORTS):
        for column in _JSON_COLUMNS:
            if _has_column(IMPORTS, column):
                op.drop_column(IMPORTS, column)
    if _has_table(ENTRIES):
        op.execute(
            sa.text(
                f"UPDATE {ENTRIES} SET entry_method = 'manual' "
                "WHERE entry_method = 'import'"
            )
        )
        op.alter_column(
            ENTRIES,
            "entry_method",
            type_=sa.Enum(*_OLD, name="adminhoursentrymethod"),
            existing_type=sa.Enum(*_NEW, name="adminhoursentrymethod"),
            existing_nullable=False,
        )
