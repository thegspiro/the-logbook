"""Session waiver requests, end to end through the service.

Pins the owner decisions of 2026-11-10 against a real database:

  * a member may ask only about a training session that counts against them,
    once per session, before the department's deadline, and not after
    checking in or once their waivers are used up;
  * a withdrawn request frees the session for a new one; a denied one does not;
  * the cap counts approved requests by session date, per calendar year in the
    department's timezone or per any 12 months, and is enforced at approval;
  * a Chief's override of a denial is not blocked by the cap but counts;
  * requests route to the chosen positions, then the Chief, then training
    managers, never to the requester, and who may decide is the same rule;
  * every lookup is scoped to the caller's department.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, text

from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.audit import AuditLog
from app.models.event import EventRSVP, EventType, RSVPStatus
from app.models.notification import NotificationLog
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import Organization
from app.schemas.attendance_waiver import AttendanceWaiverPolicy
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    MEMBER_UPDATE_CATEGORY,
    REVIEW_PROMPT_CATEGORY,
    AttendanceWaiverNotFound,
    AttendanceWaiverService,
)
from app.services.organization_service import OrganizationService
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
    uid,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
# 18:00 in New York on 20 November.
DRILL = utc(2026, 11, 20, 23)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    """The service's "now", movable per test."""
    state = SimpleNamespace(now=NOW)
    monkeypatch.setattr(engine, "_now", lambda: state.now)
    return state


@pytest.fixture
async def dept(db_session):
    """A department with a training officer as the chosen approver, a Chief,
    a training manager, two members, and one linked drill."""
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    manager_pos = await make_position(
        db_session, org_id, "Training Admin", permissions=["training.manage"]
    )
    member = await make_member(db_session, org_id, "Sam")
    other = await make_member(db_session, org_id, "Olive")
    officer = await make_member(db_session, org_id, "Tina")
    chief = await make_member(db_session, org_id, "Cal")
    manager = await make_member(db_session, org_id, "Max")
    await assign(db_session, officer, officer_pos)
    await assign(db_session, chief, chief_pos)
    await assign(db_session, manager, manager_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        officer_pos=officer_pos,
        chief_pos=chief_pos,
        manager_pos=manager_pos,
        member=await load(db_session, member),
        other=await load(db_session, other),
        officer=await load(db_session, officer),
        chief=await load(db_session, chief),
        manager=await load(db_session, manager),
        requirement=requirement,
        drill=drill,
    )


def _svc(db) -> AttendanceWaiverService:
    return AttendanceWaiverService(db)


async def _submit(db, dept, who=None, event_id=None, **answers):
    return await _svc(db).submit(
        dept.org,
        who or dept.member,
        event_id or dept.drill,
        answers.get("category"),
        answers.get("reason"),
    )


async def _approved_on(db, dept, day: date, who=None) -> None:
    """An approved request already on file for ``day`` (its event long gone)."""
    member = who or dept.member
    db.add(
        AttendanceWaiverRequest(
            id=uid(),
            organization_id=dept.org,
            workflow=AttendanceWaiverWorkflow.TRAINING_SESSION,
            user_id=member.id,
            event_id=None,
            event_title_snapshot="Earlier drill",
            event_start_snapshot=datetime(
                day.year, day.month, day.day, 23, tzinfo=timezone.utc
            ),
            session_date=day,
            status=AttendanceWaiverStatus.APPROVED,
            submitted_at=NOW,
        )
    )
    await db.flush()


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


