"""
The administration frame, against a real database.

`tests/test_admin_hub_metrics.py` covers the registry, slot resolution and the
queue's copy without a database. Everything below needs one: the resolvers are
almost entirely SQL, and SQL is where they go wrong — a join that loses a row,
a filter that counts somebody who left, a supersede check that isn't there.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.admin_hub import DEPARTMENT_SCOPE, AdminHubMetricPreference
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningStatus,
    ScreeningType,
)
from app.models.user import Organization, Position, User, UserStatus
from app.schemas.admin_hub import AdminMetricSettingsUpdate
from app.services.admin_hub_service import (
    ATTENTION_METRIC_KEY,
    MODULE_REGISTRY,
    OPEN_SLOTS,
    AdminHubService,
)

pytestmark = [pytest.mark.integration]


# What an admin looking at the members hub actually holds. Two of the members
# metrics are permission-gated on medical_screening.view — the screenings
# metric itself, and the attention queue via the module's
# attention_permission — and the gate is applied on the way in (save_settings
# refuses a metric the caller may not see), on the way out (_sanitize drops
# one the *reader* may not see, so a second admin reading a colleague's choice
# needs it too) and around the queue. A member holding nothing would never
# reach this screen at all: modules_for gates the frame on members.manage.
HUB_ADMIN_PERMISSIONS = ["members.manage", "medical_screening.view"]


# ── Fixtures ────────────────────────────────────────────────────────────────


async def _org(db_session, **columns) -> Organization:
    """A department that runs Medical Screening.

    Stated rather than assumed: ``medical_screening`` is an opt-in module, so
    a bare organization has it off and the screening metrics and attention
    rows correctly resolve to nothing. Every test here is about what those
    rows say once the department does run it, so the flag is part of the
    fixture — and a test that means to assert the module-off behaviour passes
    its own ``settings``.
    """
    org = Organization(
        id=str(uuid.uuid4()),
        name="Admin Hub Test Department",
        slug=f"adminhub-{uuid.uuid4().hex[:8]}",
        **{
            "timezone": "UTC",
            "settings": {
                "modules": {"medical_screening": True, "_user_configured": True}
            },
            **columns,
        },
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(
    db_session,
    org,
    *,
    status: UserStatus = UserStatus.ACTIVE,
    membership_type: str = "active",
    deleted: bool = False,
    permissions: list[str] | None = None,
) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@adminhub.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=status,
        membership_type=membership_type,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    positions: list[Position] = []
    if permissions is not None:
        position = Position(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name=f"Role {handle}",
            slug=f"role-{handle}",
            permissions=permissions,
        )
        db_session.add(position)
        await db_session.flush()
        positions.append(position)
    # Assigned even when empty, which is the whole point. Every permission
    # check reads user.positions, and on a User built here and flushed the
    # collection is unloaded, so that read is deferred IO — which under
    # asyncio raises MissingGreenlet rather than returning "no permissions".
    # Production never hands the services a user in that state: the token
    # path loads one with selectinload(User.roles), roles being a synonym for
    # positions. Assigning here puts the fixture in the same shape.
    user.positions = positions
    db_session.add(user)
    await db_session.flush()
    return user


async def _screening(
    db_session,
    org,
    user,
    *,
    status: ScreeningStatus,
    screening_type: ScreeningType = ScreeningType.PHYSICAL_EXAM,
    scheduled: date | None = None,
    completed: date | None = None,
    expires: date | None = None,
) -> ScreeningRecord:
    record = ScreeningRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        screening_type=screening_type,
        status=status,
        scheduled_date=scheduled,
        completed_date=completed,
        expiration_date=expires,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _queue(db_session, org, user, module_key: str = "members") -> dict:
    """Run one module's attention resolver and key the result by item key.

    Called through the resolver rather than ``get_summary``, which catches
    every exception so one broken query cannot blank the page — exactly the
    behaviour that would turn a failing test green.
    """
    ctx = await AdminHubService(db_session)._context(user)
    items = await MODULE_REGISTRY[module_key].attention(ctx)
    return {item.key: item for item in items}


#: Every department here is on UTC, so the resolvers' "today" is this one.
#: date.today() would be the host's, which differs across the dateline for
#: part of the day and would make the day-count assertions flake in CI.
TODAY = datetime.now(timezone.utc).date()


# ── The members queue ───────────────────────────────────────────────────────


class TestExpiredScreenings:
    async def test_counts_a_member_with_no_current_cover(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )

        item = (await _queue(db_session, org, member))["expired_screenings"]
        assert item.count == 1
        assert item.oldest_age_days == 40
        assert item.severity == "critical"

    # A screening is renewed by adding a record, never by editing the old one.
    # Counting expired rows outright reported the member who renewed last week
    # as lapsed, while the Screenings-current metric on the same page called
    # them covered.
    async def test_ignores_a_member_who_renewed(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            completed=TODAY - timedelta(days=5),
            expires=TODAY + timedelta(days=360),
        )

        assert "expired_screenings" not in await _queue(db_session, org, member)

    async def test_a_waiver_is_cover(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )
        await _screening(db_session, org, member, status=ScreeningStatus.WAIVED)

        assert "expired_screenings" not in await _queue(db_session, org, member)

    # Two lapsed physicals for one member is one person to chase, not two.
    async def test_counts_a_member_and_type_once(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        for age in (40, 400):
            await _screening(
                db_session,
                org,
                member,
                status=ScreeningStatus.PASSED,
                expires=TODAY - timedelta(days=age),
            )

        item = (await _queue(db_session, org, member))["expired_screenings"]
        assert item.count == 1
        assert item.oldest_age_days == 400

    async def test_separates_two_screening_types(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        for kind in (ScreeningType.PHYSICAL_EXAM, ScreeningType.DRUG_SCREENING):
            await _screening(
                db_session,
                org,
                member,
                status=ScreeningStatus.PASSED,
                screening_type=kind,
                expires=TODAY - timedelta(days=40),
            )

        assert (await _queue(db_session, org, member))["expired_screenings"].count == 2

    async def test_ignores_someone_off_the_roster(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org)
        departed = await _member(db_session, org, status=UserStatus.INACTIVE)
        await _screening(
            db_session,
            org,
            departed,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )

        assert "expired_screenings" not in await _queue(db_session, org, officer)

    async def test_ignores_another_departments_lapse(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org)
        elsewhere = await _org(db_session)
        theirs = await _member(db_session, elsewhere)
        await _screening(
            db_session,
            elsewhere,
            theirs,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )

        assert "expired_screenings" not in await _queue(db_session, org, officer)


class TestOverdueScreenings:
    async def test_counts_an_appointment_nobody_kept(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        item = (await _queue(db_session, org, member))["overdue_screenings"]
        assert item.count == 1
        assert item.oldest_age_days == 21
        assert item.action_label == "Reschedule"

    # The bug this class exists for. The stale SCHEDULED row is never edited —
    # the member's second appointment is a new record — so counting those rows
    # outright reported somebody who rebooked and passed as one who "never
    # completed" it, and kept reporting them forever.
    async def test_ignores_a_member_who_rebooked_and_attended(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            completed=TODAY - timedelta(days=7),
            expires=TODAY + timedelta(days=358),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, member)

    # A failed screening is still an appointment the member kept. It is a
    # compliance problem, not a booking nobody turned up for, and the queue
    # already reports it as one under expired cover.
    async def test_a_failed_screening_is_still_an_attended_one(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.FAILED,
            completed=TODAY - timedelta(days=7),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, member)

    async def test_ignores_a_member_whose_requirement_was_waived(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )
        await _screening(db_session, org, member, status=ScreeningStatus.WAIVED)

        assert "overdue_screenings" not in await _queue(db_session, org, member)

    # Somebody who has already rebooked is not waiting on an administrator.
    async def test_ignores_a_member_holding_a_future_appointment(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY + timedelta(days=10),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, member)

    # A screening completed *before* the missed appointment is not an answer
    # to it — it is the cover that ran out and prompted the booking.
    async def test_an_earlier_screening_does_not_answer_a_later_no_show(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            completed=TODAY - timedelta(days=400),
            expires=TODAY - timedelta(days=35),
        )
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        assert (await _queue(db_session, org, member))["overdue_screenings"].count == 1

    # A missed appointment for a different type is its own gap, so two
    # no-shows by one member are two things to reschedule.
    async def test_separates_two_screening_types(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        for kind in (ScreeningType.PHYSICAL_EXAM, ScreeningType.DRUG_SCREENING):
            await _screening(
                db_session,
                org,
                member,
                status=ScreeningStatus.SCHEDULED,
                screening_type=kind,
                scheduled=TODAY - timedelta(days=21),
            )

        assert (await _queue(db_session, org, member))["overdue_screenings"].count == 2

    async def test_counts_a_member_and_type_once(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        for age in (21, 90):
            await _screening(
                db_session,
                org,
                member,
                status=ScreeningStatus.SCHEDULED,
                scheduled=TODAY - timedelta(days=age),
            )

        item = (await _queue(db_session, org, member))["overdue_screenings"]
        assert item.count == 1
        assert item.oldest_age_days == 90

    # An appointment somebody off the roster missed is history, not work.
    async def test_ignores_someone_off_the_roster(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org)
        departed = await _member(db_session, org, status=UserStatus.INACTIVE)
        await _screening(
            db_session,
            org,
            departed,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, officer)

    async def test_ignores_a_deleted_member(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org)
        removed = await _member(db_session, org, deleted=True)
        await _screening(
            db_session,
            org,
            removed,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, officer)

    async def test_ignores_a_booking_that_has_not_come_round_yet(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY + timedelta(days=10),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, member)

    async def test_ignores_another_departments_no_show(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org)
        elsewhere = await _org(db_session)
        theirs = await _member(db_session, elsewhere)
        await _screening(
            db_session,
            elsewhere,
            theirs,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        assert "overdue_screenings" not in await _queue(db_session, org, officer)

    # A settled record with no completed_date is not evidence of *when* the
    # member attended, so it answers nothing. Over-reporting a "reschedule
    # this" is the safer direction than hiding a member who never had one.
    async def test_an_undated_completion_does_not_answer_a_no_show(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )
        await _screening(db_session, org, member, status=ScreeningStatus.COMPLETED)

        assert (await _queue(db_session, org, member))["overdue_screenings"].count == 1


class TestQueueAgreesWithItsMetrics:
    # Two numbers on one page disagreeing about one person is worse than
    # either being absent: the queue says a member is lapsed while the metric
    # beside it calls the whole roster covered.
    async def test_a_renewed_member_is_covered_by_both(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            completed=TODAY - timedelta(days=5),
            expires=TODAY + timedelta(days=360),
        )

        service = AdminHubService(db_session)
        ctx = await service._context(member)
        spec = MODULE_REGISTRY["members"]
        current = next(m for m in spec.metrics if m.key == "screening_current")
        value, _ = await current.resolve(ctx)

        assert value == "100%"
        assert "expired_screenings" not in await _queue(db_session, org, member)


# ── Every resolver, against real tables ─────────────────────────────────────


#: Every (module, metric) pair the registry offers. A resolver that names a
#: dropped column or joins two tables the wrong way round compiles fine and
#: fails only when it meets a database — which, before this, was in front of
#: an officer rather than in CI.
ALL_METRICS = [
    (module_key, metric.key)
    for module_key, spec in MODULE_REGISTRY.items()
    for metric in spec.metrics
]


class TestEveryResolverRuns:
    @pytest.mark.parametrize(("module_key", "metric_key"), ALL_METRICS)
    async def test_resolves_against_an_empty_department(
        self, db_session, module_key, metric_key
    ):
        org = await _org(db_session)
        member = await _member(db_session, org)
        ctx = await AdminHubService(db_session)._context(member)
        metric = next(
            m for m in MODULE_REGISTRY[module_key].metrics if m.key == metric_key
        )

        value, context = await metric.resolve(ctx)

        assert isinstance(value, str)
        assert value != ""
        assert isinstance(context, str)

    @pytest.mark.parametrize(("module_key", "metric_key"), ALL_METRICS)
    async def test_resolves_with_a_roster_in_place(
        self, db_session, module_key, metric_key
    ):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _member(db_session, org, membership_type="probationary")
        await _member(db_session, org, status=UserStatus.INACTIVE)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            completed=TODAY - timedelta(days=5),
            expires=TODAY + timedelta(days=360),
        )
        ctx = await AdminHubService(db_session)._context(member)
        metric = next(
            m for m in MODULE_REGISTRY[module_key].metrics if m.key == metric_key
        )

        value, _ = await metric.resolve(ctx)
        assert isinstance(value, str)
        assert value != ""

    # The availability gates are queries too, and a broken one is worse than a
    # broken metric: it decides whether the metric can be chosen at all.
    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    async def test_availability_gates_run(self, db_session, module_key):
        org = await _org(db_session)
        member = await _member(db_session, org)
        ctx = await AdminHubService(db_session)._context(member)

        for metric in MODULE_REGISTRY[module_key].metrics:
            if metric.availability is None:
                continue
            reason = await metric.availability(ctx)
            assert reason is None or isinstance(reason, str)


class TestEveryQueueRuns:
    # get_summary swallows a failing queue so one broken query cannot blank
    # the page. Calling the resolver directly is what makes a broken query
    # fail its test instead of silently returning nothing.
    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    async def test_queue_runs_against_an_empty_department(self, db_session, module_key):
        org = await _org(db_session)
        member = await _member(db_session, org)

        assert await _queue(db_session, org, member, module_key) == {}

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    async def test_every_queue_item_is_actionable(self, db_session, module_key):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        for item in (await _queue(db_session, org, member, module_key)).values():
            assert item.title
            assert item.action_label
            assert item.href
            assert item.count > 0


class TestSummaryShape:
    async def test_fills_four_slots_with_the_attention_count_last(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        summary = await AdminHubService(db_session).get_summary("members", member)

        assert len(summary.metrics) == OPEN_SLOTS + 1
        assert summary.metrics[-1].key == ATTENTION_METRIC_KEY
        assert summary.metrics[-1].fixed is True
        assert not any(m.fixed for m in summary.metrics[:-1])

    async def test_the_fourth_slot_counts_the_queue_beneath_it(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.SCHEDULED,
            scheduled=TODAY - timedelta(days=21),
        )

        summary = await AdminHubService(db_session).get_summary("members", member)

        assert summary.metrics[-1].value == str(len(summary.attention))
        assert summary.attention

    # Critical rows come first, so an expired screening that blocks duty
    # assignment is not pushed under a larger count of softer exceptions.
    async def test_critical_rows_sort_above_warnings(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        await _screening(
            db_session,
            org,
            member,
            status=ScreeningStatus.PASSED,
            expires=TODAY - timedelta(days=40),
        )
        for kind in ScreeningType:
            await _screening(
                db_session,
                org,
                member,
                status=ScreeningStatus.SCHEDULED,
                screening_type=kind,
                scheduled=TODAY - timedelta(days=21),
            )

        summary = await AdminHubService(db_session).get_summary("members", member)
        severities = [item.severity for item in summary.attention]

        assert severities[0] == "critical"
        assert severities == sorted(severities, key=lambda s: s != "critical")

    async def test_reports_the_departments_timezone(self, db_session):
        org = await _org(db_session, timezone="America/New_York")
        member = await _member(db_session, org)

        summary = await AdminHubService(db_session).get_summary("members", member)
        assert summary.timezone == "America/New_York"

    # A timezone nobody can resolve must not take the page down; UTC is the
    # honest fallback and the rest of the frame still renders.
    async def test_survives_a_timezone_the_host_does_not_know(self, db_session):
        org = await _org(db_session, timezone="Mars/Olympus_Mons")
        member = await _member(db_session, org)

        summary = await AdminHubService(db_session).get_summary("members", member)
        assert summary.timezone == "UTC"


# ── Which three metrics an admin sees ───────────────────────────────────────


async def _save(db_session, module_key, user, keys, *, everyone=True):
    return await AdminHubService(db_session).save_settings(
        module_key,
        user,
        AdminMetricSettingsUpdate(metric_keys=keys, applies_to_everyone=everyone),
    )


async def _selected(db_session, module_key, user) -> list[str]:
    return (await AdminHubService(db_session).get_settings(module_key, user)).selected


class TestMetricPreferences:
    async def test_a_department_that_has_chosen_nothing_gets_the_built_in_three(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org)

        settings = await AdminHubService(db_session).get_settings("members", member)

        assert settings.selected == list(MODULE_REGISTRY["members"].default_metrics)
        assert settings.applies_to_everyone is True
        assert settings.is_personal is False

    async def test_a_saved_selection_comes_back(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        chosen = ["members_on_leave", "screening_current", "active_members"]

        saved = await _save(db_session, "members", member, chosen)

        assert saved.selected == chosen
        assert await _selected(db_session, "members", member) == chosen

    # The department's choice is the department's: an officer who never opened
    # the settings screen sees what the chief picked.
    async def test_a_department_choice_reaches_every_admin(self, db_session):
        org = await _org(db_session)
        chief = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        # The reader needs the permission as much as the writer: _sanitize
        # drops a metric the caller may not see, so a captain without it would
        # be served the default rather than the chief's choice.
        captain = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        chosen = ["members_on_leave", "screening_current", "active_members"]

        await _save(db_session, "members", chief, chosen)

        assert await _selected(db_session, "members", captain) == chosen

    async def test_a_personal_choice_stays_personal(self, db_session):
        org = await _org(db_session)
        chief = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        captain = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        department = ["active_members", "probationary_members", "inactive_members"]
        await _save(db_session, "members", chief, department)

        mine = ["screening_current", "members_on_leave", "active_members"]
        saved = await _save(db_session, "members", captain, mine, everyone=False)

        assert saved.selected == mine
        assert saved.is_personal is True
        assert saved.department_default == department
        assert await _selected(db_session, "members", chief) == department

    # The toggle lives on the department row, so turning personal choice back
    # off has somewhere to be recorded even when nobody edited the
    # department's own four.
    async def test_turning_personal_choice_off_returns_everyone_to_the_department(
        self, db_session
    ):
        org = await _org(db_session)
        chief = await _member(db_session, org, permissions=HUB_ADMIN_PERMISSIONS)
        department = ["active_members", "probationary_members", "inactive_members"]
        await _save(db_session, "members", chief, department)
        await _save(
            db_session,
            "members",
            chief,
            ["screening_current", "members_on_leave", "active_members"],
            everyone=False,
        )

        restored = await _save(db_session, "members", chief, department)

        assert restored.applies_to_everyone is True
        assert restored.is_personal is False
        assert restored.selected == department

    async def test_saving_twice_edits_the_row_rather_than_adding_one(self, db_session):
        from sqlalchemy import func, select

        org = await _org(db_session)
        member = await _member(db_session, org)
        await _save(db_session, "members", member, ["active_members"])
        await _save(db_session, "members", member, ["members_on_leave"])

        rows = await db_session.scalar(
            select(func.count(AdminHubMetricPreference.id)).where(
                AdminHubMetricPreference.organization_id == org.id,
                AdminHubMetricPreference.module_key == "members",
            )
        )
        assert rows == 1

    async def test_the_department_row_carries_the_sentinel_scope(self, db_session):
        from sqlalchemy import select

        org = await _org(db_session)
        member = await _member(db_session, org)
        await _save(db_session, "members", member, ["active_members"])

        row = await db_session.scalar(
            select(AdminHubMetricPreference).where(
                AdminHubMetricPreference.organization_id == org.id,
                AdminHubMetricPreference.module_key == "members",
            )
        )
        assert row.scope_key == DEPARTMENT_SCOPE
        assert row.user_id is None

    async def test_a_personal_row_is_scoped_to_its_admin(self, db_session):
        from sqlalchemy import select

        org = await _org(db_session)
        member = await _member(db_session, org)
        await _save(db_session, "members", member, ["active_members"], everyone=False)

        row = await db_session.scalar(
            select(AdminHubMetricPreference).where(
                AdminHubMetricPreference.organization_id == org.id,
                AdminHubMetricPreference.scope_key == member.id,
            )
        )
        assert row.user_id == member.id

    # MySQL treats NULLs as distinct inside a unique index, so a NULL user_id
    # cannot carry the one-row-per-scope rule. scope_key exists for this.
    async def test_a_second_department_row_is_refused(self, db_session):
        from sqlalchemy.exc import IntegrityError

        org = await _org(db_session)
        for _ in range(2):
            db_session.add(
                AdminHubMetricPreference(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    module_key="members",
                    user_id=None,
                    scope_key=DEPARTMENT_SCOPE,
                    metric_keys=["active_members"],
                )
            )
        with pytest.raises(IntegrityError):
            await db_session.flush()

    async def test_two_departments_keep_their_own_choices(self, db_session):
        org = await _org(db_session)
        elsewhere = await _org(db_session)
        ours = await _member(db_session, org)
        theirs = await _member(db_session, elsewhere)

        await _save(db_session, "members", ours, ["members_on_leave"])

        assert await _selected(db_session, "members", theirs) == list(
            MODULE_REGISTRY["members"].default_metrics
        )

    async def test_the_attention_count_cannot_be_moved_into_an_open_slot(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org)

        with pytest.raises(ValueError, match="slot four"):
            await _save(db_session, "members", member, [ATTENTION_METRIC_KEY])

    async def test_a_metric_the_module_does_not_offer_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        with pytest.raises(ValueError, match="no metric named"):
            await _save(db_session, "members", member, ["upcoming_events"])

    async def test_one_metric_cannot_fill_two_slots(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        with pytest.raises(ValueError, match="one slot"):
            await _save(
                db_session, "members", member, ["active_members", "active_members"]
            )

    async def test_a_metric_whose_module_is_off_is_refused(self, db_session):
        org = await _org(
            db_session,
            settings={"modules": {"prospective_members": False, "training": True}},
        )
        member = await _member(db_session, org)

        # The save guard and the settings list phrase the same fact the same
        # way — the guard used to leak the internal module key instead.
        with pytest.raises(
            ValueError, match=r"'Prospects' cannot be shown — Needs the Prospective"
        ):
            await _save(db_session, "members", member, ["prospective_members"])

    async def test_the_settings_list_and_the_save_guard_agree(self, db_session):
        org = await _org(
            db_session,
            settings={"modules": {"prospective_members": False, "training": True}},
        )
        member = await _member(db_session, org)

        settings = await AdminHubService(db_session).get_settings("members", member)
        listed = next(
            o for o in settings.options if o.key == "prospective_members"
        ).unavailable_reason

        with pytest.raises(ValueError, match="cannot be shown") as caught:
            await _save(db_session, "members", member, ["prospective_members"])

        assert listed in str(caught.value)

    # A stored selection outlives the module that fed it. A department that
    # turns off Prospective Members must not be left with a card that can
    # never render — the slot falls back to the module default.
    async def test_a_selection_survives_its_module_being_turned_off(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _save(
            db_session,
            "members",
            member,
            ["prospective_members", "active_members", "members_on_leave"],
        )

        org.settings = {"modules": {"prospective_members": False, "training": True}}
        await db_session.flush()

        selected = await _selected(db_session, "members", member)
        assert "prospective_members" not in selected
        assert len(selected) == OPEN_SLOTS

    async def test_a_short_selection_is_topped_up_from_the_default(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        saved = await _save(db_session, "members", member, ["members_on_leave"])

        assert saved.selected[0] == "members_on_leave"
        assert len(saved.selected) == OPEN_SLOTS

    async def test_the_settings_screen_lists_the_fixed_fourth_slot(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        settings = await AdminHubService(db_session).get_settings("members", member)
        fixed = [o for o in settings.options if o.fixed]

        assert [o.key for o in fixed] == [ATTENTION_METRIC_KEY]

    # A module that is off is shown with its reason rather than hidden, so an
    # admin can see what enabling it would buy them.
    async def test_an_unavailable_metric_is_listed_with_its_reason(self, db_session):
        org = await _org(
            db_session,
            settings={"modules": {"prospective_members": False, "training": True}},
        )
        member = await _member(db_session, org)

        settings = await AdminHubService(db_session).get_settings("members", member)
        option = next(o for o in settings.options if o.key == "prospective_members")

        assert option.unavailable_reason == "Needs the Prospective Members module"
        assert option.value is None

    async def test_a_selectable_metric_previews_its_current_value(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        settings = await AdminHubService(db_session).get_settings("members", member)
        option = next(o for o in settings.options if o.key == "active_members")

        assert option.value == "1"
        assert option.unavailable_reason is None

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    async def test_every_module_can_save_its_own_defaults(self, db_session, module_key):
        org = await _org(db_session)
        member = await _member(db_session, org)
        defaults = list(MODULE_REGISTRY[module_key].default_metrics)

        saved = await _save(db_session, module_key, member, defaults)

        assert saved.selected == defaults


# ── Who may read a module's frame ───────────────────────────────────────────


class TestModuleAccess:
    async def test_an_admin_sees_the_modules_they_manage(self, db_session):
        org = await _org(db_session)
        officer = await _member(
            db_session, org, permissions=["members.manage", "events.manage"]
        )

        assert sorted(AdminHubService.modules_for(officer)) == ["events", "members"]

    async def test_a_member_with_no_manage_permission_sees_none(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, permissions=["members.view"])

        assert AdminHubService.modules_for(member) == []

    async def test_a_module_wildcard_grants_its_own_frame_only(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org, permissions=["inventory.*"])

        assert AdminHubService.modules_for(officer) == ["inventory"]

    async def test_the_global_wildcard_grants_every_frame(self, db_session):
        org = await _org(db_session)
        owner = await _member(db_session, org, permissions=["*"])

        assert sorted(AdminHubService.modules_for(owner)) == sorted(MODULE_REGISTRY)

    # An unknown module and a forbidden one answer the same 404: a caller who
    # may not administer Training should not learn from this endpoint whether
    # the department runs it.
    async def test_a_forbidden_module_is_indistinguishable_from_an_unknown_one(
        self, db_session
    ):
        from fastapi import HTTPException

        from app.api.v1.endpoints.admin_hub import _require_module_access

        org = await _org(db_session)
        officer = await _member(db_session, org, permissions=["members.manage"])

        statuses = []
        for module_key in ("training", "there_is_no_such_module"):
            with pytest.raises(HTTPException) as caught:
                _require_module_access(module_key, officer)
            statuses.append((caught.value.status_code, caught.value.detail))

        assert statuses[0] == statuses[1]
        assert statuses[0][0] == 404

    async def test_a_permitted_module_passes(self, db_session):
        from app.api.v1.endpoints.admin_hub import _require_module_access

        org = await _org(db_session)
        officer = await _member(db_session, org, permissions=["members.manage"])

        assert _require_module_access("members", officer) is None

    async def test_an_unknown_module_has_no_spec(self, db_session):
        with pytest.raises(ValueError, match="Unknown administration module"):
            AdminHubService.get_module("there_is_no_such_module")


# ── The other three queues, with a row to find ──────────────────────────────
#
# "The query runs and returns nothing" only proves the SQL parses. One seeded
# row per module proves the joins reach it.


class TestOtherQueuesFindTheirRows:
    async def test_events_reports_a_public_request_nobody_answered(self, db_session):
        from app.models.event_request import EventRequest, EventRequestStatus

        org = await _org(db_session)
        member = await _member(db_session, org)
        db_session.add(
            EventRequest(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                contact_name="Falls Church Elementary",
                contact_email="pta@example.test",
                outreach_type="station_tour",
                description="Second-grade station tour",
                status=EventRequestStatus.SUBMITTED,
            )
        )
        await db_session.flush()

        item = (await _queue(db_session, org, member, "events"))[
            "pending_event_requests"
        ]
        assert item.count == 1
        assert item.href == "/events/admin?tab=requests"

    async def test_events_ignores_another_departments_request(self, db_session):
        from app.models.event_request import EventRequest, EventRequestStatus

        org = await _org(db_session)
        member = await _member(db_session, org)
        elsewhere = await _org(db_session)
        db_session.add(
            EventRequest(
                id=str(uuid.uuid4()),
                organization_id=elsewhere.id,
                contact_name="Someone Else",
                contact_email="them@example.test",
                outreach_type="station_tour",
                description="Their tour",
                status=EventRequestStatus.SUBMITTED,
            )
        )
        await db_session.flush()

        assert "pending_event_requests" not in await _queue(
            db_session, org, member, "events"
        )

    async def test_training_reports_a_submission_awaiting_review(self, db_session):
        from app.models.training import (
            SubmissionStatus,
            TrainingSubmission,
            TrainingType,
        )

        org = await _org(db_session)
        member = await _member(db_session, org)
        db_session.add(
            TrainingSubmission(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                submitted_by=member.id,
                course_name="Vehicle Extrication",
                training_type=TrainingType.SKILLS_PRACTICE,
                completion_date=TODAY - timedelta(days=9),
                hours_completed=4.0,
                status=SubmissionStatus.PENDING_REVIEW,
                submitted_at=datetime.now(timezone.utc) - timedelta(days=9),
            )
        )
        await db_session.flush()

        item = (await _queue(db_session, org, member, "training"))[
            "pending_submissions"
        ]
        assert item.count == 1
        assert item.oldest_age_days == 9

    async def test_training_ignores_a_submission_already_reviewed(self, db_session):
        from app.models.training import (
            SubmissionStatus,
            TrainingSubmission,
            TrainingType,
        )

        org = await _org(db_session)
        member = await _member(db_session, org)
        db_session.add(
            TrainingSubmission(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                submitted_by=member.id,
                course_name="Vehicle Extrication",
                training_type=TrainingType.SKILLS_PRACTICE,
                completion_date=TODAY - timedelta(days=9),
                hours_completed=4.0,
                status=SubmissionStatus.APPROVED,
                submitted_at=datetime.now(timezone.utc) - timedelta(days=9),
            )
        )
        await db_session.flush()

        assert "pending_submissions" not in await _queue(
            db_session, org, member, "training"
        )

    async def test_inventory_reports_a_pool_item_at_its_reorder_point(self, db_session):
        from app.models.inventory import InventoryItem, ItemStatus, TrackingType

        org = await _org(db_session)
        member = await _member(db_session, org)
        db_session.add(
            InventoryItem(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Nitrile gloves, large",
                tracking_type=TrackingType.POOL,
                quantity=2,
                reorder_point=6,
                status=ItemStatus.AVAILABLE,
            )
        )
        await db_session.flush()

        item = (await _queue(db_session, org, member, "inventory"))["below_par"]
        assert item.count == 1

    # A retired item is off the books; reordering it is not work anyone owes.
    async def test_inventory_ignores_a_retired_item(self, db_session):
        from app.models.inventory import InventoryItem, ItemStatus, TrackingType

        org = await _org(db_session)
        member = await _member(db_session, org)
        db_session.add(
            InventoryItem(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Nitrile gloves, large",
                tracking_type=TrackingType.POOL,
                quantity=0,
                reorder_point=6,
                status=ItemStatus.RETIRED,
            )
        )
        await db_session.flush()

        assert "below_par" not in await _queue(db_session, org, member, "inventory")

    # An item with no reorder point has no par to be under. Comparing against
    # NULL would either count everything or nothing, and both are wrong.
    async def test_inventory_ignores_an_item_with_no_reorder_point(self, db_session):
        from app.models.inventory import InventoryItem, ItemStatus, TrackingType

        org = await _org(db_session)
        member = await _member(db_session, org)
        db_session.add(
            InventoryItem(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name="Nitrile gloves, large",
                tracking_type=TrackingType.POOL,
                quantity=0,
                reorder_point=None,
                status=ItemStatus.AVAILABLE,
            )
        )
        await db_session.flush()

        assert "below_par" not in await _queue(db_session, org, member, "inventory")
