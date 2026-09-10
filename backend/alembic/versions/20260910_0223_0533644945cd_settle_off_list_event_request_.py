"""Settle off-list event request preference values on rows already stored

``date_flexibility``, ``venue_preference`` and ``preferred_time_of_day`` are
plain string columns holding fixed vocabularies — the model's comments, the
generated form's ``<select>`` options and every reader in the coordinator's
board and the public status page are written against these exact values. The
change that adds this migration settles them on both intake paths through
``normalize_request_preferences``.

That is only the write side. A department may rename its own form's option
values, so an upgraded installation can already hold rows that carry something
else, and those keep rendering as a raw slug (or as nothing) on the board no
matter what future writes do. CLAUDE.md pitfall #20 is explicit that a
canonical shape needs the migration that settles the rows already there, and
that a reader-side conversion is a stopgap.

**Scope is deliberately narrow: only values outside the vocabulary are
touched.** In particular ``date_flexibility = 'specific_dates'`` on a request
that names no date is left alone. The normalizer rewrites that at intake,
because claiming specific dates without giving one walks past the department's
minimum-notice gate — but that gate only ever runs at intake, and the value
renders correctly. Rewriting it here would restate a requester's own answer on
a historical record to fix nothing a reader can see.

``outreach_type`` is deliberately not touched either. Unlike these three it is
per-organization configurable, so a value not in today's list may be a type the
department genuinely offered and has since retired. Rewriting it to ``other``
would destroy that, and the type still renders through its stored slug.

Guarded on the table existing. ``event_requests`` is one of the 40 tables no
migration creates — it comes into being when ``main.py``'s ``_fast_path_init()``
calls ``create_all()`` — and CI runs ``alembic upgrade head`` against an empty
database, so reflecting it unguarded would kill the whole upgrade (CLAUDE.md
pitfall #26). Skipping is correct rather than merely safe: a database without
the table has no rows to settle.

**Irreversible, and the downgrade is a deliberate no-op.** The original
off-list values are not recorded anywhere, so there is nothing to restore, and
the values written here are valid under the reverted code too — it read the
same vocabularies, it just had no writer that guaranteed them.

Revision ID: 0533644945cd
Revises: d19b2c2ae9b9
Create Date: 2026-09-10 02:23:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0533644945cd"
down_revision: Union[str, None] = "d19b2c2ae9b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (column, allowed values, value an off-list entry settles onto). Mirrors
# DATE_FLEXIBILITIES / VENUE_PREFERENCES / TIMES_OF_DAY and the defaults in
# app/services/event_request_service.normalize_request_preferences.
_VOCABULARIES = (
    (
        "date_flexibility",
        ("specific_dates", "general_timeframe", "flexible"),
        "flexible",
    ),
    (
        "venue_preference",
        ("their_location", "our_station", "either"),
        "their_location",
    ),
    (
        "preferred_time_of_day",
        ("morning", "afternoon", "evening", "flexible"),
        "flexible",
    ),
)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("event_requests"):
        return

    bind = op.get_bind()
    for column, allowed, fallback in _VOCABULARIES:
        placeholders = ", ".join(f":v{i}" for i in range(len(allowed)))
        params = {f"v{i}": value for i, value in enumerate(allowed)}
        params["fallback"] = fallback
        # NULL is left as NULL: preferred_time_of_day is nullable, and absent is
        # not the same claim as "flexible".
        bind.execute(
            sa.text(
                f"UPDATE event_requests SET {column} = :fallback "
                f"WHERE {column} IS NOT NULL AND {column} NOT IN ({placeholders})"
            ),
            params,
        )


def downgrade() -> None:
    """No-op — see "Irreversible" in the module docstring."""
