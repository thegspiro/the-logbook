"""add prospect inactive_since for auto purge

Adds ``prospective_members.inactive_since``, the clock the daily
``membership_auto_purge`` task reads: an ``inactive`` application is purged
once ``inactive_since`` is at least its pipeline's ``purge_days_after_inactive``
old, and an application whose ``inactive_since`` is NULL is never purged.

**Why not ``deactivated_at``.** That column already exists
(``77d4aa7798dd``), but it is history the applicant drawer displays as
"Deactivated:", backfilled from the activity log and never cleared. Auto-purge
needs a clock that follows the current status and, below, one that restarts at
this upgrade — overwriting ``deactivated_at`` for that would replace the date a
department sees with the date it upgraded.

**The clock starts at the upgrade for anything already inactive.** Every
application that is ``inactive`` when this revision runs gets
``inactive_since = <UTC now at migration time>``, deliberately *not* its real
deactivation date. Until this revision the Auto-Purge setting was stored and
never read, so a department may have switched it on years ago without ever
seeing it act; dating the clock from the real deactivation would let the first
nightly run permanently delete every long-inactive application at once. With
this backfill nothing already inactive is purged until a full grace period has
elapsed after the upgrade, which leaves time to notice and reactivate or
switch the setting off. The backfill fills only NULLs, so a re-run cannot move
a clock a later status change wrote.

The downgrade drops the column. The backfilled values are the migration's own
run time and carry no information worth preserving; a clock written by a
status change after the upgrade is lost, and on a later re-upgrade restarts at
that re-upgrade, which errs towards keeping records rather than deleting them.

Revision ID: feecd81eef2d
Revises: c62a98b47406
Create Date: 2026-10-09 04:20:38.440559

"""

from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "feecd81eef2d"
down_revision: Union[str, None] = "c62a98b47406"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "prospective_members"
COLUMN = "inactive_since"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded both ways: the table may not exist yet on a database that has
    # not started the app (CLAUDE.md pitfall #26), and repair_schema.py may
    # already have added the column from the model.
    if not _has_table(TABLE):
        return
    if not _has_column(TABLE, COLUMN):
        op.add_column(
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )

    # Python-side timestamp rather than NOW(): the value is UTC regardless of
    # the server's time_zone setting, like every other stored datetime here.
    op.get_bind().execute(
        sa.text(
            f"UPDATE {TABLE} SET {COLUMN} = :now "
            f"WHERE status = 'inactive' AND {COLUMN} IS NULL"
        ),
        {"now": datetime.now(timezone.utc).replace(tzinfo=None)},
    )


def downgrade() -> None:
    if _has_table(TABLE) and _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)
