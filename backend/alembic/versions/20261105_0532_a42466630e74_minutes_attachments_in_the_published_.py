"""Minutes attachments in the published copy; meeting action item reminder emails

Two owner decisions of 2026-11-01 (``docs/KNOWN_LIMITATIONS.md``, "Meeting
Minutes — What Record Keeping Does Not Do"):

* ``minutes_attachments.published_at`` — when the file was included in the
  library copy published to Documents. The published copy's readers may open a
  file only while this is set, so a file added after publishing (a signed copy)
  is not reachable through the published copy until the minutes are published
  again. Existing rows stay NULL: nothing published before this change listed
  its attachments, and the next publish sets it.
* ``meeting_action_items.reminder_emailed_on`` — the department-local day a
  due-date reminder was last emailed for the item, so a second run of the
  reminder task on the same day sends nothing. Existing rows stay NULL, which
  reads as "never emailed": the first run after the upgrade emails only items
  whose reminder day it is.

Both columns are nullable, so rows already present need nothing settled.
``20260312_0200`` renamed the original ``meeting_action_items`` away, and the
table of that name the models declare today comes back when the application
starts and runs ``create_all``. An upgrade from an empty database reaches this
revision before that, so each step is skipped when its table is absent; a
table built later is built from the models, which declare the column.

Revision ID: a42466630e74
Revises: 219455a5d79c
Create Date: 2026-11-05 05:32:42.813239

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a42466630e74"
down_revision: Union[str, None] = "219455a5d79c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ATTACHMENTS = "minutes_attachments"
MEETING_ITEMS = "meeting_action_items"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_table(ATTACHMENTS) and not _has_column(ATTACHMENTS, "published_at"):
        op.add_column(
            ATTACHMENTS,
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        )
    if _has_table(MEETING_ITEMS) and not _has_column(
        MEETING_ITEMS, "reminder_emailed_on"
    ):
        op.add_column(
            MEETING_ITEMS,
            sa.Column("reminder_emailed_on", sa.Date(), nullable=True),
        )


def downgrade() -> None:
    if _has_table(MEETING_ITEMS) and _has_column(MEETING_ITEMS, "reminder_emailed_on"):
        op.drop_column(MEETING_ITEMS, "reminder_emailed_on")
    if _has_table(ATTACHMENTS) and _has_column(ATTACHMENTS, "published_at"):
        op.drop_column(ATTACHMENTS, "published_at")
