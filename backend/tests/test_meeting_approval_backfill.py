"""Migration 6b81e95d4157 approves the meetings whose minutes are approved.

Run against rows (CLAUDE.md pitfall 35): CI migrates an empty database, where
an UPDATE ... JOIN settles nothing and so proves nothing.
"""

import importlib.util
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import select

from app.models.meeting import Meeting, MeetingStatus, MeetingType
from app.models.minute import MeetingMinutes, MinutesStatus
from app.models.user import Organization, User

pytestmark = pytest.mark.integration

MIGRATION = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_6b81e95d4157_*.py"
    )
)
FIRST = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)


def _module():
    spec = importlib.util.spec_from_file_location("_meeting_backfill", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _run(db, step):
    def run(conn):
        with Operations.context(MigrationContext.configure(conn)):
            getattr(_module(), step)()

    await db.run_sync(lambda session: run(session.connection()))


async def _org(db):
    org = Organization(name="Backfill FD", slug=f"bf-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        organization_id=org.id,
        username=f"u-{uuid.uuid4().hex[:8]}",
        email=f"u-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Pat",
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _meeting(db, org, **extra):
    meeting = Meeting(
        organization_id=org.id,
        title="Business meeting",
        meeting_type=MeetingType.BUSINESS,
        meeting_date=date(2026, 10, 1),
        **extra,
    )
    db.add(meeting)
    await db.flush()
    return meeting


async def _minutes(db, org, meeting, status, approved_at=None, approved_by=None):
    minutes = MeetingMinutes(
        organization_id=org.id,
        title="Business meeting",
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        meeting_id=meeting.id,
        status=status,
        approved_at=approved_at,
        approved_by=approved_by,
    )
    db.add(minutes)
    await db.flush()
    return minutes


async def _state(db, meeting_id):
    row = (
        await db.execute(
            select(Meeting.status, Meeting.approved_at, Meeting.approved_by).where(
                Meeting.id == meeting_id
            )
        )
    ).one()
    stamp = row.approved_at.replace(tzinfo=None) if row.approved_at else None
    return row.status, stamp, row.approved_by


async def test_upgrade_settles_existing_rows_and_downgrade_reverses_them(db_session):
    org = await _org(db_session)
    other = await _org(db_session)
    first_approver = await _user(db_session, org)
    later_approver = await _user(db_session, org)
    own_approver = await _user(db_session, org)

    # Two approved sets of minutes: the earliest approval is the meeting's.
    stamped = await _meeting(db_session, org)
    await _minutes(
        db_session, org, stamped, MinutesStatus.APPROVED, LATER, later_approver.id
    )
    await _minutes(
        db_session, org, stamped, MinutesStatus.APPROVED, FIRST, first_approver.id
    )
    # Approved before approvals were stamped.
    unstamped = await _meeting(db_session, org)
    await _minutes(db_session, org, unstamped, MinutesStatus.APPROVED)
    # Minutes not approved: the meeting stays a draft.
    still_draft = await _meeting(db_session, org)
    await _minutes(db_session, org, still_draft, MinutesStatus.SUBMITTED)
    # Approved through approve_meeting: its own stamp survives both ways.
    own = await _meeting(
        db_session,
        org,
        status=MeetingStatus.APPROVED,
        approved_at=LATER,
        approved_by=own_approver.id,
    )
    await _minutes(
        db_session, org, own, MinutesStatus.APPROVED, FIRST, first_approver.id
    )
    # Minutes in one department pointing at another's meeting change nothing.
    foreign = await _meeting(db_session, other)
    await _minutes(
        db_session, org, foreign, MinutesStatus.APPROVED, FIRST, first_approver.id
    )

    # Read before the raw UPDATEs: expired instances cannot lazy-load here.
    ids = {
        name: m.id
        for name, m in {
            "stamped": stamped,
            "unstamped": unstamped,
            "still_draft": still_draft,
            "own": own,
            "foreign": foreign,
        }.items()
    }
    approvers = {"first": first_approver.id, "own": own_approver.id}

    await _run(db_session, "upgrade")
    db_session.expire_all()

    first = FIRST.replace(tzinfo=None)
    later = LATER.replace(tzinfo=None)
    assert await _state(db_session, ids["stamped"]) == (
        MeetingStatus.APPROVED,
        first,
        approvers["first"],
    )
    assert await _state(db_session, ids["unstamped"]) == (
        MeetingStatus.APPROVED,
        None,
        None,
    )
    assert await _state(db_session, ids["still_draft"]) == (
        MeetingStatus.DRAFT,
        None,
        None,
    )
    assert await _state(db_session, ids["own"]) == (
        MeetingStatus.APPROVED,
        later,
        approvers["own"],
    )
    assert await _state(db_session, ids["foreign"]) == (MeetingStatus.DRAFT, None, None)

    await _run(db_session, "downgrade")
    db_session.expire_all()

    assert await _state(db_session, ids["stamped"]) == (MeetingStatus.DRAFT, None, None)
    assert await _state(db_session, ids["unstamped"]) == (
        MeetingStatus.DRAFT,
        None,
        None,
    )
    assert await _state(db_session, ids["own"]) == (
        MeetingStatus.APPROVED,
        later,
        approvers["own"],
    )
