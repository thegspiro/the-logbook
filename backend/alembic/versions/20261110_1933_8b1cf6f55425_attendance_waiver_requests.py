"""Attendance waiver requests

Revision ID: 8b1cf6f55425
Revises: 67ad01c43434
Create Date: 2026-11-10 19:33:33.284719

Adds ``attendance_waiver_requests`` and its decision log,
``attendance_waiver_request_actions`` (owner decisions, 2026-11-10): a member
asks to be excused from one session, and an approver decides. See
``app/models/attendance_waiver.py`` for the column choices, notably why
``live_key`` is a nullable unique column (MySQL has no partial unique index)
and why ``event_id`` is SET NULL rather than CASCADE.

Two new tables, so no existing row is touched and nothing needs settling
(CLAUDE.md pitfall #35). Each is created only when absent, so a database whose
tables ``create_all`` already built — a fresh install stamped at head — is
left alone, and running the upgrade twice is harmless. Both reference only
``organizations``, ``users`` and ``events``, which the initial migrations
create, so neither depends on a table only ``create_all`` builds.

The feature stays off until a training officer saves a policy (the policy
lives in ``organizations.settings``, which needs no migration), so the tables
stay empty until then.

The downgrade drops both tables and every request and decision with them.
Nothing else in the schema refers to them, so the previous release boots
against the downgraded database; an approved request no longer excuses its
session once its row is gone, so take a backup (``scripts/backup.sh``) before
downgrading past this revision once requests are in use.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b1cf6f55425"
down_revision: Union[str, None] = "67ad01c43434"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUESTS = "attendance_waiver_requests"
ACTIONS = "attendance_waiver_request_actions"
# The tables the keys point at, named so the migration's test can point it at
# scratch copies; each is created by the initial migrations.
ORGANIZATIONS = "organizations"
USERS = "users"
EVENTS = "events"

IX_REQUESTS_STATUS = "ix_attendance_waiver_requests_org_workflow_status"
IX_REQUESTS_USER_DATE = "ix_attendance_waiver_requests_org_user_date"
IX_REQUESTS_EVENT = "ix_attendance_waiver_requests_event"
IX_ACTIONS_REQUEST = "ix_attendance_waiver_request_actions_request_id"
IX_ACTIONS_ORG_REQUEST = "ix_attendance_waiver_request_actions_org_request"

# Inlined rather than imported from the model: a migration must keep doing
# what it did the day it ran, and the model's enums are free to change.
_WORKFLOWS = ("training_session", "business_meeting")
_STATUSES = ("pending", "approved", "denied", "withdrawn", "voided")
_ACTIONS = ("submitted", "withdrawn", "approved", "denied", "chief_override", "voided")


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()
    if REQUESTS not in existing:
        op.create_table(
            REQUESTS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "workflow",
                sa.Enum(*_WORKFLOWS, name="attendancewaiverworkflow"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey(f"{USERS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(36),
                sa.ForeignKey(f"{EVENTS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("event_title_snapshot", sa.String(255), nullable=False),
            sa.Column(
                "event_start_snapshot", sa.DateTime(timezone=True), nullable=False
            ),
            sa.Column("session_date", sa.Date(), nullable=False),
            sa.Column(
                "status",
                sa.Enum(*_STATUSES, name="attendancewaiverstatus"),
                nullable=False,
                server_default="pending",
            ),
            sa.Column("live_key", sa.String(100), nullable=True, unique=True),
            sa.Column("category", sa.String(100), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column(
                "submitted_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "decided_by",
                sa.String(36),
                sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "chief_override",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
        )
        op.create_index(
            IX_REQUESTS_STATUS, REQUESTS, ["organization_id", "workflow", "status"]
        )
        op.create_index(
            IX_REQUESTS_USER_DATE,
            REQUESTS,
            ["organization_id", "user_id", "session_date"],
        )
        op.create_index(IX_REQUESTS_EVENT, REQUESTS, ["event_id"])

    if ACTIONS not in existing:
        op.create_table(
            ACTIONS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "request_id",
                sa.String(36),
                sa.ForeignKey(f"{REQUESTS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "action",
                sa.Enum(*_ACTIONS, name="attendancewaiveraction"),
                nullable=False,
            ),
            sa.Column(
                "actor_id",
                sa.String(36),
                sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )
        op.create_index(IX_ACTIONS_REQUEST, ACTIONS, ["request_id"])
        op.create_index(
            IX_ACTIONS_ORG_REQUEST, ACTIONS, ["organization_id", "request_id"]
        )


def downgrade() -> None:
    # The log first: it references the requests.
    op.execute(f"DROP TABLE IF EXISTS {ACTIONS}")
    op.execute(f"DROP TABLE IF EXISTS {REQUESTS}")
