"""The Meetings API shows a member only approved, non-executive meetings.

meetings.view and minutes.view are baseline member grants. The Minutes API
already limited anyone without minutes.manage to approved, non-executive
records (MM-24), but the sibling Meetings API returned every meeting's notes,
motions, attendance and action items — drafts and executive sessions
included — to every member. ``GET /meetings?meeting_type=executive`` was
enough to read the department's closed-session deliberations.
"""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import meetings as ep
from app.models.meeting import (
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    MeetingStatus,
    MeetingType,
)
from app.models.user import Organization

pytestmark = pytest.mark.integration


def _caller(org, permissions):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        username="caller",
        organization_id=str(org.id),
        rank=None,
        positions=[SimpleNamespace(permissions=permissions)],
        roles=[],
    )


async def _department(db_session):
    org = Organization(
        name="Meetings FD", slug=f"mtg-{uuid.uuid4().hex[:10]}", timezone="UTC"
    )
    db_session.add(org)
    await db_session.flush()
    meetings = {}
    for label, meeting_type, meeting_status in (
        ("published", MeetingType.BUSINESS, MeetingStatus.APPROVED),
        ("draft", MeetingType.BUSINESS, MeetingStatus.DRAFT),
        ("pending", MeetingType.BUSINESS, MeetingStatus.PENDING_APPROVAL),
        ("executive", MeetingType.EXECUTIVE, MeetingStatus.APPROVED),
    ):
        meeting = Meeting(
            organization_id=str(org.id),
            title=label,
            meeting_type=meeting_type,
            status=meeting_status,
            meeting_date=date(2026, 10, 1),
            notes=f"{label} notes",
        )
        db_session.add(meeting)
        meetings[label] = meeting
    await db_session.flush()
    items = {}
    for label, meeting in meetings.items():
        item = MeetingActionItem(
            organization_id=str(org.id),
            meeting_id=meeting.id,
            description=f"{label} item",
            status=ActionItemStatus.OPEN,
        )
        db_session.add(item)
        items[label] = item
    await db_session.flush()
    return org, meetings, items


async def _titles(db_session, caller, **filters):
    result = await ep.list_meetings(
        meeting_type=filters.get("meeting_type"),
        status=filters.get("status"),
        search=None,
        from_date=None,
        skip=0,
        limit=100,
        db=db_session,
        current_user=caller,
    )
    return sorted(m.title for m in result["meetings"])


class TestMemberView:
    async def test_the_list_holds_only_the_published_meeting(self, db_session):
        org, _, _ = await _department(db_session)
        member = _caller(org, ["meetings.view", "minutes.view"])

        assert await _titles(db_session, member) == ["published"]

    async def test_asking_for_executive_sessions_returns_none(self, db_session):
        org, _, _ = await _department(db_session)
        member = _caller(org, ["meetings.view", "minutes.view"])

        assert await _titles(db_session, member, meeting_type="executive") == []
        assert await _titles(db_session, member, status="draft") == []

    @pytest.mark.parametrize("label", ["draft", "pending", "executive"])
    async def test_an_unpublished_meeting_answers_not_found(self, db_session, label):
        org, meetings, _ = await _department(db_session)
        member = _caller(org, ["meetings.view", "minutes.view"])

        with pytest.raises(HTTPException) as exc:
            await ep.get_meeting(
                uuid.UUID(meetings[label].id), db=db_session, current_user=member
            )

        assert exc.value.status_code == 404

    async def test_the_published_meeting_is_readable(self, db_session):
        org, meetings, _ = await _department(db_session)
        member = _caller(org, ["meetings.view", "minutes.view"])

        meeting = await ep.get_meeting(
            uuid.UUID(meetings["published"].id), db=db_session, current_user=member
        )

        assert meeting.notes == "published notes"

    async def test_open_action_items_come_only_from_the_published_meeting(
        self, db_session
    ):
        org, _, items = await _department(db_session)
        member = _caller(org, ["meetings.view", "minutes.view"])

        listed = await ep.get_open_action_items(
            assigned_to=None, db=db_session, current_user=member
        )

        assert [i.id for i in listed] == [items["published"].id]


class TestManagerView:
    @pytest.mark.parametrize("grant", ["meetings.manage", "minutes.manage"])
    async def test_a_manager_sees_every_meeting(self, db_session, grant):
        org, meetings, _ = await _department(db_session)
        manager = _caller(org, [grant, "meetings.view"])

        assert await _titles(db_session, manager) == sorted(meetings)
        executive = await ep.get_meeting(
            uuid.UUID(meetings["executive"].id), db=db_session, current_user=manager
        )
        assert executive.notes == "executive notes"


class TestSummaryCounts:
    async def test_a_members_tiles_count_only_what_their_list_shows(
        self, db_session, monkeypatch
    ):
        org, _, _ = await _department(db_session)
        monkeypatch.setattr(
            "app.services.meetings_service.resolve_org_today",
            AsyncMock(return_value=date(2026, 10, 15)),
        )
        member = _caller(org, ["meetings.view", "minutes.view"])

        summary = await ep.get_meetings_summary(db=db_session, current_user=member)

        assert summary == {
            "total_meetings": 1,
            "meetings_this_month": 1,
            "open_action_items": 1,
            "pending_approval": 0,
        }

    async def test_a_managers_tiles_count_everything(self, db_session, monkeypatch):
        org, _, _ = await _department(db_session)
        monkeypatch.setattr(
            "app.services.meetings_service.resolve_org_today",
            AsyncMock(return_value=date(2026, 10, 15)),
        )
        manager = _caller(org, ["meetings.manage"])

        summary = await ep.get_meetings_summary(db=db_session, current_user=manager)

        assert summary == {
            "total_meetings": 4,
            "meetings_this_month": 4,
            "open_action_items": 4,
            "pending_approval": 1,
        }
