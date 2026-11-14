"""The Department Overview report's action-item counts respect meeting and
minutes visibility (RPT6-29-5).

MM-21 (security-review pass 13, 2026-11-10) closed this exact gap on the
dashboard's unified action-items feed: a baseline member — holding neither
``meetings.manage`` nor ``minutes.manage`` — could have a draft or
executive-session meeting's action items counted (and, on that feed, listed)
even though the Meetings and Minutes APIs themselves withhold the owning
record from the same caller. That PR flagged, in this feature's own scope,
that ``reports_service.py``'s ``_generate_department_overview`` reads the
identical two models with no equivalent restriction — discloses only a count,
never a description, but reached at ``reports.view`` alone, well below
``meetings.manage``/``minutes.manage``.

The fix reuses ``meeting_visibility_filter``/``minutes_visibility_filter``
(``app/api/v1/endpoints/dashboard.py``, already unit-tested in
``test_dashboard_action_item_visibility.py``) rather than re-deriving the
rule (Pitfall #29).
"""

import uuid
from datetime import date, datetime, timezone

import pytest

from app.models.meeting import (
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    MeetingStatus,
    MeetingType,
)
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesMeetingType,
    MinutesStatus,
)
from app.models.user import Organization, Position, User
from app.services.reports_service import ReportsService

pytestmark = pytest.mark.integration


async def _department(db_session):
    org = Organization(
        name="Overview FD", slug=f"ovr-{uuid.uuid4().hex[:10]}", timezone="UTC"
    )
    db_session.add(org)
    await db_session.flush()

    async def member(name, permissions):
        handle = uuid.uuid4().hex[:8]
        position = Position(
            organization_id=org.id,
            name=f"{name} {handle}",
            slug=f"{name.lower()}-{handle}",
            permissions=permissions,
        )
        db_session.add(position)
        await db_session.flush()
        user = User(
            organization_id=org.id,
            username=f"{name}-{handle}",
            first_name=name.title(),
            last_name="Member",
            email=f"{name}-{handle}@overview.org",
        )
        user.positions = [position]
        db_session.add(user)
        await db_session.flush()
        return user

    baseline = await member("baseline", ["reports.view"])
    manager = await member(
        "manager", ["reports.view", "meetings.manage", "minutes.manage"]
    )

    meetings = {}
    for label, meeting_type, status in (
        ("published", MeetingType.BUSINESS, MeetingStatus.APPROVED),
        ("draft", MeetingType.BUSINESS, MeetingStatus.DRAFT),
        ("executive", MeetingType.EXECUTIVE, MeetingStatus.APPROVED),
    ):
        meeting = Meeting(
            organization_id=org.id,
            title=label,
            meeting_type=meeting_type,
            status=status,
            meeting_date=date(2026, 10, 1),
        )
        db_session.add(meeting)
        meetings[label] = meeting
    await db_session.flush()
    for label, meeting in meetings.items():
        db_session.add(
            MeetingActionItem(
                organization_id=org.id,
                meeting_id=meeting.id,
                description=f"{label} item",
                status=ActionItemStatus.OPEN,
            )
        )
    # An item from the executive-session meeting, assigned to the baseline
    # member themself — must count for them even though they otherwise
    # cannot see that meeting (the assignee carve-out).
    db_session.add(
        MeetingActionItem(
            organization_id=org.id,
            meeting_id=meetings["executive"].id,
            description="executive item assigned to baseline",
            status=ActionItemStatus.OPEN,
            assigned_to=baseline.id,
        )
    )

    minutes = {}
    for label, meeting_type, status in (
        ("published", MinutesMeetingType.BUSINESS, MinutesStatus.APPROVED),
        ("draft", MinutesMeetingType.BUSINESS, MinutesStatus.DRAFT),
        ("executive", MinutesMeetingType.EXECUTIVE, MinutesStatus.APPROVED),
    ):
        record = MeetingMinutes(
            organization_id=org.id,
            title=label,
            meeting_type=meeting_type,
            status=status,
            meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        )
        db_session.add(record)
        minutes[label] = record
    await db_session.flush()
    for label, record in minutes.items():
        db_session.add(
            ActionItem(
                minutes_id=record.id,
                description=f"{label} minutes item",
                status=MinutesActionItemStatus.PENDING,
            )
        )
    db_session.add(
        ActionItem(
            minutes_id=minutes["executive"].id,
            description="executive minutes item assigned to baseline",
            status=MinutesActionItemStatus.PENDING,
            assignee_id=baseline.id,
        )
    )
    await db_session.flush()
    return org, baseline, manager


@pytest.mark.integration
class TestDepartmentOverviewActionItemVisibility:
    async def test_baseline_member_sees_only_visible_items_plus_their_own(
        self, db_session
    ):
        org, baseline, _manager = await _department(db_session)
        report = await ReportsService(db_session)._generate_department_overview(
            org.id, current_user=baseline
        )
        # published (visible) + the executive item assigned to them; the
        # draft meeting/minutes and the *un*assigned executive items are
        # withheld, matching what the Meetings/Minutes APIs themselves would
        # show this caller.
        assert report["action_items"]["open_from_meetings"] == 2
        assert report["action_items"]["open_from_minutes"] == 2

    async def test_manage_holder_sees_every_open_item(self, db_session):
        org, _baseline, manager = await _department(db_session)
        report = await ReportsService(db_session)._generate_department_overview(
            org.id, current_user=manager
        )
        assert report["action_items"]["open_from_meetings"] == 4
        assert report["action_items"]["open_from_minutes"] == 4

    async def test_no_caller_fails_closed_to_the_restricted_view(self, db_session):
        # A scheduled send that somehow reached this with no owner context
        # (every production call site passes one) must never fall back to
        # the unrestricted count.
        org, _baseline, _manager = await _department(db_session)
        report = await ReportsService(db_session)._generate_department_overview(org.id)
        assert report["action_items"]["open_from_meetings"] == 1
        assert report["action_items"]["open_from_minutes"] == 1
