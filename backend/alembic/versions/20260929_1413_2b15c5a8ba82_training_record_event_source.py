"""Link a training record to the event attendance that credited it.

Finalizing attendance on a Training event now writes each attendee's completed
training record itself. Until now the only link between a record and the event
behind it was the course name plus the event's date, and that key does not
hold: an event's title can be edited after it is finalized, its start can move
after a reopen, and a manually entered record with the same name and date was
indistinguishable from the one attendance wrote. ``source_event_id`` names the
event whose finalize authored (or adopted) the row, so reopening, correcting and
re-finalizing updates that one row in place instead of adding a second.

The unique ``(source_event_id, user_id)`` index is what makes the upsert safe
under concurrency — an RSVP is unique per event and member, so so is its
credit — and it also serves as the index MySQL requires behind the foreign key.
Rows with a NULL ``source_event_id`` (manual entries, self-reported
submissions, provider imports, everything that predates this revision) are not
constrained: MySQL and MariaDB both admit any number of NULLs under a unique
index.

Nothing is backfilled. Existing records keep a NULL source, and the department
corrects a past event by reopening its attendance and finalizing it again,
which adopts the record a member's own check-in started (session-backed events)
or writes a new one.

**Reversible, with one consequence.** The downgrade drops the foreign key, then
the index (MySQL refuses to drop an index still backing a foreign key), then the
column. The links are lost with it: after a later re-upgrade, a session-backed
event re-adopts its rows through the course-name-and-date lookup, but a Training
event with no session writes a second row the next time it is finalized.

Revision ID: 2b15c5a8ba82
Revises: fb7da5b05833
Create Date: 2026-09-29 14:13:58.487208
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "2b15c5a8ba82"
down_revision = "fb7da5b05833"
branch_labels = None
depends_on = None

_TABLE = "training_records"
_COLUMN = "source_event_id"
_INDEX = "uq_training_record_event_user"
_FK = "fk_training_records_source_event_id_events"


def _has_column(column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(_TABLE)}


def _has_index(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {ix["name"] for ix in inspector.get_indexes(_TABLE)}


def _foreign_keys_on(column: str) -> list[str]:
    """Names of the foreign keys constraining ``column`` alone.

    An installation whose column came from startup's ``create_all`` carries the
    model's constraint under whatever name was generated there; the downgrade
    drops what exists rather than assuming ``_FK``.
    """
    inspector = sa.inspect(op.get_bind())
    return [
        fk["name"]
        for fk in inspector.get_foreign_keys(_TABLE)
        if fk.get("name") and fk.get("constrained_columns") == [column]
    ]


def upgrade() -> None:
    # ``training_records`` is created by 20260118_0003, so it is present on
    # every upgrade path and needs no table guard (CLAUDE.md pitfall #26). The
    # step guards are still load-bearing: startup's create_all and column
    # repair can build the column, index or key from the model first.
    if not _has_column(_COLUMN):
        op.add_column(
            _TABLE,
            sa.Column(_COLUMN, sa.String(length=36), nullable=True),
        )
    # The index goes in before the foreign key so MySQL adopts it as the key's
    # backing index rather than creating a second one of its own.
    if not _has_index(_INDEX):
        op.create_index(_INDEX, _TABLE, [_COLUMN, "user_id"], unique=True)
    if not _foreign_keys_on(_COLUMN):
        # SET NULL, and so nullable (CLAUDE.md pitfall #2): deleting an event
        # must not delete, or block deleting, the training history it credited.
        op.create_foreign_key(
            _FK, _TABLE, "events", [_COLUMN], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    if _has_column(_COLUMN):
        for name in _foreign_keys_on(_COLUMN):
            op.drop_constraint(name, _TABLE, type_="foreignkey")
    if _has_index(_INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    if _has_column(_COLUMN):
        op.drop_column(_TABLE, _COLUMN)