class TestEligibility:
    async def test_a_linked_upcoming_drill_may_be_asked_about(self, db_session, dept):
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.drill)

        assert result.allowed, result.refusal
        assert result.deadline == DRILL
        # The department's day, not the UTC one.
        assert result.session_date == date(2026, 11, 20)
        assert (result.cap_used, result.cap_remaining) == (None, None)

    async def _refusal(self, db, dept, event_id=None, who=None):
        result = await _svc(db).eligibility(
            dept.org, who or dept.member, event_id or dept.drill
        )
        assert not result.allowed
        return result.refusal_code

    async def test_nothing_is_asked_while_the_policy_is_off(self, db_session, dept):
        await set_policy(db_session, dept.org, enabled=False)
        assert await self._refusal(db_session, dept) == "disabled"

    async def test_a_malformed_policy_reads_as_off(self, db_session, dept):
        await set_policy(db_session, dept.org, cap=0)
        assert await self._refusal(db_session, dept) == "disabled"

    async def test_only_a_training_event(self, db_session, dept):
        social = await make_session(
            db_session,
            dept.org,
            DRILL,
            link=[dept.requirement],
            event_type=EventType.SOCIAL,
        )
        assert await self._refusal(db_session, dept, social) == "not_training"

    async def test_not_a_cancelled_one(self, db_session, dept):
        cancelled = await make_session(
            db_session, dept.org, DRILL, link=[dept.requirement], cancelled=True
        )
        assert await self._refusal(db_session, dept, cancelled) == "cancelled"

    async def test_an_unlinked_session_counts_against_nobody(self, db_session, dept):
        optional = await make_session(db_session, dept.org, DRILL)
        assert await self._refusal(db_session, dept, optional) == "not_counted"

    async def test_a_requirement_that_does_not_apply_to_the_member(
        self, db_session, dept
    ):
        probationers = await make_requirement(
            db_session,
            dept.org,
            applies_to_all=False,
            required_membership_types=["probationary"],
        )
        theirs = await make_session(db_session, dept.org, DRILL, link=[probationers])
        assert await self._refusal(db_session, dept, theirs) == "not_counted"

    async def test_an_exempt_member_has_nothing_to_excuse(self, db_session, dept):
        exempt = await load(
            db_session, await make_member(db_session, dept.org, "Ed", exempt=True)
        )
        assert await self._refusal(db_session, dept, who=exempt) == "exempt"

    @pytest.mark.parametrize("how", ["check_in", "override", "record"])
    async def test_a_member_who_checked_in_cannot_ask(self, db_session, dept, how):
        if how == "record":
            db_session.add(
                TrainingRecord(
                    id=uid(),
                    organization_id=dept.org,
                    user_id=dept.member.id,
                    source_event_id=dept.drill,
                    course_name="Company Drill",
                    training_type=TrainingType.CONTINUING_EDUCATION,
                    completion_date=date(2026, 11, 20),
                    hours_completed=2,
                    status=TrainingStatus.COMPLETED,
                )
            )
        else:
            db_session.add(
                EventRSVP(
                    id=uid(),
                    organization_id=dept.org,
                    event_id=dept.drill,
                    user_id=dept.member.id,
                    status=RSVPStatus.GOING,
                    checked_in=how == "check_in",
                    override_check_in_at=DRILL if how == "override" else None,
                )
            )
        await db_session.flush()
        assert await self._refusal(db_session, dept) == "checked_in"

    async def test_one_live_request_per_session(self, db_session, dept):
        request = await _submit(db_session, dept)
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.drill)
        assert result.refusal_code == "already_requested"
        assert result.existing is not None
        assert result.existing.id == request.id

    async def test_not_after_the_deadline(self, db_session, dept, clock):
        clock.now = DRILL
        assert await self._refusal(db_session, dept) == "deadline_passed"

    async def test_not_once_the_waivers_are_used_up(self, db_session, dept):
        await set_policy(
            db_session, dept.org, cap=1, approver_position_ids=[dept.officer_pos]
        )
        await _approved_on(db_session, dept, date(2026, 3, 1))
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.drill)
        assert result.refusal_code == "no_waivers_left"
        assert (result.cap_used, result.cap_remaining) == (1, 0)

    async def test_x_of_y_left(self, db_session, dept):
        await set_policy(
            db_session, dept.org, cap=3, approver_position_ids=[dept.officer_pos]
        )
        await _approved_on(db_session, dept, date(2026, 3, 1))
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.drill)
        assert result.allowed
        assert (result.cap_used, result.cap_remaining) == (1, 2)

    async def test_a_draft_event_is_not_there(self, db_session, dept):
        draft = await make_session(db_session, dept.org, DRILL, link=[dept.requirement])
        await db_session.execute(
            text("UPDATE events SET is_draft = 1 WHERE id = :id"), {"id": draft}
        )
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).eligibility(dept.org, dept.member, draft)


