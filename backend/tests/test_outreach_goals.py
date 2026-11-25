"""Yearly outreach goals, against real rows.

The owner's rules (2026-11-24): a goal targets a CRR count or one of Outreach
Impact's headline figures for a calendar year in the department's timezone;
progress is what the same screens count; pace is the target scaled by how much
of the year has gone.
"""

import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints import crr as crr_endpoints
from app.api.v1.endpoints.crr import create_activity, get_catalogue
from app.api.v1.endpoints.dashboard import get_community_engagement
from app.api.v1.endpoints.outreach_goals import (
    create_goal,
    delete_goal,
    list_goals,
    router,
    update_goal,
)
from app.models.event import Event, EventType
from app.models.user import Organization, User, UserStatus
from app.schemas.crr import CrrActivityCreate
from app.schemas.outreach_goal import OutreachGoalCreate, OutreachGoalUpdate
from app.services.community_engagement_service import CommunityEngagementService
from app.services.outreach_goal_service import OutreachGoalService
from tests.clock_support import reread_each_test

pytestmark = pytest.mark.integration

NEW_YORK = ZoneInfo("America/New_York")


def _clock() -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    # Last year in the department's zone: a finished year whatever today is.
    last_year = now.astimezone(NEW_YORK).year - 1
    return {"NOW": now, "LAST_YEAR": last_year}


NOW, LAST_YEAR = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


def _local(year, month, day, hour=12):
    return datetime(year, month, day, hour, tzinfo=NEW_YORK)


@pytest.fixture(autouse=True)
def _no_permission_lookups(monkeypatch):
    # Recording an activity asks user_has_permission for crr.view_contact;
    # the answer does not change what these tests count.
    monkeypatch.setattr(crr_endpoints, "user_has_permission", lambda user, p: False)


