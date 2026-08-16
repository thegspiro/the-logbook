"""Backfill is_finalized on shifts that predate the finalization feature

20260328_0100 added shifts.is_finalized with server_default="0" and no
backfill. The member-hours report now counts only finalized shifts, so
every shift worked before finalization existed silently reads as zero
hours in payroll-style reports.

Cutoff: shifts whose end datetime (start datetime when end_time is NULL)
predates 2026-03-28 — the date the finalization workflow shipped
(revision 20260328_0100). Such shifts could never have gone through the
finalize workflow, so leaving them unfinalized encodes nothing; marking
them finalized restores their hours to reports. A per-install cutoff (the
date each deployment actually upgraded past 20260328_0100) would be more
precise, but Alembic records no timestamps for applied revisions, so that
date is not knowable from the database — the feature's introduction date
is the latest bound that is provably legacy on every install. Shifts
after the cutoff are left alone: officers can finalize those through the
workflow.

finalized_at / finalized_by stay NULL — they record an officer actually
closing the shift, which never happened for these rows. That NULL is also
what makes downgrade() exact: every workflow-finalized shift has
finalized_at set (scheduling_service.finalize_shift), so is_finalized=1
with finalized_at IS NULL before the cutoff identifies precisely the rows
this backfill touched.

Idempotent: the UPDATE's WHERE clause matches only rows still at
is_finalized = 0, so a re-run changes nothing.

Revision ID: 20260816_0002
Revises: 20260816_0001
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from alembic import op

revision = "20260816_0002"
down_revision = "20260816_0001"
branch_labels = None
depends_on = None

# All shift datetimes are stored UTC (see CLAUDE.md / models).
_CUTOFF = "2026-03-28 00:00:00"


def _shifts_ready(bind) -> bool:
    """The table can be absent (fresh installs materialize model tables via
    create_all after migrations); skip cleanly — new tables have no legacy
    rows to repair."""
    inspector = sa.inspect(bind)
    if "shifts" not in inspector.get_table_names():
        return False
    columns = {col["name"] for col in inspector.get_columns("shifts")}
    return "is_finalized" in columns


def upgrade() -> None:
    bind = op.get_bind()
    if not _shifts_ready(bind):
        return

    bind.execute(
        sa.text(
            "UPDATE shifts "
            "SET is_finalized = 1 "
            "WHERE is_finalized = 0 "
            "AND COALESCE(end_time, start_time) < :cutoff"
        ),
        {"cutoff": _CUTOFF},
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _shifts_ready(bind):
        return

    # Revert only rows this migration set: pre-cutoff, finalized, but with
    # no finalized_at — the workflow always stamps finalized_at, so these
    # cannot be officer-finalized shifts.
    bind.execute(
        sa.text(
            "UPDATE shifts "
            "SET is_finalized = 0 "
            "WHERE is_finalized = 1 "
            "AND finalized_at IS NULL "
            "AND COALESCE(end_time, start_time) < :cutoff"
        ),
        {"cutoff": _CUTOFF},
    )