class TestDeadlines:
    @pytest.mark.parametrize(
        ("preset", "deadline"),
        [
            ("before_start", DRILL),
            ("24h_after_end", DRILL + timedelta(hours=2, days=1)),
            ("7d_after_end", DRILL + timedelta(hours=2, days=7)),
        ],
    )
    async def test_each_preset_at_its_boundary(
        self, db_session, dept, clock, preset, deadline
    ):
        await set_policy(
            db_session,
            dept.org,
            deadline=preset,
            approver_position_ids=[dept.officer_pos],
        )
        service = _svc(db_session)

        clock.now = deadline - timedelta(seconds=1)
        early = await service.eligibility(dept.org, dept.member, dept.drill)
        assert early.allowed
        assert early.deadline == deadline

        clock.now = deadline
        late = await service.eligibility(dept.org, dept.member, dept.drill)
        assert late.refusal_code == "deadline_passed"
        with pytest.raises(ValueError, match="deadline"):
            await _submit(db_session, dept)


# ---------------------------------------------------------------------------
# Submitting and withdrawing
# ---------------------------------------------------------------------------


class TestSubmitAndWithdraw:
    async def test_a_request_snapshots_its_session(self, db_session, dept):
        request = await _submit(db_session, dept, reason="  Knee surgery  ")

        assert request.status == AttendanceWaiverStatus.PENDING
        assert request.event_id == dept.drill
        assert request.event_title_snapshot == "Company Drill"
        assert request.session_date == date(2026, 11, 20)
        assert request.live_key == f"training_session:{dept.drill}:{dept.member.id}"
        assert request.reason == "Knee surgery"
        actions = (
            (
                await db_session.execute(
                    select(AttendanceWaiverRequestAction.action).where(
                        AttendanceWaiverRequestAction.request_id == request.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert actions == [AttendanceWaiverAction.SUBMITTED]

    async def test_the_reason_is_encrypted_at_rest(self, db_session, dept):
        request = await _submit(db_session, dept, reason="Knee surgery")
        stored = (
            await db_session.execute(
                text("SELECT reason FROM attendance_waiver_requests WHERE id = :id"),
                {"id": request.id},
            )
        ).scalar_one()
        assert stored
        assert "Knee" not in stored

    async def test_the_audit_carries_ids_not_the_reason(self, db_session, dept):
        request = await _submit(db_session, dept, reason="Knee surgery")
        entry = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "attendance_waiver_request_submitted",
                    AuditLog.user_id == dept.member.id,
                )
            )
        ).scalar_one()
        assert entry.event_data["request_id"] == request.id
        assert "Knee" not in str(entry.event_data)

    async def test_withdrawing_frees_the_session_and_keeps_the_history(
        self, db_session, dept
    ):
        first = await _submit(db_session, dept)
        withdrawn = await _svc(db_session).withdraw(dept.org, dept.member, first.id)
        assert withdrawn.status == AttendanceWaiverStatus.WITHDRAWN
        assert withdrawn.live_key is None

        second = await _submit(db_session, dept)
        assert second.id != first.id
        mine = await _svc(db_session).list_mine(dept.org, dept.member)
        assert {(r.id, r.status) for r in mine} == {
            (first.id, AttendanceWaiverStatus.WITHDRAWN),
            (second.id, AttendanceWaiverStatus.PENDING),
        }

    async def test_a_duplicate_the_read_misses_is_refused_by_the_unique_key(
        self, db_session, dept, monkeypatch
    ):
        """Submitting reads ``live_key`` without a lock, so a request committed
        after the reader's snapshot can be missed; the unique key refuses the
        insert instead, with the same answer, and the savepoint around it
        leaves the caller's session usable for the next request."""
        first = await _submit(db_session, dept)

        async def misses(self, *args, **kwargs):
            return None

        monkeypatch.setattr(AttendanceWaiverService, "_live_request", misses)
        with pytest.raises(
            ValueError, match="^You have already asked to be excused from this"
        ):
            await _submit(db_session, dept)

        later = await make_session(
            db_session, dept.org, DRILL + timedelta(days=7), link=[dept.requirement]
        )
        second = await _submit(db_session, dept, event_id=later)
        stored = (
            (
                await db_session.execute(
                    select(AttendanceWaiverRequest.id).where(
                        AttendanceWaiverRequest.user_id == dept.member.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(stored) == sorted([first.id, second.id])

    async def test_a_denied_request_holds_the_session(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.officer, request.id, "No")
        with pytest.raises(ValueError, match="already asked"):
            await _submit(db_session, dept)

    async def test_only_a_pending_request_can_be_withdrawn(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.officer, request.id)
        with pytest.raises(ValueError, match="already been approved"):
            await _svc(db_session).withdraw(dept.org, dept.member, request.id)

    async def test_only_the_member_withdraws(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(PermissionError):
            await _svc(db_session).withdraw(dept.org, dept.officer, request.id)
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).withdraw(dept.org, dept.other, request.id)


class TestAnswers:
    async def _policy(self, db, dept, **fields):
        await set_policy(
            db, dept.org, approver_position_ids=[dept.officer_pos], **fields
        )

    async def test_a_required_category_must_be_one_of_the_list(self, db_session, dept):
        await self._policy(
            db_session, dept, categories=["Medical", "Work"], category_required=True
        )
        with pytest.raises(ValueError, match="Choose a category"):
            await _submit(db_session, dept)
        with pytest.raises(ValueError, match="department's categories"):
            await _submit(db_session, dept, category="Vacation")
        request = await _submit(db_session, dept, category="  medical ")
        assert request.category == "Medical"

    async def test_no_categories_means_none_is_taken(self, db_session, dept):
        await self._policy(db_session, dept)
        with pytest.raises(ValueError, match="does not use categories"):
            await _submit(db_session, dept, category="Medical")

    async def test_an_optional_category_may_be_left_out(self, db_session, dept):
        await self._policy(db_session, dept, categories=["Medical"])
        assert (await _submit(db_session, dept)).category is None

    async def test_reason_off_refuses_one(self, db_session, dept):
        await self._policy(db_session, dept, reason_text="off")
        with pytest.raises(ValueError, match="written reason"):
            await _submit(db_session, dept, reason="Sick")
        # Blank is no reason at all.
        assert (await _submit(db_session, dept, reason="   ")).reason is None

    async def test_reason_required_refuses_a_blank(self, db_session, dept):
        await self._policy(db_session, dept, reason_text="required")
        with pytest.raises(ValueError, match="Give a reason"):
            await _submit(db_session, dept, reason="   ")
        assert (await _submit(db_session, dept, reason="Sick")).reason == "Sick"

    async def test_reason_optional_trims_and_blanks_to_none(self, db_session, dept):
        await self._policy(db_session, dept, reason_text="optional")
        assert (await _submit(db_session, dept, reason="   ")).reason is None


# ---------------------------------------------------------------------------
# Deciding, the cap and the Chief
# ---------------------------------------------------------------------------


class TestDeciding:
    async def test_approve_records_who_and_when(self, db_session, dept, clock):
        request = await _submit(db_session, dept)
        clock.now = NOW + timedelta(hours=1)
        approved = await _svc(db_session).approve(
            dept.org, dept.officer, request.id, "  Get well  "
        )
        assert approved.status == AttendanceWaiverStatus.APPROVED
        assert approved.decided_by == dept.officer.id
        assert approved.decided_at.replace(tzinfo=timezone.utc) == clock.now
        note = (
            await db_session.execute(
                select(AttendanceWaiverRequestAction.note).where(
                    AttendanceWaiverRequestAction.request_id == request.id,
                    AttendanceWaiverRequestAction.action
                    == AttendanceWaiverAction.APPROVED,
                )
            )
        ).scalar_one()
        assert note == "Get well"

    async def test_the_first_decision_is_final(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.officer, request.id)
        with pytest.raises(ValueError, match="already been denied"):
            await _svc(db_session).approve(dept.org, dept.chief, request.id)

    async def test_nobody_decides_their_own(self, db_session, dept):
        request = await _submit(db_session, dept, who=dept.officer)
        with pytest.raises(PermissionError, match="your own"):
            await _svc(db_session).approve(dept.org, dept.officer, request.id)

    async def test_a_member_who_may_not_decide_is_told_not_found(
        self, db_session, dept
    ):
        request = await _submit(db_session, dept)
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).approve(dept.org, dept.other, request.id)
        # A training manager is not routed while the position is staffed.
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).deny(dept.org, dept.manager, request.id)


class TestCap:
    async def _cap(self, db, dept, cap, period="calendar_year"):
        await set_policy(
            db,
            dept.org,
            cap=cap,
            cap_period=period,
            deadline="7d_after_end",
            approver_position_ids=[dept.officer_pos],
        )

    async def test_the_cap_is_enforced_when_approving(self, db_session, dept):
        await self._cap(db_session, dept, 1)
        second = await make_session(
            db_session, dept.org, DRILL + timedelta(days=7), link=[dept.requirement]
        )
        # Pending requests do not count, so both may be asked.
        first = await _submit(db_session, dept)
        other = await _submit(db_session, dept, event_id=second)

        await _svc(db_session).approve(dept.org, dept.officer, first.id)
        with pytest.raises(ValueError, match="exceed the department's cap"):
            await _svc(db_session).approve(dept.org, dept.officer, other.id)
        await db_session.refresh(other)
        assert other.status == AttendanceWaiverStatus.PENDING
        # Denying is never capped.
        await _svc(db_session).deny(dept.org, dept.officer, other.id)

    async def test_the_calendar_year_is_the_departments(self, db_session, dept, clock):
        await self._cap(db_session, dept, 1)
        clock.now = utc(2026, 12, 30)
        # 03:00 UTC on 1 January is the evening of 31 December in New York.
        new_years_eve = await make_session(
            db_session, dept.org, utc(2027, 1, 1, 3), link=[dept.requirement]
        )
        await _approved_on(db_session, dept, date(2026, 6, 1))

        result = await _svc(db_session).eligibility(
            dept.org, dept.member, new_years_eve
        )
        assert result.session_date == date(2026, 12, 31)
        assert result.refusal_code == "no_waivers_left"

    async def test_a_new_calendar_year_starts_afresh(self, db_session, dept, clock):
        await self._cap(db_session, dept, 1)
        clock.now = utc(2026, 12, 30)
        january = await make_session(
            db_session, dept.org, utc(2027, 1, 2, 23), link=[dept.requirement]
        )
        await _approved_on(db_session, dept, date(2026, 6, 1))
        request = await _submit(db_session, dept, event_id=january)
        approved = await _svc(db_session).approve(dept.org, dept.officer, request.id)
        assert approved.status == AttendanceWaiverStatus.APPROVED

    async def test_a_rolling_cap_checks_every_window_containing_the_session(
        self, db_session, dept, clock
    ):
        await self._cap(db_session, dept, 1, "rolling_12_months")
        clock.now = utc(2027, 2, 1)
        inside = await make_session(
            db_session, dept.org, utc(2027, 2, 27, 23), link=[dept.requirement]
        )
        outside = await make_session(
            db_session, dept.org, utc(2027, 3, 2, 23), link=[dept.requirement]
        )
        # Twelve months from 1 March 2026 run to 28 February 2027.
        await _approved_on(db_session, dept, date(2026, 3, 1))

        refused = await _svc(db_session).eligibility(dept.org, dept.member, inside)
        assert refused.refusal_code == "no_waivers_left"
        allowed = await _svc(db_session).eligibility(dept.org, dept.member, outside)
        assert allowed.allowed, allowed.refusal

    async def test_a_rolling_cap_counts_a_future_approval(
        self, db_session, dept, clock
    ):
        await self._cap(db_session, dept, 1, "rolling_12_months")
        later = await make_session(
            db_session, dept.org, utc(2027, 6, 1, 23), link=[dept.requirement]
        )
        early = await _submit(db_session, dept)
        late = await _submit(db_session, dept, event_id=later)
        await _svc(db_session).approve(dept.org, dept.officer, late.id)
        # June 2027 approved first; November 2026 is in a span with it.
        with pytest.raises(ValueError, match="exceed"):
            await _svc(db_session).approve(dept.org, dept.officer, early.id)

    async def test_a_chief_override_passes_the_cap_and_counts(self, db_session, dept):
        await self._cap(db_session, dept, 1)
        second = await make_session(
            db_session, dept.org, DRILL + timedelta(days=7), link=[dept.requirement]
        )
        third = await make_session(
            db_session, dept.org, DRILL + timedelta(days=14), link=[dept.requirement]
        )
        first = await _submit(db_session, dept)
        denied = await _submit(db_session, dept, event_id=second)
        await _svc(db_session).approve(dept.org, dept.officer, first.id)
        await _svc(db_session).deny(dept.org, dept.officer, denied.id, "Over cap")

        overridden = await _svc(db_session).chief_override(
            dept.org, dept.chief, denied.id, "Family emergency"
        )
        assert overridden.status == AttendanceWaiverStatus.APPROVED
        assert overridden.chief_override is True

        result = await _svc(db_session).eligibility(dept.org, dept.member, third)
        assert (result.cap_used, result.refusal_code) == (2, "no_waivers_left")


class TestChiefOverride:
    async def _denied(self, db, dept, who=None):
        request = await _submit(db, dept, who=who)
        decider = dept.chief if who is dept.officer else dept.officer
        await _svc(db).deny(dept.org, decider, request.id, "No")
        return request

    async def test_only_the_chief(self, db_session, dept):
        request = await self._denied(db_session, dept)
        with pytest.raises(PermissionError, match="Only the Chief"):
            await _svc(db_session).chief_override(
                dept.org, dept.officer, request.id, "Because"
            )

    async def test_only_a_denied_request(self, db_session, dept):
        request = await _submit(db_session, dept)
        with pytest.raises(ValueError, match="Only a denied request"):
            await _svc(db_session).chief_override(
                dept.org, dept.chief, request.id, "Because"
            )

    async def test_a_reason_is_required(self, db_session, dept):
        request = await self._denied(db_session, dept)
        with pytest.raises(ValueError, match="reason"):
            await _svc(db_session).chief_override(
                dept.org, dept.chief, request.id, "   "
            )

    async def test_never_on_the_chiefs_own_request(self, db_session, dept):
        request = await _submit(db_session, dept, who=dept.chief)
        await _svc(db_session).deny(dept.org, dept.officer, request.id, "No")
        with pytest.raises(PermissionError, match="your own"):
            await _svc(db_session).chief_override(
                dept.org, dept.chief, request.id, "Mine"
            )

    async def test_the_denial_stays_on_record(self, db_session, dept):
        request = await self._denied(db_session, dept)
        await _svc(db_session).chief_override(
            dept.org, dept.chief, request.id, "Because"
        )
        actions = (
            (
                await db_session.execute(
                    select(AttendanceWaiverRequestAction.action)
                    .where(AttendanceWaiverRequestAction.request_id == request.id)
                    .order_by(AttendanceWaiverRequestAction.created_at)
                )
            )
            .scalars()
            .all()
        )
        assert set(actions) == {
            AttendanceWaiverAction.SUBMITTED,
            AttendanceWaiverAction.DENIED,
            AttendanceWaiverAction.CHIEF_OVERRIDE,
        }


# ---------------------------------------------------------------------------
# Routing and who may decide
# ---------------------------------------------------------------------------


class TestRouting:
    async def _decides(self, db, dept, request):
        policy = await _svc(db).get_policy(dept.org)
        return {
            name
            for name in ("member", "other", "officer", "chief", "manager")
            if await _svc(db).may_decide(getattr(dept, name), request, policy)
        }

    async def _recipients(self, db, dept, request):
        policy = await _svc(db).get_policy(dept.org)
        ids = {u.id for u in await _svc(db).recipients(dept.org, request, policy)}
        return {
            name
            for name in ("member", "other", "officer", "chief", "manager")
            if getattr(dept, name).id in ids
        }

    async def test_the_chosen_position_decides_and_is_asked(self, db_session, dept):
        request = await _submit(db_session, dept)
        assert await self._recipients(db_session, dept, request) == {"officer"}
        # The Chief may always decide; a training manager is only a fallback.
        assert await self._decides(db_session, dept, request) == {"officer", "chief"}

    async def test_the_requester_is_never_asked_or_allowed(self, db_session, dept):
        request = await _submit(db_session, dept, who=dept.officer)
        # The only holder asked themselves, so it falls through to the Chief.
        assert await self._recipients(db_session, dept, request) == {"chief"}
        assert await self._decides(db_session, dept, request) == {"chief"}

    async def test_a_vacant_position_falls_back_to_the_chief(self, db_session, dept):
        vacant = await make_position(db_session, dept.org, "Vacant Office")
        await set_policy(db_session, dept.org, approver_position_ids=[vacant])
        request = await _submit(db_session, dept)
        assert await self._recipients(db_session, dept, request) == {"chief"}
        assert await self._decides(db_session, dept, request) == {"chief"}

    async def test_no_positions_and_no_chief_falls_back_to_managers(
        self, db_session, dept
    ):
        await set_policy(db_session, dept.org, approver_position_ids=[])
        await db_session.execute(
            text("DELETE FROM user_positions WHERE position_id = :p"),
            {"p": dept.chief_pos},
        )
        request = await _submit(db_session, dept)
        assert await self._recipients(db_session, dept, request) == {"manager"}
        assert await self._decides(db_session, dept, request) == {"manager"}

    async def test_an_inactive_holder_is_not_asked(self, db_session, dept):
        await db_session.execute(
            text("UPDATE users SET status = 'inactive' WHERE id = :id"),
            {"id": dept.officer.id},
        )
        request = await _submit(db_session, dept)
        assert await self._recipients(db_session, dept, request) == {"chief"}

    async def test_the_queue_is_exactly_what_may_be_decided(self, db_session, dept):
        """The queue's SQL is a projection of may_decide; they must agree for
        every member in each routing state."""
        mine = await _submit(db_session, dept)
        officers = await _submit(db_session, dept, who=dept.officer)
        chiefs = await _submit(db_session, dept, who=dept.chief)
        managers = await _submit(db_session, dept, who=dept.manager)
        requests = [mine, officers, chiefs, managers]
        names = ("member", "other", "officer", "chief", "manager")
        service = _svc(db_session)

        async def check():
            policy = await service.get_policy(dept.org)
            for name in names:
                actor = getattr(dept, name)
                expected = {
                    r.id for r in requests if await service.may_decide(actor, r, policy)
                }
                listed, total = await service.list_for_decider(dept.org, actor)
                assert {r.id for r in listed} == expected, name
                assert total == len(expected), name

        await check()
        await set_policy(db_session, dept.org, approver_position_ids=[])
        await check()
        await db_session.execute(
            text("DELETE FROM user_positions WHERE position_id = :p"),
            {"p": dept.chief_pos},
        )
        await check()

    async def test_the_queue_keeps_what_the_actor_decided(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.officer, request.id)
        # The officer leaves the position; their decision stays in their list.
        await db_session.execute(
            text("DELETE FROM user_positions WHERE user_id = :u"),
            {"u": dept.officer.id},
        )
        officer = await load(db_session, dept.officer.id)
        listed, _ = await _svc(db_session).list_for_decider(dept.org, officer)
        assert [r.id for r in listed] == [request.id]
        assert (await _svc(db_session).get(dept.org, officer, request.id)).id == (
            request.id
        )

    async def test_the_queue_filters_by_status_and_pages(self, db_session, dept):
        first = await _submit(db_session, dept)
        second = await _submit(db_session, dept, who=dept.other)
        await _svc(db_session).deny(dept.org, dept.officer, first.id)
        service = _svc(db_session)
        pending, total = await service.list_for_decider(
            dept.org, dept.officer, AttendanceWaiverStatus.PENDING
        )
        assert ([r.id for r in pending], total) == ([second.id], 1)
        page, total = await service.list_for_decider(
            dept.org, dept.officer, skip=1, limit=1
        )
        assert total == 2
        assert len(page) == 1


# ---------------------------------------------------------------------------
# Notices
# ---------------------------------------------------------------------------


class TestNotices:
    async def _bell(self, db, category, recipient):
        return (
            (
                await db.execute(
                    select(NotificationLog).where(
                        NotificationLog.category == category,
                        NotificationLog.recipient_id == recipient,
                    )
                )
            )
            .scalars()
            .all()
        )

    async def test_deciders_are_prompted_and_the_prompt_goes_once_decided(
        self, db_session, dept
    ):
        request = await _submit(db_session, dept, reason="Knee surgery")
        (prompt,) = await self._bell(
            db_session, REVIEW_PROMPT_CATEGORY, dept.officer.id
        )
        assert prompt.action_url == f"/attendance-waivers/{request.id}"
        assert "Knee" not in (prompt.message or "")
        assert prompt.expires_at is None

        await _svc(db_session).approve(dept.org, dept.officer, request.id, "Get well")
        await db_session.refresh(prompt)
        assert prompt.expires_at is not None

        (notice,) = await self._bell(db_session, MEMBER_UPDATE_CATEGORY, dept.member.id)
        assert "approved" in notice.message
        # The note stays on the request page, which is encrypted.
        assert "Get well" not in notice.message

    async def test_withdrawing_archives_the_prompt(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).withdraw(dept.org, dept.member, request.id)
        (prompt,) = await self._bell(
            db_session, REVIEW_PROMPT_CATEGORY, dept.officer.id
        )
        assert prompt.expires_at is not None

    async def test_a_failed_prompt_does_not_fail_the_request(
        self, db_session, dept, monkeypatch
    ):
        async def boom(*args, **kwargs):
            raise RuntimeError("bell is down")

        monkeypatch.setattr(AttendanceWaiverService, "recipients", boom)
        request = await _submit(db_session, dept)
        assert request.status == AttendanceWaiverStatus.PENDING
        stored = await db_session.get(AttendanceWaiverRequest, request.id)
        assert stored is not None


# ---------------------------------------------------------------------------
# Policy and isolation
# ---------------------------------------------------------------------------


class TestPolicy:
    async def test_saving_keeps_the_rest_of_the_training_settings(
        self, db_session, dept
    ):
        org = await db_session.get(Organization, dept.org)
        org.settings = {
            **org.settings,
            "training": {
                **org.settings["training"],
                "auto_enroll_program_id": "keep-me",
            },
        }
        await db_session.flush()

        saved = await _svc(db_session).save_policy(
            dept.org,
            AttendanceWaiverPolicy(enabled=True, cap=4, categories=["Medical"]),
            dept.manager,
        )
        assert saved.cap == 4
        await db_session.refresh(org)
        assert org.settings["training"]["auto_enroll_program_id"] == "keep-me"
        assert (await _svc(db_session).get_policy(dept.org)).cap == 4
        audits = await db_session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.event_type == "attendance_waiver_policy_updated",
                AuditLog.user_id == dept.manager.id,
            )
        )
        assert audits == 1

    async def test_the_generic_settings_save_cannot_write_the_policy(
        self, db_session, dept
    ):
        """Only the policy endpoint writes it: a settings.manage holder's PATCH
        would skip training.manage, the validation and the position check, and
        an unreadable value silently turns the feature off for everyone."""
        before = await _svc(db_session).get_policy(dept.org)
        assert before.enabled

        await OrganizationService(db_session).update_organization_settings(
            dept.org,
            {
                "training": {
                    "session_waiver_policy": {"cap": 0},
                    "auto_enroll_program_id": "still-written",
                }
            },
        )

        org = await db_session.get(Organization, dept.org)
        await db_session.refresh(org)
        assert org.settings["training"]["auto_enroll_program_id"] == "still-written"
        assert await _svc(db_session).get_policy(dept.org) == before
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.drill)
        assert result.allowed, result.refusal

    async def test_another_departments_position_is_refused(self, db_session, dept):
        elsewhere = await make_org(db_session)
        foreign = await make_position(db_session, elsewhere, "Their Officer")
        with pytest.raises(ValueError, match="Invalid position"):
            await _svc(db_session).save_policy(
                dept.org,
                AttendanceWaiverPolicy(enabled=True, approver_position_ids=[foreign]),
                dept.manager,
            )


class TestIsolation:
    async def test_another_department_cannot_reach_a_request(self, db_session, dept):
        request = await _submit(db_session, dept)
        elsewhere = await make_org(db_session)
        chief_pos = await make_position(
            db_session, elsewhere, "Chief", slug="fire_chief"
        )
        their_chief_id = await make_member(db_session, elsewhere, "Zed")
        await assign(db_session, their_chief_id, chief_pos)
        their_chief = await load(db_session, their_chief_id)
        service = _svc(db_session)

        for call in (
            service.get(elsewhere, their_chief, request.id),
            service.approve(elsewhere, their_chief, request.id),
            service.deny(elsewhere, their_chief, request.id),
            service.withdraw(elsewhere, their_chief, request.id),
            service.chief_override(elsewhere, their_chief, request.id, "x"),
        ):
            with pytest.raises(AttendanceWaiverNotFound):
                await call
        listed, total = await service.list_for_decider(elsewhere, their_chief)
        assert (listed, total) == ([], 0)

    async def test_another_departments_session_is_not_found(self, db_session, dept):
        elsewhere = await make_org(db_session)
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).eligibility(elsewhere, dept.member, dept.drill)
