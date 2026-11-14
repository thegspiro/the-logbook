"""Dues schedule terms take effect, and dues reminders are sent once

Owner decisions of 2026-11-01 ("Build them"; "My dues view + email
reminders"):

* ``dues_schedules.terms_effective_at`` — when the schedule's grace period,
  late fee, fiscal year and membership types started to apply. NULL means they
  never have: generation bills every active member and no late fee is charged,
  exactly as before this revision. Every schedule that exists when this runs is
  left NULL, so nothing an installation already has changes behaviour on
  upgrade — a late fee or membership list that was stored through the API but
  never read does not start charging or narrowing anyone (CLAUDE.md pitfalls
  #19 and #35). Saving the schedule from the dues screen sets it.
* ``member_dues.due_reminder_sent_at`` and ``overdue_reminder_sent_at`` — the
  markers that make the daily dues reminder email go to a member at most once
  per record and kind (pitfall #36).

The late-fee marker already exists: ``member_dues.late_fee_applied`` has been
stored and never written. Nothing is backfilled; every new column starts NULL,
which is what each reader treats as "not yet". Either table may be built by
``create_all`` rather than a migration, so each step is skipped when its table
is absent.

The downgrade drops the three columns; which schedules had their terms in
effect, and which reminders were sent, are lost with them (a re-upgrade would
leave every schedule legacy again and could resend a reminder).

Revision ID: ba80cc574948
Revises: ee9ff4596ce7
Create Date: 2026-11-06 06:07:28.343524

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ba80cc574948"
down_revision: Union[str, None] = "ee9ff4596ce7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEDULES = "dues_schedules"
DUES = "member_dues"
DUES_COLUMNS = ("due_reminder_sent_at", "overdue_reminder_sent_at")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if _has_table(SCHEDULES) and "terms_effective_at" not in _columns(SCHEDULES):
        op.add_column(
            SCHEDULES,
            sa.Column("terms_effective_at", sa.DateTime(timezone=True), nullable=True),
        )

    if _has_table(DUES):
        existing = _columns(DUES)
        for name in DUES_COLUMNS:
            if name not in existing:
                op.add_column(
                    DUES, sa.Column(name, sa.DateTime(timezone=True), nullable=True)
                )


def downgrade() -> None:
    if _has_table(DUES):
        existing = _columns(DUES)
        for name in DUES_COLUMNS:
            if name in existing:
                op.drop_column(DUES, name)

    if _has_table(SCHEDULES) and "terms_effective_at" in _columns(SCHEDULES):
        op.drop_column(SCHEDULES, "terms_effective_at")