async def _org(db_session, label):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
        mailing_country="USA",
    )
    db_session.add(org)
    await db_session.flush()
    user = User(
        organization_id=org.id,
        username=f"{label.lower()}-{org.id[:8]}",
        email=f"{label.lower()}-{org.id[:8]}@example.test",
        first_name="Member",
        last_name=label,
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return org, user


@pytest.fixture
async def dept(db_session):
    return await _org(db_session, "Goals")


async def _alarms(db_session, user):
    catalogue = await get_catalogue(db=db_session, current_user=user)
    smoke = next(t for t in catalogue.activity_types if t.code == "smoke_alarm_install")
    return smoke, smoke.measures[0]


async def _install(db_session, user, smoke, alarms, when, quantity):
    await create_activity(
        body=CrrActivityCreate(
            activity_type_id=smoke.id,
            occurred_at=when,
            counts={alarms.id: quantity},
        ),
        db=db_session,
        current_user=user,
    )


async def _goal(db_session, user, **fields):
    return await create_goal(
        body=OutreachGoalCreate(**fields), db=db_session, current_user=user
    )


class TestSettingGoals:
    async def test_a_count_and_a_figure_can_each_have_a_goal(self, db_session, dept):
        _, user = dept
        _, alarms = await _alarms(db_session, user)

        await _goal(db_session, user, year=LAST_YEAR, target=200, measure_id=alarms.id)
        listed = await _goal(
            db_session,
            user,
            year=LAST_YEAR,
            target=40,
            outreach_metric="events_held",
        )

        assert [(g.label, g.target) for g in listed.goals] == [
            ("Events held", 40),
            ("Smoke alarm install · Alarms installed", 200),
        ]
        assert [m.value for m in listed.metrics] == [
            "events_held",
            "people_reached",
            "member_hours",
        ]

    async def test_a_second_goal_for_the_same_figure_is_refused(self, db_session, dept):
        _, user = dept
        await _goal(
            db_session, user, year=LAST_YEAR, target=10, outreach_metric="events_held"
        )
        with pytest.raises(HTTPException) as caught:
            await _goal(
                db_session,
                user,
                year=LAST_YEAR,
                target=12,
                outreach_metric="events_held",
            )
        assert caught.value.status_code == 400
        assert "already a goal" in caught.value.detail

    async def test_the_same_figure_may_have_a_goal_in_another_year(
        self, db_session, dept
    ):
        _, user = dept
        await _goal(
            db_session, user, year=LAST_YEAR, target=10, outreach_metric="events_held"
        )
        listed = await _goal(
            db_session,
            user,
            year=LAST_YEAR + 1,
            target=12,
            outreach_metric="events_held",
        )
        assert [g.target for g in listed.goals] == [12]

    async def test_another_departments_count_is_refused(self, db_session, dept):
        _, user = dept
        _, other_user = await _org(db_session, "Other")
        _, theirs = await _alarms(db_session, other_user)
        with pytest.raises(HTTPException) as caught:
            await _goal(
                db_session, user, year=LAST_YEAR, target=5, measure_id=theirs.id
            )
        assert caught.value.status_code == 400

    def test_a_goal_names_exactly_one_figure_and_a_positive_target(self):
        with pytest.raises(ValidationError):
            OutreachGoalCreate(year=2026, target=5)
        with pytest.raises(ValidationError):
            OutreachGoalCreate(
                year=2026, target=5, measure_id="m", outreach_metric="events_held"
            )
        with pytest.raises(ValidationError):
            OutreachGoalCreate(year=2026, target=0, outreach_metric="events_held")
        with pytest.raises(ValidationError):
            OutreachGoalCreate(year=2026, target=5, outreach_metric="requests")


class TestProgress:
    async def test_a_count_sums_only_its_own_year_in_the_departments_zone(
        self, db_session, dept
    ):
        org, user = dept
        smoke, alarms = await _alarms(db_session, user)
        await _goal(db_session, user, year=LAST_YEAR, target=100, measure_id=alarms.id)
        await _install(db_session, user, smoke, alarms, _local(LAST_YEAR, 3, 1), 30)
        await _install(db_session, user, smoke, alarms, _local(LAST_YEAR, 11, 20), 20)
        # 31 December, 11pm in New York, is already 1 January in UTC: it is
        # still last year's work.
        await _install(
            db_session, user, smoke, alarms, _local(LAST_YEAR, 12, 31, 23), 5
        )
        await _install(
            db_session, user, smoke, alarms, _local(LAST_YEAR + 1, 1, 1, 1), 7
        )

        report = await OutreachGoalService(db_session).progress(str(org.id), LAST_YEAR)

        [goal] = report["goals"]
        assert goal["actual"] == 55
        assert (goal["met"], report["year_complete"]) == (False, True)

    async def test_pace_is_the_target_scaled_by_the_year_gone(self, db_session, dept):
        org, user = dept
        smoke, alarms = await _alarms(db_session, user)
        await _goal(db_session, user, year=LAST_YEAR, target=200, measure_id=alarms.id)
        await _install(db_session, user, smoke, alarms, _local(LAST_YEAR, 2, 1), 90)
        # Work later in the year has not happened yet at the moment asked about.
        await _install(db_session, user, smoke, alarms, _local(LAST_YEAR, 9, 1), 80)
        service = OutreachGoalService(db_session)

        midyear = _local(LAST_YEAR, 7, 2, 0).astimezone(timezone.utc)
        report = await service.progress(str(org.id), LAST_YEAR, now=midyear)

        [goal] = report["goals"]
        assert goal["actual"] == 90
        assert 0.49 < report["year_fraction"] < 0.51
        assert 98 < goal["pace_target"] < 102
        assert goal["on_pace"] is False
        assert report["year_complete"] is False

        later = _local(LAST_YEAR, 3, 1).astimezone(timezone.utc)
        report = await service.progress(str(org.id), LAST_YEAR, now=later)
        assert report["goals"][0]["on_pace"] is True

    async def test_a_met_goal_says_so(self, db_session, dept):
        org, user = dept
        smoke, alarms = await _alarms(db_session, user)
        await _goal(db_session, user, year=LAST_YEAR, target=10, measure_id=alarms.id)
        await _install(db_session, user, smoke, alarms, _local(LAST_YEAR, 5, 5), 12)

        [goal] = (
            await OutreachGoalService(db_session).progress(str(org.id), LAST_YEAR)
        )["goals"]

        assert (goal["met"], goal["on_pace"]) == (True, True)

    async def test_an_outreach_figure_agrees_with_outreach_impact(
        self, db_session, dept
    ):
        org, user = dept
        for month in (4, 8):
            db_session.add(
                Event(
                    organization_id=org.id,
                    title=f"Safety day {month}",
                    event_type=EventType.PUBLIC_EDUCATION,
                    start_datetime=_local(LAST_YEAR, month, 10),
                    end_datetime=_local(LAST_YEAR, month, 10, 15),
                )
            )
        db_session.add(
            Event(
                organization_id=org.id,
                title="Board meeting",
                event_type=EventType.BUSINESS_MEETING,
                start_datetime=_local(LAST_YEAR, 6, 1),
                end_datetime=_local(LAST_YEAR, 6, 1, 14),
            )
        )
        await db_session.flush()
        await _goal(
            db_session, user, year=LAST_YEAR, target=3, outreach_metric="events_held"
        )
        service = OutreachGoalService(db_session)
        start, end = service.year_bounds(LAST_YEAR, org)

        [goal] = (await service.progress(str(org.id), LAST_YEAR))["goals"]
        totals = await CommunityEngagementService(db_session).window_totals(
            str(org.id), start, end
        )

        assert goal["actual"] == totals.events_held == 2

    async def test_another_departments_work_is_not_counted(self, db_session, dept):
        org, user = dept
        _, alarms = await _alarms(db_session, user)
        _, other_user = await _org(db_session, "Elsewhere")
        their_smoke, their_alarms = await _alarms(db_session, other_user)
        await _install(
            db_session,
            other_user,
            their_smoke,
            their_alarms,
            _local(LAST_YEAR, 5, 5),
            40,
        )
        await _goal(db_session, user, year=LAST_YEAR, target=10, measure_id=alarms.id)

        [goal] = (
            await OutreachGoalService(db_session).progress(str(org.id), LAST_YEAR)
        )["goals"]

        assert goal["actual"] == 0


class TestChangingGoals:
    async def test_a_target_is_changed_and_a_goal_removed(self, db_session, dept):
        _, user = dept
        listed = await _goal(
            db_session, user, year=LAST_YEAR, target=10, outreach_metric="events_held"
        )
        goal_id = listed.goals[0].id

        changed = await update_goal(
            goal_id=goal_id,
            body=OutreachGoalUpdate(target=25),
            db=db_session,
            current_user=user,
        )
        assert changed.goals[0].target == 25

        await delete_goal(goal_id=goal_id, db=db_session, current_user=user)
        remaining = await list_goals(year=LAST_YEAR, db=db_session, current_user=user)
        assert remaining.goals == []

    async def test_another_departments_goal_reads_as_not_found(self, db_session, dept):
        _, user = dept
        _, other_user = await _org(db_session, "Someone")
        theirs = await _goal(
            db_session,
            other_user,
            year=LAST_YEAR,
            target=10,
            outreach_metric="events_held",
        )
        goal_id = theirs.goals[0].id

        for attempt in (
            update_goal(
                goal_id=goal_id,
                body=OutreachGoalUpdate(target=1),
                db=db_session,
                current_user=user,
            ),
            delete_goal(goal_id=goal_id, db=db_session, current_user=user),
        ):
            with pytest.raises(HTTPException) as caught:
                await attempt
            assert caught.value.status_code == 404


class TestOnOutreachImpact:
    async def test_the_report_carries_this_years_goals(self, db_session, dept):
        org, user = dept
        this_year = NOW.astimezone(NEW_YORK).year
        await _goal(
            db_session, user, year=this_year, target=10, outreach_metric="events_held"
        )
        await _goal(
            db_session, user, year=LAST_YEAR, target=99, outreach_metric="events_held"
        )

        report = await get_community_engagement(
            period="all", db=db_session, current_user=user
        )

        assert report.goals.year == this_year
        assert [g.target for g in report.goals.goals] == [10]


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("", "GET"),
        ("", "POST"),
        ("/{goal_id}", "PATCH"),
        ("/{goal_id}", "DELETE"),
    ],
)
def test_every_goal_route_needs_events_manage(path, method):
    route = next(
        r
        for r in router.routes
        if getattr(r, "path", None) == path and method in getattr(r, "methods", ())
    )
    [checker] = [
        d.call
        for d in route.dependant.dependencies
        if isinstance(d.call, PermissionChecker)
    ]
    assert checker.required_permissions == ["events.manage"]
