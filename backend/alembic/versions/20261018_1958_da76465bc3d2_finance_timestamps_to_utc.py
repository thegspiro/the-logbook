"""Finance timestamps written by the database clock, converted from local time to UTC.

Revision ID: da76465bc3d2
Revises: 89723c04ae94
Create Date: 2026-10-18 19:58:00.000000

``created_at``, ``updated_at`` and the like on the finance tables take their
value from ``server_default=func.now()``, which MySQL evaluates in the
session's time zone. With nothing pinned that is the server's own zone
(``America/New_York`` in the shipped compose files), so those columns hold
local wall-clock time while the application reads every DATETIME as UTC. The
effect is a "Created" time hours earlier than "Approved" on the same request,
because ``approved_at`` is written from Python in real UTC.

New connections now pin the session to UTC (``get_db_connect_args``), which
stops the skew for rows written from then on. This revision corrects the rows
written before it: each value at or before the cutoff is converted from the
server's zone to UTC, using the zone MySQL itself used to stamp it.

What it touches, and why only that
----------------------------------
* Only the 19 finance tables named in ``TABLES`` and only their database-clock
  columns (33). Other modules take their time from the same clock and carry the
  same skew; they are left alone on purpose, because some of those timestamps
  are covered by integrity hashes (audit log, election records) and others are
  written from Python on some paths, which a blanket shift would corrupt.
* Only ``DATETIME`` columns. A ``TIMESTAMP`` column already stores UTC and is
  converted by MySQL on the way in and out, so shifting it would break it.
* Nothing at all on a server whose zone is UTC: the installation was never
  skewed.

How the correction is made
--------------------------
The source zone is read from the server (``@@global.time_zone``; ``SYSTEM``
means the host's own zone, with its daylight-saving rules, which is exactly
what stamped the rows). ``CONVERT_TZ`` then converts each value row by row,
so a March row and a July row get the offsets that applied to them (5 hours
and 4 hours in New York), not one fixed offset.

The cutoff separates old rows from new. By default it is the moment this
revision runs, which is right when the UTC pin ships in the same release. If
the pin was deployed earlier, rows written between that deployment and this
revision are already UTC and must not be shifted again: set
``FINANCE_TS_FIX_CUTOFF_UTC`` (``YYYY-MM-DD HH:MM:SS``, UTC) to the moment the
pinned build started serving. ``FINANCE_TS_FIX_SOURCE_TZ`` overrides the zone
read from the server (an offset such as ``-05:00`` or a named zone).

The migration refuses to run, rather than write NULLs, if the zone cannot be
resolved: named zones need MySQL's time zone tables, which ``CONVERT_TZ`` reads
as NULL when they are missing.

Reversibility
-------------
``downgrade`` applies the inverse conversion (UTC back to the server's zone) to
every row at or before the cutoff. It is exact except for the one hour a year
when local clocks repeat (the autumn change): two different instants share one
wall-clock reading there, and the forward conversion chose one of them. Run a
downgrade immediately after a bad upgrade, not after the application has been
writing new rows, and take a database backup before either direction.

Tables that only ``create_all`` builds are skipped when absent (CLAUDE.md
pitfall #26): there is nothing to correct in a table the models will create
already UTC.
"""

import logging
import os
import re
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "da76465bc3d2"
down_revision: Union[str, None] = "89723c04ae94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

SOURCE_TZ_ENV = "FINANCE_TS_FIX_SOURCE_TZ"
CUTOFF_ENV = "FINANCE_TS_FIX_CUTOFF_UTC"

# Frozen on purpose: a migration must keep doing what it did the day it ran, so
# it names its tables and columns instead of reading the models.
TABLES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("advance_returns", ("created_at",)),
    ("approval_chain_steps", ("created_at",)),
    ("approval_chains", ("created_at", "updated_at")),
    ("approval_step_records", ("created_at",)),
    ("budget_amendments", ("created_at",)),
    ("budget_categories", ("created_at", "updated_at")),
    ("budget_category_charge_positions", ("created_at",)),
    ("budget_requests", ("created_at", "updated_at")),
    ("budgets", ("created_at", "updated_at")),
    ("check_requests", ("created_at", "updated_at")),
    ("dues_payments", ("created_at", "updated_at")),
    ("dues_schedules", ("created_at", "updated_at")),
    ("expense_line_items", ("created_at",)),
    ("expense_reports", ("created_at", "updated_at")),
    ("finance_export_logs", ("exported_at",)),
    ("finance_export_mappings", ("created_at", "updated_at")),
    ("fiscal_years", ("created_at", "updated_at")),
    ("member_dues", ("created_at", "updated_at")),
    ("purchase_requests", ("created_at", "updated_at")),
)

_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
# One winter and one summer instant, so a zone with daylight saving is not
# mistaken for UTC by a probe that happened to land outside its offset.
_PROBES = (datetime(2026, 1, 15, 12, 0, 0), datetime(2026, 7, 15, 12, 0, 0))


