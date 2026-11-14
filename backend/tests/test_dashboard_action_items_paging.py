"""DASH-40: the unified action-item feed is paged, and pages the merged list.

Owner decision 2026-11-01 ("page or cap"). ``GET /dashboard/action-items``
keeps the bare list it always answered and is capped at 200;
``GET /dashboard/action-items/page`` pages it with totals. Both merge meeting
and minutes items. A page has to be cut from the *merged* order,
or page one holds the soonest meeting items and the soonest minutes items while
a minutes item due before the last of them waits for page two. The totals
describe every matching row, so the Action Items screen's tiles do not shrink
to the page size, and "open" and "overdue" are counted with the same
predicates as the dashboard's tile (Pitfall #29).

Real rows, because the property is the order MySQL returns them in.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints.dashboard import (
    ACTION_ITEMS_LIST_CAP,
    ACTION_ITEMS_PAGE_MAX,
    get_action_items_page,
    get_admin_summary,
    get_unified_action_items,
    router,
)
from app.models.meeting import (
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    MeetingStatus,
)
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesStatus,
)
from app.models.user import Organization, User

pytestmark = pytest.mark.integration

TODAY = date(2026, 11, 5)


def _day(offset: int) -> date:
    return TODAY + timedelta(days=offset)


async def _org(db):
    org = Organization(name="Paging FD", slug=f"pg-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, first="Alice"):
    user = User(
        organization_id=org.id,
        username=f"{first.lower()}-{uuid.uuid4().hex[:8]}",
        email=f"{first.lower()}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=first,
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _meeting(db, org, title="October business meeting"):
    # Approved, not the DRAFT default: MM-21 (security-review pass 13) confines
    # a meetings.view-only caller to approved, non-executive meetings here too,
    # and what this file's tests check (paging, caps, labeling) does not
    # depend on meeting status — the same reasoning 9e5e8b7d8 already applied
    # to the Meetings API's own test fixtures.
    meeting = Meeting(
        organization_id=org.id,
        title=title,
        meeting_date=_day(-30),
        status=MeetingStatus.APPROVED,
    )
    db.add(meeting)
    await db.flush()
    return meeting


async def _minutes(db, org):
    minutes = MeetingMinutes(
        organization_id=org.id,
        title="October minutes",
        meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        status=MinutesStatus.APPROVED,
    )
    db.add(minutes)
    await db.flush()
    return minutes


async def _meeting_item(db, meeting, label, due, **kwargs):
    item = MeetingActionItem(
        meeting_id=meeting.id,
        organization_id=meeting.organization_id,
        description=label,
        due_date=due,
        **kwargs,
    )
    db.add(item)
    await db.flush()
    return item


async def _minutes_item(db, minutes, label, due, **kwargs):
    item = ActionItem(
        minutes_id=minutes.id,
        description=label,
        due_date=(
            datetime.combine(due, datetime.min.time(), timezone.utc) if due else None
        ),
        status=kwargs.pop("status", MinutesActionItemStatus.PENDING),
        **kwargs,
    )
    db.add(item)
    await db.flush()
    return item


def _caller(org, *granted):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        positions=[],
        permissions=list(granted),
    )


async def _feed(db, user, **kwargs):
    return await _call(get_action_items_page, db, user, **kwargs)


async def _list(db, user, **kwargs):
    return await _call(get_unified_action_items, db, user, **kwargs)


async def _call(route, db, user, **kwargs):
    granted = set(user.permissions)
    with patch(
        "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["minutes"])),
    ), patch(
        "app.api.v1.endpoints.dashboard.user_has_permission",
        side_effect=lambda _user, permission: permission in granted,
    ), patch(
        "app.api.v1.endpoints.dashboard.resolve_org_today",
        new=AsyncMock(return_value=TODAY),
    ):
        return await route(db=db, current_user=user, **kwargs)


def _labels(page):
    return [item.description for item in page.items]


async def _interleaved(db):
    """Meeting items due on odd days, minutes items on even days, and one
    undated item in each half."""
    org = await _org(db)
    meeting = await _meeting(db, org)
    minutes = await _minutes(db, org)
    for n in (1, 3, 5):
        await _meeting_item(db, meeting, f"day {n}", _day(n))
    for n in (2, 4, 6):
        await _minutes_item(db, minutes, f"day {n}", _day(n))
    await _meeting_item(db, meeting, "undated meeting", None)
    await _minutes_item(db, minutes, "undated minutes", None)
    return org, meeting, minutes


class TestPagesCutFromTheMergedOrder:
    async def test_each_page_continues_where_the_last_ended(self, db_session):
        org, _, _ = await _interleaved(db_session)
        user = _caller(org, "minutes.manage", "minutes.view")

        first = await _feed(db_session, user, limit=3, offset=0)
        second = await _feed(db_session, user, limit=3, offset=3)
        third = await _feed(db_session, user, limit=3, offset=6)

        assert _labels(first) == ["day 1", "day 2", "day 3"]
        assert _labels(second) == ["day 4", "day 5", "day 6"]
        # Undated items come last, from both halves.
        assert set(_labels(third)) == {"undated meeting", "undated minutes"}

    async def test_totals_count_every_match_not_the_page(self, db_session):
        org, _, _ = await _interleaved(db_session)
        user = _caller(org, "minutes.manage", "minutes.view")

        page = await _feed(db_session, user, limit=2, offset=0)

        assert len(page.items) == 2
        assert page.total == 8
        assert page.open_total == 8
        assert page.overdue_total == 0
        assert (page.limit, page.offset) == (2, 0)

    async def test_the_page_size_is_capped(self):
        limit = _limit_param("/action-items/page")
        assert _maximum(limit) == ACTION_ITEMS_PAGE_MAX == 200


def _limit_param(path):
    route = next(
        r
        for r in router.routes
        if getattr(r, "path", None) == path and "GET" in getattr(r, "methods", set())
    )
    return next(p for p in route.dependant.query_params if p.name == "limit")


def _maximum(param):
    return next(m.le for m in param.field_info.metadata if hasattr(m, "le"))


class TestTheBareListStaysAList:
    """The route existing clients call keeps its shape and is capped, rather
    than turning into a page object (owner: no breaking API change where a
    non-breaking route will do)."""

    async def test_it_answers_the_merged_list_it_always_did(self, db_session):
        org, _, _ = await _interleaved(db_session)
        user = _caller(org, "minutes.manage", "minutes.view")

        items = await _list(db_session, user)

        assert isinstance(items, list)
        assert [i.description for i in items[:6]] == [f"day {n}" for n in range(1, 7)]
        assert len(items) == 8

    async def test_it_is_capped_by_default(self, db_session):
        org = await _org(db_session)
        meeting = await _meeting(db_session, org)
        db_session.add_all(
            MeetingActionItem(
                meeting_id=meeting.id,
                organization_id=org.id,
                description=f"item {n}",
                due_date=_day(n % 30),
            )
            for n in range(ACTION_ITEMS_LIST_CAP + 5)
        )
        await db_session.flush()
        user = _caller(org, "meetings.view")

        items = await _list(db_session, user)

        assert len(items) == ACTION_ITEMS_LIST_CAP == 200
        assert _maximum(_limit_param("/action-items")) == 200
        assert _limit_param("/action-items").default == 200


class TestOpenAndOverdue:
    async def test_open_matches_the_minutes_modules_own_rule(self, db_session):
        """A hand-set ``overdue`` is still open; a carried-forward item is open
        in the later minutes, not here; closed items are not open."""
        org = await _org(db_session)
        meeting = await _meeting(db_session, org)
        minutes = await _minutes(db_session, org)
        await _meeting_item(db_session, meeting, "meeting open", _day(-2))
        await _meeting_item(
            db_session,
            meeting,
            "meeting done",
            _day(-2),
            status=ActionItemStatus.COMPLETED,
        )
        await _minutes_item(
            db_session,
            minutes,
            "marked overdue",
            _day(-1),
            status=MinutesActionItemStatus.OVERDUE,
        )
        await _minutes_item(
            db_session,
            minutes,
            "carried",
            _day(-1),
            carried_forward_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        )
        await _minutes_item(
            db_session,
            minutes,
            "cancelled",
            _day(-1),
            status=MinutesActionItemStatus.CANCELLED,
        )
        user = _caller(org, "minutes.manage", "minutes.view")

        everything = await _feed(db_session, user)
        assert everything.total == 5
        assert everything.open_total == 2
        assert everything.overdue_total == 2
        carried = next(i for i in everything.items if i.description == "carried")
        assert carried.carried_forward is True

        opened = await _feed(db_session, user, open_only=True)
        assert sorted(_labels(opened)) == ["marked overdue", "meeting open"]
        assert opened.total == 2

        late = await _feed(db_session, user, overdue=True)
        assert sorted(_labels(late)) == ["marked overdue", "meeting open"]

    async def test_the_dashboard_tile_counts_what_the_open_filter_lists(
        self, db_session
    ):
        org = await _org(db_session)
        meeting = await _meeting(db_session, org)
        minutes = await _minutes(db_session, org)
        await _meeting_item(db_session, meeting, "meeting open", _day(-2))
        await _minutes_item(
            db_session,
            minutes,
            "marked overdue",
            _day(-1),
            status=MinutesActionItemStatus.OVERDUE,
        )
        for label in ("carried once", "carried twice"):
            await _minutes_item(
                db_session,
                minutes,
                label,
                _day(-3),
                carried_forward_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            )
        user = _caller(org, "minutes.manage", "minutes.view", "settings.manage")

        # RPT6-29-6: the admin-summary tile now reads user_has_permission too
        # (via meeting_visibility_filter/minutes_visibility_filter), so this
        # fake caller's `.permissions` list needs the same mock `_call` uses
        # for the other routes below, or it falls through to the real
        # permission resolver, which this SimpleNamespace cannot satisfy.
        with patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["minutes"])),
        ), patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(return_value=TODAY),
        ), patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in set(user.permissions),
        ):
            summary = await get_admin_summary(db=db_session, current_user=user)
        listed = await _feed(db_session, user, open_only=True)

        assert summary.open_action_items == listed.total == 2
        assert summary.overdue_action_items == listed.overdue_total == 2


class TestAdminSummaryRespectsVisibility:
    """RPT6-29-6: the admin-summary tile and the feed it implicitly agrees
    with (DASH-37/40's own invariant) must count the same rows for a caller
    who holds neither ``meetings.manage`` nor ``minutes.manage`` — including
    when that caller does hold the unrelated ``settings.manage`` the route
    itself is gated on. Before this fix, the tile counted every item in the
    organization regardless of the caller's meetings/minutes permissions."""

    async def test_settings_manage_alone_gets_the_restricted_count(self, db_session):
        org = await _org(db_session)
        visible_meeting = await _meeting(db_session, org, "Visible meeting")
        executive_meeting = Meeting(
            organization_id=org.id,
            title="Executive session",
            meeting_date=_day(-30),
            status=MeetingStatus.APPROVED,
            meeting_type="executive",
        )
        db_session.add(executive_meeting)
        minutes = await _minutes(db_session, org)
        executive_minutes = MeetingMinutes(
            organization_id=org.id,
            title="Executive minutes",
            meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
            status=MinutesStatus.APPROVED,
            meeting_type="executive",
        )
        db_session.add(executive_minutes)
        await db_session.flush()

        await _meeting_item(
            db_session, visible_meeting, "visible meeting item", _day(-2)
        )
        await _meeting_item(
            db_session, executive_meeting, "closed meeting item", _day(-2)
        )
        await _minutes_item(db_session, minutes, "visible minutes item", _day(-1))
        await _minutes_item(
            db_session, executive_minutes, "closed minutes item", _day(-1)
        )

        caller = _caller(org, "settings.manage")

        with patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["minutes"])),
        ), patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(return_value=TODAY),
        ), patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in set(caller.permissions),
        ):
            summary = await get_admin_summary(db=db_session, current_user=caller)
        # Both items are due in the past, so a caller who could see every
        # row would get 4 for each figure; restricted to the two visible
        # ones, both counts are 2 — proving the restriction, not just that
        # the closed items dropped out of one of the two tallies.
        assert summary.open_action_items == 2
        assert summary.overdue_action_items == 2

    async def test_minutes_manage_still_gets_the_full_count(self, db_session):
        """A manage holder's count is unchanged by this fix."""
        org = await _org(db_session)
        visible_meeting = await _meeting(db_session, org, "Visible meeting")
        executive_meeting = Meeting(
            organization_id=org.id,
            title="Executive session",
            meeting_date=_day(-30),
            status=MeetingStatus.APPROVED,
            meeting_type="executive",
        )
        db_session.add(executive_meeting)
        await db_session.flush()
        await _meeting_item(
            db_session, visible_meeting, "visible meeting item", _day(-2)
        )
        await _meeting_item(
            db_session, executive_meeting, "closed meeting item", _day(-2)
        )

        caller = _caller(org, "meetings.manage", "minutes.manage", "settings.manage")

        with patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["minutes"])),
        ), patch(
            "app.api.v1.endpoints.dashboard.resolve_org_today",
            new=AsyncMock(return_value=TODAY),
        ), patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission in set(caller.permissions),
        ):
            summary = await get_admin_summary(db=db_session, current_user=caller)

        assert summary.open_action_items == 2


