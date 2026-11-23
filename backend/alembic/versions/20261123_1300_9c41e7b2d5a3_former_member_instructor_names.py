"""Anonymised members' names as instructors read "Former member"

Owner decision 2026-11-23: an erased member's name, where it is stored as an
instructor, is replaced with "Former member" — never a blank, which would put
the records on the NFPA completeness report's missing-instructor list.
``app.services.instructor_erasure`` now does this at anonymisation and
permanent delete; this revision applies the same rule to members anonymised
before it (``users.anonymized_at`` set), as the owner's rule covers them too:

* ``event_templates.training_details`` naming the member's id as
  ``instructor_id``: ``instructor`` becomes "Former member" and
  ``instructor_id`` is cleared;
* ``training_sessions`` whose ``instructor_id`` is the member: ``instructor``
  becomes "Former member";
* the attendees' ``training_records`` of each such session (its
  ``event_id`` as their ``source_event_id``) whose ``instructor`` still holds
  the name the session had: it becomes "Former member". Records are rewritten
  before their session, so the session's old name is still there to match.

Members permanently deleted before this cannot be covered: the delete set
``training_sessions.instructor_id`` NULL and left a template's id dangling,
so nothing links either back to them.

No column, constraint or index changes, so no existing row can fail this
(pitfall #35). A second run changes nothing: a rewritten template names no
id, and a session or record already reading "Former member" is skipped.

**Irreversible.** The names are not kept anywhere; the downgrade does nothing.

``_rewrite_details`` is frozen here rather than imported from the service.

Revision ID: 9c41e7b2d5a3
Revises: b6e3d1f47a29
Create Date: 2026-11-23 13:00:00.000000
"""

from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c41e7b2d5a3"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
USERS_TABLE = "users"
TEMPLATES_TABLE = "event_templates"
SESSIONS_TABLE = "training_sessions"
RECORDS_TABLE = "training_records"

_BATCH = 500
FORMER_MEMBER = "Former member"


def _rewrite_details(value: Any, anonymised: set) -> Any:
    """Frozen: a details dict naming an anonymised instructor, rewritten."""
    if not isinstance(value, dict):
        return value
    instructor_id = value.get("instructor_id")
    if instructor_id is None or str(instructor_id) not in anonymised:
        return value
    return {**value, "instructor_id": None, "instructor": FORMER_MEMBER}


def _anonymised_ids(bind) -> set:
    users = sa.table(
        USERS_TABLE,
        sa.column("id", sa.String(36)),
        sa.column("anonymized_at", sa.DateTime),
    )
    return {
        str(row.id)
        for row in bind.execute(
            sa.select(users.c.id).where(users.c.anonymized_at.isnot(None))
        )
    }


def _templates(bind, anonymised: set) -> None:
    table = sa.table(
        TEMPLATES_TABLE,
        sa.column("id", sa.String(36)),
        sa.column("training_details", sa.JSON),
    )
    last_id = ""
    while True:
        rows = bind.execute(
            sa.select(table.c.id, table.c.training_details)
            .where(table.c.training_details.isnot(None), table.c.id > last_id)
            .order_by(table.c.id)
            .limit(_BATCH)
        ).all()
        if not rows:
            return
        for row in rows:
            changed = _rewrite_details(row.training_details, anonymised)
            if changed != row.training_details:
                bind.execute(
                    sa.update(table)
                    .where(table.c.id == row.id)
                    .values(training_details=changed)
                )
        last_id = rows[-1].id


def _sessions_and_records(bind, users: sa.Table, has_records: bool) -> None:
    sessions = sa.table(
        SESSIONS_TABLE,
        sa.column("id", sa.String(36)),
        sa.column("event_id", sa.String(36)),
        sa.column("instructor", sa.String(255)),
        sa.column("instructor_id", sa.String(36)),
    )
    records = sa.table(
        RECORDS_TABLE,
        sa.column("source_event_id", sa.String(36)),
        sa.column("instructor", sa.String(255)),
    )
    last_id = ""
    while True:
        rows = bind.execute(
            sa.select(sessions.c.id, sessions.c.event_id, sessions.c.instructor)
            .where(
                sessions.c.instructor_id.in_(
                    sa.select(users.c.id).where(users.c.anonymized_at.isnot(None))
                ),
                sessions.c.id > last_id,
            )
            .order_by(sessions.c.id)
            .limit(_BATCH)
        ).all()
        if not rows:
            return
        for row in rows:
            if row.instructor == FORMER_MEMBER:
                continue
            if has_records and row.instructor and row.event_id:
                bind.execute(
                    sa.update(records)
                    .where(
                        records.c.source_event_id == row.event_id,
                        records.c.instructor == row.instructor,
                    )
                    .values(instructor=FORMER_MEMBER)
                )
            bind.execute(
                sa.update(sessions)
                .where(sessions.c.id == row.id)
                .values(instructor=FORMER_MEMBER)
            )
        last_id = rows[-1].id


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    # All four are built by migrations, so the guards are defensive
    # (pitfall #26).
    if USERS_TABLE not in tables:
        return
    users = sa.table(
        USERS_TABLE,
        sa.column("id", sa.String(36)),
        sa.column("anonymized_at", sa.DateTime),
    )
    if TEMPLATES_TABLE in tables:
        anonymised = _anonymised_ids(bind)
        if anonymised:
            _templates(bind, anonymised)
    if SESSIONS_TABLE in tables:
        _sessions_and_records(bind, users, RECORDS_TABLE in tables)


def downgrade() -> None:
    """Irreversible by design; see the module docstring."""