def _source_zone(conn) -> str:
    """The zone the database clock was reading when it stamped the rows."""
    override = os.environ.get(SOURCE_TZ_ENV, "").strip()
    if override:
        return override
    return str(conn.execute(sa.text("SELECT @@global.time_zone")).scalar_one())


def _convert_tz(conn, value, from_tz: str, to_tz: str):
    return conn.execute(
        sa.text("SELECT CONVERT_TZ(:value, :from_tz, :to_tz)"),
        {"value": value, "from_tz": from_tz, "to_tz": to_tz},
    ).scalar_one()


def _is_utc(conn, zone: str) -> bool:
    """True when ``zone`` is UTC all year, so there is nothing to correct.

    Raises if the zone cannot be resolved: ``CONVERT_TZ`` answers NULL for a
    named zone whose tables are not loaded, and treating that as "no change"
    would leave a skewed installation looking corrected.
    """
    results = [_convert_tz(conn, probe, zone, "+00:00") for probe in _PROBES]
    if any(result is None for result in results):
        raise RuntimeError(
            f"Cannot resolve the database time zone {zone!r}: CONVERT_TZ returned "
            "NULL. Load MySQL's time zone tables (mysql_tzinfo_to_sql), or set "
            f"{SOURCE_TZ_ENV} to a fixed offset such as -05:00, then run the "
            "upgrade again. No data was changed."
        )
    return all(str(result) == str(probe) for result, probe in zip(results, _PROBES))


def _cutoffs(conn, zone: str) -> tuple[datetime, datetime]:
    """The cutoff as a UTC instant, and as the server's local reading of it."""
    raw = os.environ.get(CUTOFF_ENV, "").strip()
    if raw:
        try:
            cutoff_utc = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
        except ValueError as exc:
            raise ValueError(
                f"{CUTOFF_ENV} must look like 2026-10-18 17:00:00 (UTC); got {raw!r}"
            ) from exc
    else:
        cutoff_utc = conn.execute(sa.text("SELECT UTC_TIMESTAMP()")).scalar_one()
    return cutoff_utc, _convert_tz(conn, cutoff_utc, "+00:00", zone)


def _datetime_columns(conn, table: str, wanted: Sequence[str]) -> list[str]:
    """The ``wanted`` columns that exist and are DATETIME, not TIMESTAMP."""
    present = {c["name"]: c for c in sa.inspect(conn).get_columns(table)}
    return [
        name
        for name in wanted
        if name in present and str(present[name]["type"]).upper().startswith("DATETIME")
    ]


def convert_table(
    conn,
    table: str,
    columns: Sequence[str],
    *,
    zone: str,
    cutoff: datetime,
    to_utc: bool,
) -> int:
    """Convert ``columns`` of ``table`` for values at or before ``cutoff``.

    ``cutoff`` is read in the domain the values are in now: the server's local
    time when converting to UTC, UTC when converting back. Every column goes in
    one UPDATE so a database-level ON UPDATE clause on ``updated_at`` cannot
    fire on the side effect of changing ``created_at``. A NULL result from
    ``CONVERT_TZ`` keeps the original value, never writes NULL.

    Returns the number of rows whose first listed column was in range.
    """
    for identifier in (table, *columns):
        if not _IDENTIFIER.match(identifier):
            raise ValueError(f"Unexpected identifier {identifier!r}")

    source, target = (zone, "+00:00") if to_utc else ("+00:00", zone)
    assignments = ", ".join(
        f"`{c}` = CASE WHEN `{c}` <= :cutoff "
        f"THEN COALESCE(CONVERT_TZ(`{c}`, :source, :target), `{c}`) "
        f"ELSE `{c}` END"
        for c in columns
    )
    params = {"cutoff": cutoff, "source": source, "target": target}
    affected = conn.execute(
        sa.text(f"SELECT COUNT(*) FROM `{table}` WHERE `{columns[0]}` <= :cutoff"),
        {"cutoff": cutoff},
    ).scalar_one()
    conn.execute(sa.text(f"UPDATE `{table}` SET {assignments}"), params)
    return int(affected)


def _run(to_utc: bool) -> None:
    conn = op.get_bind()
    zone = _source_zone(conn)
    if _is_utc(conn, zone):
        logger.info(
            "finance timestamps: the database time zone (%s) is UTC, nothing to do",
            zone,
        )
        return

    cutoff_utc, cutoff_local = _cutoffs(conn, zone)
    cutoff = cutoff_local if to_utc else cutoff_utc
    existing = set(sa.inspect(conn).get_table_names())
    direction = "to UTC" if to_utc else "back to local time"
    logger.info(
        "finance timestamps: converting %s from %r, values at or before %s",
        direction,
        zone,
        cutoff,
    )
    for table, wanted in TABLES:
        if table not in existing:
            continue
        columns = _datetime_columns(conn, table, wanted)
        if not columns:
            continue
        rows = convert_table(
            conn, table, columns, zone=zone, cutoff=cutoff, to_utc=to_utc
        )
        logger.info("finance timestamps: %s %s (%d rows)", table, columns, rows)


def upgrade() -> None:
    _run(to_utc=True)


def downgrade() -> None:
    _run(to_utc=False)
