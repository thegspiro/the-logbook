"""Attendance waiver follow-ups: questions, expiry and rescheduling

Revision ID: 5e2b9c7d1a40
Revises: 533f8aba187e
Create Date: 2026-11-13 12:00:00

Owner decisions of 2026-11-13 extend the waiver request workflow
(``8b1cf6f55425``):

* a decider may ask the member for more information, and the member answers
  (``info_requested`` / ``member_responded`` actions, and
  ``attendance_waiver_requests.info_requested_at`` while the question is open);
* a request still undecided seven days after its session expires (an
  ``expired`` status and action);
* a session that moves sends the request back to the member to confirm
  (``rescheduled`` / ``member_confirmed`` actions, and
  ``attendance_waiver_requests.reconfirm_requested_at`` while it waits).

Widening an ENUM keeps every existing value, and both new columns are
nullable with no default, so every existing row reads as it did: no question
open, no reconfirmation pending (CLAUDE.md pitfall #35). Each step checks the
live schema first, so a database whose tables ``create_all`` built from the
current models is left alone and a second run changes nothing.

The downgrade turns the new states back into ones the previous release knows
before narrowing the ENUMs: an expired request becomes ``voided`` (closed,
slot freed, which is what expiry means), and the new decision-log rows are
deleted. The question and answer text in those rows is lost; take a backup
(``scripts/backup.sh``) before downgrading once the workflow is in use.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5e2b9c7d1a40"
down_revision: Union[str, None] = "533f8aba187e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUESTS = "attendance_waiver_requests"
ACTIONS = "attendance_waiver_request_actions"

# Inlined rather than imported from the model: a migration must keep doing
# what it did the day it ran, and the model's enums are free to change.
_OLD_STATUSES = ("pending", "approved", "denied", "withdrawn", "voided")
_NEW_STATUSES = _OLD_STATUSES + ("expired",)
_OLD_ACTIONS = (
    "submitted",
    "withdrawn",
    "approved",
    "denied",
    "chief_override",
    "voided",
)
_ADDED_ACTIONS = (
    "info_requested",
    "member_responded",
    "expired",
    "rescheduled",
    "member_confirmed",
)
_NEW_ACTIONS = _OLD_ACTIONS + _ADDED_ACTIONS
_COLUMNS = ("info_requested_at", "reconfirm_requested_at")


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def _columns(table: str) -> dict:
    return {c["name"]: c for c in sa.inspect(op.get_bind()).get_columns(table)}


def _enum_values(column: dict) -> tuple:
    return tuple(getattr(column["type"], "enums", ()) or ())


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if REQUESTS in tables:
        columns = _columns(REQUESTS)
        if "expired" not in _enum_values(columns["status"]):
            op.alter_column(
                REQUESTS,
                "status",
                existing_type=_enum(_OLD_STATUSES),
                type_=_enum(_NEW_STATUSES),
                existing_nullable=False,
                existing_server_default="pending",
            )
        for name in _COLUMNS:
            if name not in columns:
                op.add_column(
                    REQUESTS,
                    sa.Column(name, sa.DateTime(timezone=True), nullable=True),
                )
    if ACTIONS in tables:
        action = _columns(ACTIONS)["action"]
        if "member_confirmed" not in _enum_values(action):
            op.alter_column(
                ACTIONS,
                "action",
                existing_type=_enum(_OLD_ACTIONS),
                type_=_enum(_NEW_ACTIONS),
                existing_nullable=False,
            )


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if ACTIONS in tables:
        action = _columns(ACTIONS)["action"]
        if "member_confirmed" in _enum_values(action):
            op.execute(
                sa.text(f"DELETE FROM {ACTIONS} WHERE action IN :added").bindparams(
                    sa.bindparam("added", value=list(_ADDED_ACTIONS), expanding=True)
                )
            )
            op.alter_column(
                ACTIONS,
                "action",
                existing_type=_enum(_NEW_ACTIONS),
                type_=_enum(_OLD_ACTIONS),
                existing_nullable=False,
            )
    if REQUESTS in tables:
        columns = _columns(REQUESTS)
        if "expired" in _enum_values(columns["status"]):
            op.execute(
                sa.text(
                    f"UPDATE {REQUESTS} SET status = 'voided', live_key = NULL "
                    "WHERE status = 'expired'"
                )
            )
            op.alter_column(
                REQUESTS,
                "status",
                existing_type=_enum(_NEW_STATUSES),
                type_=_enum(_OLD_STATUSES),
                existing_nullable=False,
                existing_server_default="pending",
            )
        for name in _COLUMNS:
            if name in columns:
                op.drop_column(REQUESTS, name)
