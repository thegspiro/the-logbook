"""Review queues added to the admin hubs' "Needs attention" lists.

Four rows, each something an officer has to decide before anyone else can
move: a skills test awaiting validation, a shift report awaiting review (or
flagged), a member's request to be marked present, and an order window left
open past its close time.

Each count must be the length of the list its link opens. Two of them share
the very predicate that list uses (`pending_validation_criteria`,
`pending_petition_criteria`), and the tests below pin the cases where a
hand-written count would drift from it: practice tests, validated tests,
the viewer's own request, another department's rows.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.event import (
    AttendancePetitionStatus,
    Event,
    EventAttendancePetition,
    EventType,
)
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.storefront import StoreOrderWindow, StoreWindowStatus
from app.models.training import ShiftCompletionReport, TrainingModuleConfig
from app.models.user import Organization, Position, User, UserStatus
from app.services.admin_hub_service import MODULE_REGISTRY, AdminHubService

pytestmark = pytest.mark.integration

PERMISSIONS = ["training.manage", "events.manage", "storefront.manage"]


def _now() -> datetime:
    # Per test, not at import: a run that crosses midnight UTC would otherwise
    # age every timestamp by a day.
    return datetime.now(timezone.utc).replace(microsecond=0)


async def _org(db_session, *, modules: dict | None = None) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Review Queue Department",
        slug=f"queues-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={
            "modules": {
                "scheduling": True,
                "storefront": True,
                "_user_configured": True,
                **(modules or {}),
            }
        },
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, *, permissions: list[str] | None = None) -> User:
    handle = uuid.uuid4().hex[:10]
    positions: list[Position] = []
    if permissions:
        position = Position(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name=f"Officer {handle}",
            slug=f"officer-{handle}",
            permissions=permissions,
        )
        db_session.add(position)
        await db_session.flush()
        positions.append(position)
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"queue-{handle}",
        email=f"{handle}@queues.test",
        first_name="Pat",
        last_name="Lee",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    # Assigned even when empty: on a freshly flushed User the collection is
    # unloaded, and a permission check would be deferred IO under asyncio.
    user.positions = positions
    db_session.add(user)
    await db_session.flush()
    return user


async def _queue(db_session, user, module_key: str) -> dict:
    """Run the resolver directly; `get_summary` would swallow a failure."""
    ctx = await AdminHubService(db_session)._context(user)
    items = await MODULE_REGISTRY[module_key].attention(ctx)
    return {item.key: item for item in items}


# ── Skills tests awaiting validation ─────────────────────────────────────────


async def _template(db_session, org) -> SkillTemplate:
    template = SkillTemplate(
        organization_id=org.id,
        name=f"SCBA Donning {uuid.uuid4().hex[:6]}",
        sections=[{"title": "Donning", "criteria": []}],
        status="published",
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _skill_test(
    db_session,
    org,
    template,
    candidate,
    examiner,
    *,
    status: str = "completed",
    practice: bool = False,
    validated: bool = False,
    days_ago: int = 0,
) -> SkillTest:
    stamp = _now() - timedelta(days=days_ago)
    test = SkillTest(
        organization_id=org.id,
        template_id=template.id,
        candidate_id=candidate.id,
        examiner_id=examiner.id,
        status=status,
        result="pass",
        is_practice=practice,
        started_at=stamp,
        completed_at=stamp if status == "completed" else None,
        created_at=stamp,
        validated_at=stamp if validated else None,
    )
    db_session.add(test)
    await db_session.flush()
    return test


class TestSkillTestsAwaitingValidation:
    async def test_counts_an_official_result_nobody_has_signed_off(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        member = await _user(db_session, org)
        template = await _template(db_session, org)
        await _skill_test(db_session, org, template, member, member, days_ago=3)

        item = (await _queue(db_session, officer, "training"))[
            "skill_tests_awaiting_validation"
        ]

        assert item.count == 1
        assert item.oldest_age_days == 3
        # The records tab's own filter, so the list it opens has this length.
        assert item.href == (
            "/training/admin?page=evaluations&tab=tests&status=pending_validation"
        )

    async def test_leaves_out_what_the_review_queue_leaves_out(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        member = await _user(db_session, org)
        template = await _template(db_session, org)
        # Practice is never validated; a validated one is done; one still in
        # progress is not waiting on an officer.
        await _skill_test(db_session, org, template, member, member, practice=True)
        await _skill_test(db_session, org, template, member, member, validated=True)
        await _skill_test(
            db_session, org, template, member, member, status="in_progress"
        )

        queue = await _queue(db_session, officer, "training")

        assert "skill_tests_awaiting_validation" not in queue

    async def test_does_not_count_another_departments_tests(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        officer = await _user(db_session, mine, permissions=PERMISSIONS)
        stranger = await _user(db_session, theirs)
        template = await _template(db_session, theirs)
        await _skill_test(db_session, theirs, template, stranger, stranger)

        queue = await _queue(db_session, officer, "training")

        assert "skill_tests_awaiting_validation" not in queue


# ── Shift reports awaiting review ────────────────────────────────────────────


async def _report(db_session, org, trainee, *, review_status: str, days_ago=0):
    report = ShiftCompletionReport(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        trainee_id=trainee.id,
        officer_id=trainee.id,
        shift_date=date.today(),
        hours_on_shift=12.0,
        review_status=review_status,
        created_at=_now() - timedelta(days=days_ago),
    )
    db_session.add(report)
    await db_session.flush()
    return report


class TestShiftReportsAwaitingReview:
    async def test_counts_pending_and_flagged_reports_apart(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        trainee = await _user(db_session, org)
        await _report(db_session, org, trainee, review_status="pending_review")
        await _report(
            db_session, org, trainee, review_status="pending_review", days_ago=4
        )
        await _report(db_session, org, trainee, review_status="flagged")
        await _report(db_session, org, trainee, review_status="approved")
        await _report(db_session, org, trainee, review_status="draft")

        queue = await _queue(db_session, officer, "training")

        pending = queue["shift_reports_awaiting_review"]
        assert pending.count == 2
        assert pending.oldest_age_days == 4
        assert pending.href == "/scheduling?tab=shift-reports&view=pending-review"
        flagged = queue["shift_reports_flagged"]
        assert flagged.count == 1
        assert flagged.href == "/scheduling?tab=shift-reports&view=flagged"

    async def test_silent_when_scheduling_is_off(self, db_session):
        # The reports are reviewed on the Scheduling page; with the module off
        # the link would land on the "module is not enabled" refusal.
        org = await _org(db_session, modules={"scheduling": False})
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        trainee = await _user(db_session, org)
        await _report(db_session, org, trainee, review_status="pending_review")

        queue = await _queue(db_session, officer, "training")

        assert "shift_reports_awaiting_review" not in queue

    async def test_silent_when_shift_reports_are_switched_off(self, db_session):
        # Switching them off hides the Scheduling tab the row links to.
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        trainee = await _user(db_session, org)
        db_session.add(
            TrainingModuleConfig(organization_id=org.id, shift_reports_enabled=False)
        )
        await _report(db_session, org, trainee, review_status="pending_review")

        queue = await _queue(db_session, officer, "training")

        assert "shift_reports_awaiting_review" not in queue

    async def test_does_not_count_another_departments_reports(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        officer = await _user(db_session, mine, permissions=PERMISSIONS)
        stranger = await _user(db_session, theirs)
        await _report(db_session, theirs, stranger, review_status="pending_review")

        queue = await _queue(db_session, officer, "training")

        assert "shift_reports_awaiting_review" not in queue


# ── Attendance requests ──────────────────────────────────────────────────────


async def _event(db_session, org) -> Event:
    now = _now()
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Ladder Drill",
        event_type=EventType.TRAINING,
        start_datetime=now - timedelta(days=2, hours=2),
        end_datetime=now - timedelta(days=2),
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def _petition(
    db_session,
    org,
    event,
    member,
    *,
    status=AttendancePetitionStatus.PENDING,
    days_ago=0,
):
    petition = EventAttendancePetition(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        event_id=event.id,
        user_id=member.id,
        status=status,
        reason="Phone died at the door",
        created_at=_now() - timedelta(days=days_ago),
    )
    db_session.add(petition)
    await db_session.flush()
    return petition


class TestAttendanceRequests:
    async def test_counts_pending_requests_across_the_department(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        first = await _user(db_session, org)
        second = await _user(db_session, org)
        decided = await _user(db_session, org)
        event = await _event(db_session, org)
        await _petition(db_session, org, event, first, days_ago=2)
        await _petition(db_session, org, event, second)
        await _petition(
            db_session, org, event, decided, status=AttendancePetitionStatus.APPROVED
        )

        item = (await _queue(db_session, officer, "events"))[
            "pending_attendance_requests"
        ]

        assert item.count == 2
        assert item.oldest_age_days == 2
        # The department-wide list, which is what this counts.
        assert item.href == "/events/attendance-requests?scope=all"

    async def test_leaves_out_the_viewers_own_request(self, db_session):
        # Nobody decides their own, so the list leaves it out and so must the
        # count of it.
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        event = await _event(db_session, org)
        await _petition(db_session, org, event, officer)

        queue = await _queue(db_session, officer, "events")

        assert "pending_attendance_requests" not in queue

    async def test_does_not_count_another_departments_requests(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        officer = await _user(db_session, mine, permissions=PERMISSIONS)
        stranger = await _user(db_session, theirs)
        event = await _event(db_session, theirs)
        await _petition(db_session, theirs, event, stranger)

        queue = await _queue(db_session, officer, "events")

        assert "pending_attendance_requests" not in queue


# ── Order windows open past their close time ─────────────────────────────────


async def _window(db_session, org, *, status, closes_at, auto_close=False):
    window = StoreOrderWindow(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Spring order",
        status=status,
        closes_at=closes_at,
        auto_close=auto_close,
    )
    db_session.add(window)
    await db_session.flush()
    return window


class TestWindowsPastClose:
    async def test_counts_an_open_window_past_its_close_time(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        await _window(
            db_session,
            org,
            status=StoreWindowStatus.OPEN,
            closes_at=_now() - timedelta(days=3),
        )

        item = (await _queue(db_session, officer, "storefront"))[
            "store_windows_past_close"
        ]

        assert item.count == 1
        assert item.oldest_age_days == 3
        assert item.href == "/inventory/admin/store?tab=windows"

    async def test_leaves_alone_a_window_the_scheduler_is_about_to_close(
        self, db_session
    ):
        # The scheduler closes an auto-close window within minutes; reporting
        # one that is a few minutes late would flash a row nobody need act on.
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        await _window(
            db_session,
            org,
            status=StoreWindowStatus.OPEN,
            closes_at=_now() - timedelta(minutes=10),
            auto_close=True,
        )

        queue = await _queue(db_session, officer, "storefront")

        assert "store_windows_past_close" not in queue

    async def test_ignores_windows_still_running_or_already_closed(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, permissions=PERMISSIONS)
        await _window(
            db_session,
            org,
            status=StoreWindowStatus.OPEN,
            closes_at=_now() + timedelta(days=2),
        )
        await _window(db_session, org, status=StoreWindowStatus.OPEN, closes_at=None)
        await _window(
            db_session,
            org,
            status=StoreWindowStatus.CLOSED,
            closes_at=_now() - timedelta(days=3),
        )

        queue = await _queue(db_session, officer, "storefront")

        assert "store_windows_past_close" not in queue

    async def test_does_not_count_another_departments_windows(self, db_session):
        mine = await _org(db_session)
        theirs = await _org(db_session)
        officer = await _user(db_session, mine, permissions=PERMISSIONS)
        await _window(
            db_session,
            theirs,
            status=StoreWindowStatus.OPEN,
            closes_at=_now() - timedelta(days=3),
        )

        queue = await _queue(db_session, officer, "storefront")

        assert "store_windows_past_close" not in queue
