"""widen shift position columns to varchar

SCHED-CUSTOM-SEAT: a department can define its own crew seats (Scheduling →
Position Names, or a seat typed onto a template or apparatus), but
``shift_assignments.position`` and ``standing_shift_claims.position`` were
MySQL ENUMs of the ten built-in seats, so nobody could be put in one. Both
become ``VARCHAR(100)`` — the same width as a custom seat's name on the
Position Names screen (``CustomPositionSchema.value``). Which seats are valid
is now decided per shift by ``app.utils.positions.resolve_seat``.

Upgrade: every stored value is kept as it is. The one rewrite is a legacy
UPPERCASE member name (``'OFFICER'``) on an installation whose ENUM predates
the lowercase convention: until now the startup pass in
``app/utils/enum_normalization.py`` folded those on every boot, and that pass no
longer touches these columns (it would convert a VARCHAR back to an ENUM), so
the fold happens here, once. A column that is already VARCHAR is left alone,
and a table that does not exist yet is skipped — ``create_all`` builds it from
the model, already VARCHAR. Safe to run twice.

Downgrade narrows back to the built-in ENUM **only when every stored value is a
built-in seat**. If any row holds a department's own seat, the downgrade
refuses with an error naming the table and the seats, and changes nothing:
narrowing would make MySQL truncate those values to ``''`` (or fail outright in
strict mode), and deleting the assignments would silently take members off
shifts. Reassign or remove those rows first, then downgrade.

Revision ID: 56c91e7d9e10
Revises: 2d4304107b77
Create Date: 2026-10-06 04:36:41.860264

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "56c91e7d9e10"
down_revision: Union[str, None] = "2d4304107b77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("shift_assignments", "standing_shift_claims")
_COLUMN = "position"
_WIDTH = 100
_DEFAULT = "firefighter"

# Frozen copy of the built-in seats as of this revision. A migration must keep
# doing what it did the day it ran, so it does not import ShiftPosition.
_BUILTIN_SEATS = (
    "officer",
    "driver",
    "firefighter",
    "ems",
    "paramedic",
    "captain",
    "lieutenant",
    "probationary",
    "volunteer",
    "other",
)


def _position_column(table: str):
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return None
    for column in inspector.get_columns(table):
        if column["name"] == _COLUMN:
            return column
    return None


def upgrade() -> None:
    bind = op.get_bind()
    for table in _TABLES:
        column = _position_column(table)
        if column is None:
            continue
        if isinstance(column["type"], sa.Enum):
            op.alter_column(
                table,
                _COLUMN,
                existing_type=column["type"],
                type_=sa.String(_WIDTH),
                existing_nullable=False,
                nullable=False,
                server_default=_DEFAULT,
            )
        # BINARY: the column's collation is case-insensitive, and only the
        # exact legacy spelling is a member name to fold.
        for seat in _BUILTIN_SEATS:
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET {_COLUMN} = :value "  # nosec B608
                    f"WHERE BINARY {_COLUMN} = :legacy"
                ),
                {"value": seat, "legacy": seat.upper()},
            )


def downgrade() -> None:
    bind = op.get_bind()
    placeholders = ", ".join(f":s{i}" for i in range(len(_BUILTIN_SEATS)))
    params = {f"s{i}": seat for i, seat in enumerate(_BUILTIN_SEATS)}

    # Every table is checked before any is narrowed, so a refusal leaves the
    # schema exactly as it found it rather than half downgraded.
    narrow = []
    refusals = []
    for table in _TABLES:
        column = _position_column(table)
        if column is None or isinstance(column["type"], sa.Enum):
            continue
        custom = [
            row[0]
            for row in bind.execute(
                sa.text(
                    f"SELECT DISTINCT {_COLUMN} FROM {table} "  # nosec B608
                    f"WHERE BINARY {_COLUMN} NOT IN ({placeholders})"
                ),
                params,
            )
        ]
        if custom:
            refusals.append(f"{table}: {', '.join(sorted(custom))}")
        narrow.append(table)

    if refusals:
        raise RuntimeError(
            "Cannot downgrade the shift position columns to the built-in seat "
            "ENUM: rows hold a department's own seats, which narrowing would "
            f"truncate ({'; '.join(refusals)}). Reassign or remove those rows, "
            "then run the downgrade again."
        )

    for table in narrow:
        op.alter_column(
            table,
            _COLUMN,
            existing_type=sa.String(_WIDTH),
            type_=sa.Enum(*_BUILTIN_SEATS, name="shiftposition"),
            existing_nullable=False,
            nullable=False,
            server_default=_DEFAULT,
        )