class TestFilters:
    async def test_assignee_and_meeting_narrow_the_list(self, db_session):
        org = await _org(db_session)
        alice = await _member(db_session, org, "Alice")
        bob = await _member(db_session, org, "Bob")
        first = await _meeting(db_session, org, "First meeting")
        second = await _meeting(db_session, org, "Second meeting")
        minutes = await _minutes(db_session, org)
        await _meeting_item(
            db_session, first, "alice first", _day(1), assigned_to=alice.id
        )
        await _meeting_item(
            db_session, second, "bob second", _day(2), assigned_to=bob.id
        )
        await _minutes_item(
            db_session, minutes, "alice minutes", _day(3), assignee_id=alice.id
        )
        user = _caller(org, "minutes.manage", "minutes.view")

        alices = await _feed(db_session, user, assignee_id=alice.id)
        assert _labels(alices) == ["alice first", "alice minutes"]
        assert alices.total == 2

        seconds = await _feed(db_session, user, source="meeting", source_id=second.id)
        assert _labels(seconds) == ["bob second"]

    async def test_meeting_items_name_their_assignee_and_meeting(self, db_session):
        org = await _org(db_session)
        alice = await _member(db_session, org, "Alice")
        meeting = await _meeting(db_session, org, "Budget meeting")
        await _meeting_item(
            db_session, meeting, "price engines", _day(1), assigned_to=alice.id
        )
        user = _caller(org, "meetings.view")

        page = await _feed(db_session, user, source="meeting")

        (item,) = page.items
        assert item.assignee_name == alice.display_name
        assert item.source_title == "Budget meeting"
        assert item.due_date == _day(1).isoformat()

    async def test_filters_never_reach_another_department(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        theirs = await _meeting(db_session, other)
        await _meeting_item(db_session, theirs, "their item", _day(1))
        user = _caller(org, "minutes.manage", "minutes.view")

        page = await _feed(db_session, user, source_id=theirs.id)

        assert page.items == []
        assert page.total == 0
