"""Program requirement deadline and completion markers

``program_requirements.custom_deadline_days`` and ``notification_message``
were stored by clone and import and read by nothing. They are now read: a
requirement with a deadline is due that many days after the member's cycle
began, the member is reminded on the program's ramp and then told once that it
is overdue, and the completion message is emailed when they finish it. Each of
those must go out once, so ``requirement_progress`` gains the markers that say
what was already sent, all nullable:

* ``due_warning_sent_for`` / ``due_warning_days_before`` — the due date and
  the ramp step of the last warning;
* ``overdue_notice_sent_for`` — the due date the overdue notice named;
* ``completion_notice_sent_at`` — when the completion message went out.

The due-date markers start empty on purpose: the due date is derived, so a
member whose requirement already carries a deadline is reminded from the next
sweep, and one already past it gets a single overdue notice. The completion
marker is backfilled for every row already completed or verified, because
"not yet announced" there would email a message for a completion that
happened before this upgrade — possibly years before.

Every step is guarded on the table and the column, so a re-run and a database
built by ``create_all`` are both no-ops. The downgrade drops the four columns;
what they recorded is bookkeeping only, so nothing else is lost.

Revision ID: 5372d41aaf3e
Revises: a51a4e1d2443
Create Date: 2026-10-12 19:16:43.062614

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5372d41aaf3e"
down_revision: Union[str, None] = "a51a4e1d2443"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "requirement_progress"

_COLUMNS = (
    ("due_warning_sent_for", sa.Date),
    ("due_warning_days_before", sa.Integer),
    ("overdue_notice_sent_for", sa.Date),
    ("completion_notice_sent_at", lambda: sa.DateTime(timezone=True)),
)


def _has_table(bind, table: str) -> bool:
    return table in sa.inspect(bind).get_table_names()


def _columns(bind, table: str) -> set:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, _TABLE):
        return
    existing = _columns(bind, _TABLE)
    added_completion_marker = False
    for name, type_ in _COLUMNS:
        if name not in existing:
            op.add_column(_TABLE, sa.Column(name, type_(), nullable=True))
            added_completion_marker |= name == "completion_notice_sent_at"
    # Only when the column is new: on a re-run the stamps are live state.
    if added_completion_marker:
        bind.execute(
            sa.text(
                f"UPDATE {_TABLE} "
                "SET completion_notice_sent_at = COALESCE(completed_at, CURRENT_TIMESTAMP) "
                "WHERE status IN ('completed', 'verified')"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, _TABLE):
        return
    existing = _columns(bind, _TABLE)
    for name, _type in reversed(_COLUMNS):
        if name in existing:
            op.drop_column(_TABLE, name)
