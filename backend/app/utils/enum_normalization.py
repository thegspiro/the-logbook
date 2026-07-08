"""
Legacy enum-case normalization.

Some enum columns were created before the ``values_callable`` convention was
applied consistently. Without ``values_callable``, SQLAlchemy emits the enum
*member names* (UPPERCASE, e.g. ``'PHYSICAL_EXAM'``) into the MySQL ``ENUM(...)``
DDL instead of the lowercase ``.value`` (``'physical_exam'``). Every other enum
in the schema stores lowercase values, so these columns silently violate the
frontend/backend contract (see docs / CLAUDE.md Pitfall #5).

Fresh installs are fixed by the ``values_callable`` added to the models. But
this deployment builds/repairs schema with ``create_all`` and stamps Alembic to
head (migrations are not run via ``upgrade``), so an accompanying migration file
never executes on an existing database. This module is the delivery mechanism
for those existing instances: it runs at startup and, for MySQL only, rewrites
each affected column's ENUM DDL and existing rows from the UPPERCASE member
names to the lowercase values.

The conversion follows the standard safe sequence for a populated MySQL ENUM:
expand the column to a superset of old+new labels, rewrite the rows, then shrink
the column to the lowercase-only set. It is idempotent — a column already in the
correct lowercase state is skipped.
"""

from __future__ import annotations

import enum
from typing import NamedTuple

from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.medical_screening import ScreeningStatus, ScreeningType
from app.models.training import (
    AssignmentStatus,
    ShiftPosition,
    SwapRequestStatus,
    TimeOffStatus,
)


class _EnumColumn(NamedTuple):
    table: str
    column: str
    enum_class: type[enum.Enum]
    # Lowercase default to preserve on the column, or None if it has no default.
    default: str | None


# Columns historically created with UPPERCASE member-name DDL. Each maps to the
# canonical lowercase enum that the model now declares via ``values_callable``.
_TARGET_COLUMNS: tuple[_EnumColumn, ...] = (
    _EnumColumn("screening_requirements", "screening_type", ScreeningType, None),
    _EnumColumn("screening_records", "screening_type", ScreeningType, None),
    _EnumColumn("screening_records", "status", ScreeningStatus, "scheduled"),
    _EnumColumn("shift_assignments", "position", ShiftPosition, "firefighter"),
    _EnumColumn("shift_assignments", "assignment_status", AssignmentStatus, "assigned"),
    _EnumColumn("shift_swap_requests", "status", SwapRequestStatus, "pending"),
    _EnumColumn("shift_time_off", "status", TimeOffStatus, "pending"),
)


def _enum_clause(values: list[str]) -> str:
    # Enum values are code-defined identifiers (lowercase words / UPPERCASE
    # member names), never user input — no injection surface. Escape single
    # quotes defensively regardless.
    return ", ".join("'" + v.replace("'", "''") + "'" for v in values)


async def _current_enum_values(
    db: AsyncSession, schema: str, table: str, column: str
) -> list[str] | None:
    """Return the column's ENUM label list, or None if it is not an ENUM."""
    row = (
        await db.execute(
            text(
                """
                SELECT COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = :schema
                  AND TABLE_NAME = :table
                  AND COLUMN_NAME = :column
                """
            ),
            {"schema": schema, "table": table, "column": column},
        )
    ).fetchone()

    if not row or not row[0] or not str(row[0]).startswith("enum("):
        return None

    import re

    return re.findall(r"'((?:[^']|'')*)'", str(row[0]))


async def _normalize_one(db: AsyncSession, schema: str, spec: _EnumColumn) -> bool:
    target = [m.value for m in spec.enum_class]
    current = await _current_enum_values(db, schema, spec.table, spec.column)

    # Not an ENUM (e.g. legacy VARCHAR column) or already canonical → nothing to do.
    if current is None or set(current) == set(target):
        return False

    tbl = f"`{spec.table.replace('`', '``')}`"
    col = f"`{spec.column.replace('`', '``')}`"

    # MySQL ENUM labels are case-insensitive, so 'PENDING' and 'pending' collide
    # in a single ENUM definition (error 1291) — a superset of old+new labels is
    # rejected. Route through VARCHAR instead: converting ENUM→VARCHAR preserves
    # the current label strings as plain text, which can then be rewritten to
    # the lowercase values before the column is redefined as the canonical
    # lowercase ENUM.

    # 1. ENUM → VARCHAR (rows keep their current 'PHYSICAL_EXAM'/'OFFICER' text).
    await db.execute(text(f"ALTER TABLE {tbl} MODIFY {col} VARCHAR(64) NOT NULL"))

    # 2. Rewrite rows from member NAME (UPPERCASE) to member value (lowercase).
    #    Mapping by name is exact and independent of any case relationship.
    for member in spec.enum_class:
        if member.name != member.value:
            await db.execute(
                text(f"UPDATE {tbl} SET {col} = :val WHERE {col} = :name"),
                {"val": member.value, "name": member.name},
            )

    # 3. VARCHAR → canonical lowercase ENUM, restoring NOT NULL + default.
    default_sql = f" DEFAULT '{spec.default}'" if spec.default is not None else ""
    await db.execute(
        text(
            f"ALTER TABLE {tbl} MODIFY {col} "
            f"ENUM({_enum_clause(target)}) NOT NULL{default_sql}"
        )
    )
    await db.commit()
    logger.info(
        f"Normalized enum case: {spec.table}.{spec.column} "
        f"({sorted(set(current) - set(target))} → lowercase)"
    )
    return True


async def normalize_legacy_enum_case(db: AsyncSession) -> int:
    """
    Convert legacy UPPERCASE enum columns to their lowercase canonical values.

    MySQL-only and idempotent; safe to run on every startup. Each column is
    handled independently so a single failure is logged and skipped without
    blocking the others or startup.

    Returns the number of columns actually converted.
    """
    bind = db.get_bind()
    if bind.dialect.name != "mysql":
        return 0

    from app.core.config import settings

    converted = 0
    for spec in _TARGET_COLUMNS:
        try:
            if await _normalize_one(db, settings.DB_NAME, spec):
                converted += 1
        except Exception as exc:
            await db.rollback()
            logger.warning(
                f"Enum-case normalization failed for "
                f"{spec.table}.{spec.column}: {exc}"
            )

    if converted:
        logger.info(f"Enum-case normalization complete: {converted} column(s) fixed")
    return converted
