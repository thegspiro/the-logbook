"""Anonymised members: relabel path-less attachment names, re-excuse waivers

Two repairs for members anonymised before this revision
(``users.anonymized_at`` set), matching what ``member_anonymization_service``
now does at the time of anonymisation.

**Path-less attachment entries.** Old text-only attachments became
``{"file_name": ...}`` entries with no stored file (``0c22a95b94b8``). Their
name is whatever the uploader typed, often the member's own name, and
anonymisation relabelled only entries naming a stored file. Each dict entry on
an anonymised member's submissions (``submitted_by``) and records
(``user_id``) with no ``file_path`` gets the neutral label the service uses:
``certificate`` on a submission, ``attachment`` on a record, keeping a
plausible extension lower-cased. Entries naming a stored file were relabelled
when the member was anonymised and are left alone, as are bare strings, NULL
and anything not a list.

**Excused meetings.** Every attendance reader counts a meeting as excused
from a non-blank ``meeting_attendees.waiver_reason``. Anonymisation cleared the
column, so each excused meeting turned into an absence and the member's
attendance figure fell. A waiver always writes ``waiver_granted_at`` beside
the reason and an approved request also writes ``waiver_request_id``; revoking
one clears all three together. So an anonymised member's row with a blank
reason and either of those set was a waiver, and gets the neutral wording
``Excused: approved request`` with no category, as the service now writes.

No column, constraint or index changes, so no existing row can fail this
(pitfall #35). A second run finds nothing left to change.

**Irreversible.** The original names and reasons were destroyed by the
anonymisation itself; this revision only writes neutral values over what was
already removed. The downgrade does nothing: putting the blanks back would
re-create the bug, and nothing earlier reads the difference.

``_neutral_name`` and the label table are frozen here rather than imported,
so later edits to the service cannot change what this revision does.

Revision ID: 1f3a6c2d9e40
Revises: b6e3d1f47a29
Create Date: 2026-11-23 12:00:00.000000
"""

import os
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1f3a6c2d9e40"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
USERS_TABLE = "users"
RECORDS_TABLE = "training_records"
SUBMISSIONS_TABLE = "training_submissions"
ATTENDEES_TABLE = "meeting_attendees"

_BATCH = 500
_WAIVER_TEXT = "Excused: approved request"


def _neutral_name(label: str, file_name: Any) -> str:
    """Frozen: *label* plus the name's extension when it is plausible
    (letters and digits, at most five), lower-cased; otherwise bare."""
    extension = os.path.splitext(file_name)[1] if isinstance(file_name, str) else ""
    if 1 < len(extension) <= 6 and extension[1:].isalnum():
        return label + extension.lower()
    return label


def _relabel(value: Any, label: str) -> Any:
    """Frozen: every dict entry without a ``file_path`` gets *label*."""
    if not isinstance(value, list):
        return value
    out = []
    for entry in value:
        if isinstance(entry, dict) and not entry.get("file_path"):
            name = _neutral_name(label, entry.get("file_name"))
            if entry.get("file_name") != name:
                entry = {**entry, "file_name": name}
        out.append(entry)
    return out


def _tables(bind) -> set:
    return set(sa.inspect(bind).get_table_names())


def _relabel_table(bind, table_name: str, owner: str, label: str) -> None:
    users = sa.table(
        USERS_TABLE,
        sa.column("id", sa.String(36)),
        sa.column("anonymized_at", sa.DateTime),
    )
    table = sa.table(
        table_name,
        sa.column("id", sa.String(36)),
        sa.column(owner, sa.String(36)),
        sa.column("attachments", sa.JSON),
    )
    anonymised = sa.select(users.c.id).where(users.c.anonymized_at.isnot(None))
    last_id = ""
    while True:
        rows = bind.execute(
            sa.select(table.c.id, table.c.attachments)
            .where(
                table.c.attachments.isnot(None),
                table.c[owner].in_(anonymised),
                table.c.id > last_id,
            )
            .order_by(table.c.id)
            .limit(_BATCH)
        ).all()
        if not rows:
            return
        for row in rows:
            changed = _relabel(row.attachments, label)
            if changed != row.attachments:
                bind.execute(
                    sa.update(table)
                    .where(table.c.id == row.id)
                    .values(attachments=changed)
                )
        last_id = rows[-1].id


def _re_excuse(bind) -> None:
    users = sa.table(
        USERS_TABLE,
        sa.column("id", sa.String(36)),
        sa.column("anonymized_at", sa.DateTime),
    )
    attendees = sa.table(
        ATTENDEES_TABLE,
        sa.column("user_id", sa.String(36)),
        sa.column("waiver_reason", sa.Text),
        sa.column("waiver_granted_at", sa.DateTime),
        sa.column("waiver_request_id", sa.String(36)),
    )
    bind.execute(
        sa.update(attendees)
        .where(
            attendees.c.user_id.in_(
                sa.select(users.c.id).where(users.c.anonymized_at.isnot(None))
            ),
            sa.or_(
                attendees.c.waiver_reason.is_(None), attendees.c.waiver_reason == ""
            ),
            sa.or_(
                attendees.c.waiver_granted_at.isnot(None),
                attendees.c.waiver_request_id.isnot(None),
            ),
        )
        .values(waiver_reason=_WAIVER_TEXT)
    )


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)
    # All four are built by migrations, so the guards are defensive
    # (pitfall #26).
    if USERS_TABLE not in tables:
        return
    if SUBMISSIONS_TABLE in tables:
        _relabel_table(bind, SUBMISSIONS_TABLE, "submitted_by", "certificate")
    if RECORDS_TABLE in tables:
        _relabel_table(bind, RECORDS_TABLE, "user_id", "attachment")
    if ATTENDEES_TABLE in tables:
        _re_excuse(bind)


def downgrade() -> None:
    """Irreversible by design; see the module docstring."""
