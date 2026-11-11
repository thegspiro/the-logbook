"""Business-meeting waiver requests, end to end through the shared engine.

Pins the owner decisions of 2026-11-10 for the meeting workflow against a real
database:

  * the policy is its own, at ``settings["meetings"]["waiver_policy"]``, off
    until saved, and the generic settings save cannot write it;
  * a member asks about a business_meeting EVENT, once, before the deadline,
    not after checking in, not when a leave or the Secretary already excuses
    them; withdraw, deny, cap and the Chief's override work as for training,
    and the two workflows never see each other's requests or caps;
  * routing falls back to the Secretary, then to meetings.manage holders;
  * approving writes the Secretary's kind of waiver onto the minutes record,
    with a standard text and never the member's reason, leaving ``present``
    alone; a minutes record built later carries approved requests over;
  * cancelling or deleting the event voids pending requests and keeps
    decided ones.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.audit import AuditLog
from app.models.event import Event, EventRSVP, RSVPStatus
from app.models.meeting import MeetingAttendee
from app.models.notification import NotificationLog
from app.models.user import MemberLeaveOfAbsence, Organization
from app.schemas.attendance_waiver import AttendanceWaiverPolicy
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    MEETING_WAIVER_TEXT,
    REVIEW_PROMPT_CATEGORY,
    AttendanceWaiverNotFound,
    AttendanceWaiverService,
)
from app.services.event_service import EventService
from app.services.meetings_service import MeetingsService
from app.services.organization_service import OrganizationService
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
    make_member,
    make_minutes_record,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_meeting_policy,
    set_policy,
    uid,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
# 19:00 in New York on 20 November.
MEETING = utc(2026, 11, 21, 0)

MEETINGS = AttendanceWaiverWorkflow.BUSINESS_MEETING


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    state = SimpleNamespace(now=NOW)
    monkeypatch.setattr(engine, "_now", lambda: state.now)
    return state


@pytest.fixture
async def dept(db_session):
    """A department whose chosen approver is a Clerk, with a Secretary, a
    Chief, a meetings manager, two members and one business meeting."""
    org_id = await make_org(db_session)
    clerk_pos = await make_position(db_session, org_id, "Clerk")
    secretary_pos = await make_position(
        db_session, org_id, "Secretary", slug="secretary"
    )
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    manager_pos = await make_position(
        db_session, org_id, "Meetings Admin", permissions=["meetings.manage"]
    )
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "clerk", "secretary", "chief", "manager")
    }
    await assign(db_session, ids["clerk"], clerk_pos)
    await assign(db_session, ids["secretary"], secretary_pos)
    await assign(db_session, ids["chief"], chief_pos)
    await assign(db_session, ids["manager"], manager_pos)
    await set_meeting_policy(db_session, org_id, approver_position_ids=[clerk_pos])
    meeting = await make_meeting_event(db_session, org_id, MEETING)
    second = await make_meeting_event(db_session, org_id, MEETING + timedelta(days=28))
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(
        org=org_id,
        clerk_pos=clerk_pos,
        secretary_pos=secretary_pos,
        meeting=meeting,
        second=second,
        ids=ids,
        **users,
    )


def _svc(db) -> AttendanceWaiverService:
    return AttendanceWaiverService(db, MEETINGS)


async def _submit(db, dept, who=None, event_id=None, **answers):
    return await _svc(db).submit(
        dept.org,
        who or dept.member,
        event_id or dept.meeting,
        answers.get("category"),
        answers.get("reason"),
    )


async def _attendee(db, meeting_id, user_id):
    return (
        await db.execute(
            select(MeetingAttendee)
            .where(
                MeetingAttendee.meeting_id == meeting_id,
                MeetingAttendee.user_id == user_id,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _rsvp(db, dept, user_id, event_id=None, *, checked_in=True):
    db.add(
        EventRSVP(
            id=uid(),
            organization_id=dept.org,
            event_id=event_id or dept.meeting,
            user_id=user_id,
            status=RSVPStatus.GOING,
            checked_in=checked_in,
        )
    )
    await db.flush()


class TestPolicy:
    async def test_off_until_the_secretary_saves_one(self, db_session):
        org_id = await make_org(db_session)
        policy = await _svc(db_session).get_policy(org_id)
        assert policy.enabled is False

    async def test_malformed_reads_as_disabled(self, db_session, dept):
        org = (
            await db_session.execute(
                select(Organization).where(Organization.id == dept.org)
            )
        ).scalar_one()
        org.settings = {"meetings": {"waiver_policy": {"enabled": True, "cap": -4}}}
        await db_session.flush()
        assert (await _svc(db_session).get_policy(dept.org)).enabled is False

    async def test_the_two_policies_are_separate(self, db_session, dept):
        """Saving the meeting policy leaves the training one off, and the
        training policy does not switch meetings on."""
        assert (
            await AttendanceWaiverService(db_session).get_policy(dept.org)
        ).enabled is (False)
        await set_policy(db_session, dept.org)
        await set_meeting_policy(db_session, dept.org, enabled=False)
        assert (await AttendanceWaiverService(db_session).get_policy(dept.org)).enabled
        assert not (await _svc(db_session).get_policy(dept.org)).enabled

    async def test_save_stores_it_under_meetings_and_audits(self, db_session, dept):
        saved = await _svc(db_session).save_policy(
            dept.org,
            AttendanceWaiverPolicy(enabled=True, cap=2, categories=["Work"]),
            dept.secretary,
        )
        assert saved.cap == 2
        org = (
            await db_session.execute(
                select(Organization)
                .where(Organization.id == dept.org)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert org.settings["meetings"]["waiver_policy"]["cap"] == 2
        assert "training" not in org.settings
        audit = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "attendance_waiver_policy_updated",
                    AuditLog.user_id == dept.ids["secretary"],
                )
            )
        ).scalar_one()
        assert audit.event_category == "meetings"
        assert audit.event_data["workflow"] == "business_meeting"

    async def test_a_foreign_position_is_refused(self, db_session, dept):
        other_org = await make_org(db_session)
        foreign = await make_position(db_session, other_org, "Elsewhere")
        with pytest.raises(ValueError, match="Invalid position"):
            await _svc(db_session).save_policy(
                dept.org,
                AttendanceWaiverPolicy(enabled=True, approver_position_ids=[foreign]),
                dept.secretary,
            )

    async def test_the_settings_save_cannot_write_it(self, db_session, dept):
        before = (await _svc(db_session).get_policy(dept.org)).model_dump()
        await OrganizationService(db_session).update_organization_settings(
            dept.org,
            {"meetings": {"waiver_policy": {"enabled": False}, "other": 1}},
            may_configure_delegated_email=False,
        )
        assert (await _svc(db_session).get_policy(dept.org)).model_dump() == before
        org = (
            await db_session.execute(
                select(Organization)
                .where(Organization.id == dept.org)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert org.settings["meetings"]["other"] == 1


class TestEligibility:
    async def test_a_business_meeting_is_open(self, db_session, dept):
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.allowed, result.refusal
        assert result.session_date == date(2026, 11, 20)

    async def test_a_training_session_is_not_a_meeting(self, db_session, dept):
        requirement = await make_requirement(db_session, dept.org)
        drill = await make_session(db_session, dept.org, MEETING, link=[requirement])
        result = await _svc(db_session).eligibility(dept.org, dept.member, drill)
        assert result.refusal_code == "not_meeting"

    async def test_a_meeting_is_not_a_training_session(self, db_session, dept):
        await set_policy(db_session, dept.org)
        result = await AttendanceWaiverService(db_session).eligibility(
            dept.org, dept.member, dept.meeting
        )
        assert result.refusal_code == "not_training"

    async def test_cancelled(self, db_session, dept):
        event = await make_meeting_event(db_session, dept.org, MEETING, cancelled=True)
        result = await _svc(db_session).eligibility(dept.org, dept.member, event)
        assert result.refusal_code == "cancelled"

    async def test_disabled(self, db_session, dept):
        await set_meeting_policy(db_session, dept.org, enabled=False)
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.refusal_code == "disabled"
        assert "business meetings" in result.refusal

    async def test_on_leave(self, db_session, dept):
        db_session.add(
            MemberLeaveOfAbsence(
                id=uid(),
                organization_id=dept.org,
                user_id=dept.ids["member"],
                start_date=date(2026, 11, 1),
                end_date=date(2026, 11, 30),
                active=True,
            )
        )
        await db_session.flush()
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.refusal_code == "on_leave"

    async def test_checked_in_at_the_event(self, db_session, dept):
        await _rsvp(db_session, dept, dept.ids["member"])
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.refusal_code == "checked_in"

    async def test_present_on_the_minutes_record(self, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        db_session.add(
            MeetingAttendee(
                organization_id=dept.org,
                meeting_id=meeting_id,
                user_id=dept.ids["member"],
                present=True,
            )
        )
        await db_session.flush()
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.refusal_code == "checked_in"

    async def test_already_excused_by_the_secretary(self, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        db_session.add(
            MeetingAttendee(
                organization_id=dept.org,
                meeting_id=meeting_id,
                user_id=dept.ids["member"],
                present=False,
                waiver_reason="Out of town",
            )
        )
        await db_session.flush()
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.refusal_code == "already_excused"

    @pytest.mark.parametrize(
        ("preset", "allowed_after_start"),
        [("before_start", False), ("24h_after_end", True), ("7d_after_end", True)],
    )
    async def test_deadline_presets(
        self, db_session, dept, clock, preset, allowed_after_start
    ):
        await set_meeting_policy(db_session, dept.org, deadline=preset)
        clock.now = MEETING + timedelta(hours=3)
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.allowed is allowed_after_start
        if not allowed_after_start:
            assert result.refusal_code == "deadline_passed"


class TestStateMachine:
    async def test_submit_withdraw_and_ask_again(self, db_session, dept):
        first = await _submit(db_session, dept, reason="Night shift at work")
        assert first.workflow == MEETINGS
        assert first.status == AttendanceWaiverStatus.PENDING
        with pytest.raises(ValueError, match="already asked"):
            await _submit(db_session, dept)
        await _svc(db_session).withdraw(dept.org, dept.member, first.id)
        again = await _submit(db_session, dept)
        assert again.id != first.id

    async def test_a_denial_holds_the_meeting(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.clerk, request.id, "No")
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.refusal_code == "already_requested"

    async def test_the_member_cannot_decide_their_own(self, db_session, dept):
        request = await _submit(db_session, dept, who=dept.clerk)
        with pytest.raises(PermissionError):
            await _svc(db_session).approve(dept.org, dept.clerk, request.id)

    async def test_the_first_decision_is_final(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        with pytest.raises(ValueError, match="already been approved"):
            await _svc(db_session).deny(dept.org, dept.chief, request.id)

    async def test_the_chief_overrides_a_denial(self, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.clerk, request.id)
        with pytest.raises(PermissionError):
            await _svc(db_session).chief_override(
                dept.org, dept.clerk, request.id, "Because"
            )
        overridden = await _svc(db_session).chief_override(
            dept.org, dept.chief, request.id, "Family emergency, verified"
        )
        assert overridden.status == AttendanceWaiverStatus.APPROVED
        assert overridden.chief_override is True
        attendee = await _attendee(db_session, meeting_id, dept.ids["member"])
        assert attendee.waiver_request_id == request.id
        assert attendee.waiver_granted_by == dept.ids["chief"]

    async def test_every_action_is_audited_under_meetings(self, db_session, dept):
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        rows = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type.in_(
                            [
                                "attendance_waiver_request_submitted",
                                "attendance_waiver_request_approved",
                            ]
                        ),
                        AuditLog.event_data["request_id"].as_string() == request.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.event_category for r in rows} == {"meetings"}
        assert len(rows) == 2
        assert all("reason" not in r.event_data for r in rows)

    async def test_the_workflows_never_see_each_others_requests(self, db_session, dept):
        request = await _submit(db_session, dept)
        training = AttendanceWaiverService(db_session)
        with pytest.raises(AttendanceWaiverNotFound):
            await training.get(dept.org, dept.member, request.id)
        with pytest.raises(AttendanceWaiverNotFound):
            await training.approve(dept.org, dept.chief, request.id)
        assert await training.list_mine(dept.org, dept.member) == []
        mine = await _svc(db_session).list_mine(dept.org, dept.member)
        assert [r.id for r in mine] == [request.id]

    async def test_the_prompt_leads_to_the_meeting_request_page(self, db_session, dept):
        request = await _submit(db_session, dept)
        prompt = (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.category == REVIEW_PROMPT_CATEGORY,
                    NotificationLog.recipient_id == dept.ids["clerk"],
                )
            )
        ).scalar_one()
        assert prompt.action_url == f"/meetings/waiver-requests/{request.id}"


class TestCap:
    async def test_counts_only_meeting_approvals(self, db_session, dept):
        """A training waiver does not use up a meeting waiver."""
        await set_policy(db_session, dept.org)
        await set_meeting_policy(
            db_session, dept.org, cap=1, approver_position_ids=[dept.clerk_pos]
        )
        officer_pos = await make_position(db_session, dept.org, "Training Officer")
        await assign(db_session, dept.ids["clerk"], officer_pos)
        await set_policy(db_session, dept.org, approver_position_ids=[officer_pos])
        requirement = await make_requirement(db_session, dept.org)
        drill = await make_session(db_session, dept.org, MEETING, link=[requirement])
        training = AttendanceWaiverService(db_session)
        clerk = await load(db_session, dept.ids["clerk"])
        trained = await training.submit(dept.org, dept.member, drill, None, None)
        await training.approve(dept.org, clerk, trained.id)

        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.meeting)
        assert result.allowed, result.refusal
        assert result.cap_remaining == 1
        first = await _submit(db_session, dept)
        second = await _submit(db_session, dept, event_id=dept.second)
        await _svc(db_session).approve(dept.org, clerk, first.id)
        with pytest.raises(ValueError, match="exceed the department's cap"):
            await _svc(db_session).approve(dept.org, clerk, second.id)
        # The Chief is not blocked, and the override counts.
        await _svc(db_session).deny(dept.org, clerk, second.id)
        await _svc(db_session).chief_override(dept.org, dept.chief, second.id, "Ok")
        after = await _svc(db_session).eligibility(
            dept.org,
            dept.member,
            await make_meeting_event(
                db_session, dept.org, MEETING + timedelta(days=35)
            ),
        )
        assert after.cap_used == 2
        assert after.refusal_code == "no_waivers_left"


class TestRouting:
    async def test_the_chosen_positions_decide(self, db_session, dept):
        request = await _submit(db_session, dept)
        recipients = await _svc(db_session).recipients(
            dept.org, request, await _svc(db_session).get_policy(dept.org)
        )
        assert [str(u.id) for u in recipients] == [dept.ids["clerk"]]
        assert not await _svc(db_session).may_decide(
            dept.secretary, request, await _svc(db_session).get_policy(dept.org)
        )
        # A Chief may always decide.
        assert await _svc(db_session).may_decide(
            dept.chief, request, await _svc(db_session).get_policy(dept.org)
        )

    async def test_falls_back_to_the_secretary(self, db_session, dept):
        await set_meeting_policy(db_session, dept.org)
        request = await _submit(db_session, dept)
        policy = await _svc(db_session).get_policy(dept.org)
        recipients = await _svc(db_session).recipients(dept.org, request, policy)
        assert [str(u.id) for u in recipients] == [dept.ids["secretary"]]
        page, total = await _svc(db_session).list_for_decider(dept.org, dept.secretary)
        assert total == 1
        assert page[0].id == request.id
        approved = await _svc(db_session).approve(dept.org, dept.secretary, request.id)
        assert approved.status == AttendanceWaiverStatus.APPROVED

    async def test_the_secretarys_own_request_goes_to_managers(self, db_session, dept):
        await set_meeting_policy(db_session, dept.org)
        request = await _submit(db_session, dept, who=dept.secretary)
        policy = await _svc(db_session).get_policy(dept.org)
        recipients = await _svc(db_session).recipients(dept.org, request, policy)
        assert {str(u.id) for u in recipients} == {dept.ids["manager"]}
        page, _ = await _svc(db_session).list_for_decider(dept.org, dept.manager)
        assert [r.id for r in page] == [request.id]
        assert (await _svc(db_session).list_for_decider(dept.org, dept.other))[1] == 0

    async def test_falls_back_to_meetings_managers(self, db_session, dept):
        """No positions chosen and no Secretary: meetings.manage holders."""
        org_id = await make_org(db_session)
        manager_pos = await make_position(
            db_session, org_id, "Admin", permissions=["meetings.manage"]
        )
        trainer_pos = await make_position(
            db_session, org_id, "Trainer", permissions=["training.manage"]
        )
        member = await load(db_session, await make_member(db_session, org_id, "Ann"))
        manager_id = await make_member(db_session, org_id, "Mo")
        trainer_id = await make_member(db_session, org_id, "Tia")
        await assign(db_session, manager_id, manager_pos)
        await assign(db_session, trainer_id, trainer_pos)
        await set_meeting_policy(db_session, org_id)
        event = await make_meeting_event(db_session, org_id, MEETING)
        request = await _svc(db_session).submit(org_id, member, event, None, None)
        policy = await _svc(db_session).get_policy(org_id)
        recipients = await _svc(db_session).recipients(org_id, request, policy)
        assert [str(u.id) for u in recipients] == [manager_id]
        page, total = await _svc(db_session).list_for_decider(
            org_id, await load(db_session, manager_id)
        )
        assert total == 1


class TestGranting:
    async def test_approval_writes_the_waiver_on_the_minutes_record(
        self, db_session, dept
    ):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        await set_meeting_policy(
            db_session,
            dept.org,
            approver_position_ids=[dept.clerk_pos],
            categories=["Work", "Medical"],
        )
        request = await _submit(
            db_session, dept, category="work", reason="Surgery follow-up, private"
        )
        await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        attendee = await _attendee(db_session, meeting_id, dept.ids["member"])
        assert attendee is not None
        assert attendee.present is False
        assert attendee.excused is True
        assert attendee.waiver_reason == f"{MEETING_WAIVER_TEXT} (Work)"
        assert "Surgery" not in attendee.waiver_reason
        assert attendee.waiver_granted_by == dept.ids["clerk"]
        assert attendee.waiver_request_id == request.id

    async def test_no_category_writes_the_bare_text(self, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        request = await _submit(db_session, dept)
        await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        attendee = await _attendee(db_session, meeting_id, dept.ids["member"])
        assert attendee.waiver_reason == MEETING_WAIVER_TEXT

    async def test_an_existing_row_keeps_its_presence(self, db_session, dept):
        """Marked present after approving: present stays (check-in wins)."""
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        db_session.add(
            MeetingAttendee(
                organization_id=dept.org,
                meeting_id=meeting_id,
                user_id=dept.ids["member"],
                present=False,
            )
        )
        await db_session.flush()
        request = await _submit(db_session, dept)
        attendee = await _attendee(db_session, meeting_id, dept.ids["member"])
        attendee.present = True
        await db_session.flush()
        await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        attendee = await _attendee(db_session, meeting_id, dept.ids["member"])
        assert attendee.present is True
        assert attendee.waiver_request_id == request.id
        rows = (
            (
                await db_session.execute(
                    select(MeetingAttendee).where(
                        MeetingAttendee.meeting_id == meeting_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1

    async def test_the_secretarys_own_waiver_is_not_overwritten(self, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        request = await _submit(db_session, dept)
        db_session.add(
            MeetingAttendee(
                organization_id=dept.org,
                meeting_id=meeting_id,
                user_id=dept.ids["member"],
                present=False,
                excused=True,
                waiver_reason="Granted at the door",
            )
        )
        await db_session.flush()
        await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        attendee = await _attendee(db_session, meeting_id, dept.ids["member"])
        assert attendee.waiver_reason == "Granted at the door"
        assert attendee.waiver_request_id is None

    async def test_a_denial_writes_nothing(self, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"], event_id=dept.meeting
        )
        request = await _submit(db_session, dept)
        await _svc(db_session).deny(dept.org, dept.clerk, request.id)
        assert await _attendee(db_session, meeting_id, dept.ids["member"]) is None

    async def test_no_minutes_record_yet_writes_nothing(self, db_session, dept):
        request = await _submit(db_session, dept)
        approved = await _svc(db_session).approve(dept.org, dept.clerk, request.id)
        assert approved.status == AttendanceWaiverStatus.APPROVED
        rows = (await db_session.execute(select(MeetingAttendee))).scalars().all()
        assert all(r.waiver_request_id != request.id for r in rows)


class TestCarryOver:
    async def test_create_from_event_carries_approved_requests(self, db_session, dept):
        absent = await _submit(db_session, dept, reason="Work")
        await _svc(db_session).approve(dept.org, dept.clerk, absent.id)
        attended = await _submit(db_session, dept, who=dept.other)
        await _svc(db_session).approve(dept.org, dept.clerk, attended.id)
        # The other member came after all and checked in.
        await _rsvp(db_session, dept, dept.ids["other"])
        pending = await _submit(db_session, dept, who=dept.manager)
        denied = await _submit(db_session, dept, who=dept.chief)
        await _svc(db_session).deny(dept.org, dept.clerk, denied.id)

        meeting, error = await MeetingsService(db_session).create_from_event(
            dept.meeting, dept.org, dept.ids["secretary"]
        )
        assert error is None, error
        member_row = await _attendee(db_session, meeting.id, dept.ids["member"])
        assert member_row.present is False
        assert member_row.excused is True
        assert member_row.waiver_reason == MEETING_WAIVER_TEXT
        assert member_row.waiver_request_id == absent.id
        assert member_row.waiver_granted_by == dept.ids["clerk"]
        other_row = await _attendee(db_session, meeting.id, dept.ids["other"])
        assert other_row.present is True
        assert other_row.waiver_request_id == attended.id
        assert await _attendee(db_session, meeting.id, dept.ids["manager"]) is None
        assert await _attendee(db_session, meeting.id, dept.ids["chief"]) is None
        assert pending.status == AttendanceWaiverStatus.PENDING

    async def test_a_hand_made_record_cannot_be_requested(self, db_session, dept):
        """A minutes record with no event has nothing to ask about; the
        Secretary's own grant still works on it."""
        from app.services.attendance_dashboard_service import (
            AttendanceDashboardService,
        )

        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"]
        )
        with pytest.raises(AttendanceWaiverNotFound):
            await _submit(db_session, dept, event_id=meeting_id)
        granted = await AttendanceDashboardService(db_session).grant_waiver(
            meeting_id=meeting_id,
            user_id=dept.ids["member"],
            organization_id=dept.org,
            granted_by=dept.ids["secretary"],
            reason="Called away",
        )
        assert granted["waiver_reason"] == "Called away"


class TestEventLifecycle:
    async def test_cancelling_voids_pending_and_keeps_decided(self, db_session, dept):
        pending = await _submit(db_session, dept)
        approved = await _submit(db_session, dept, who=dept.other)
        await _svc(db_session).approve(dept.org, dept.clerk, approved.id)

        await EventService(db_session).cancel_event(dept.meeting, dept.org, "Snow")

        pending_row = await db_session.get(
            AttendanceWaiverRequest, pending.id, populate_existing=True
        )
        assert pending_row.status == AttendanceWaiverStatus.VOIDED
        assert pending_row.live_key is None
        approved_row = await db_session.get(
            AttendanceWaiverRequest, approved.id, populate_existing=True
        )
        assert approved_row.status == AttendanceWaiverStatus.APPROVED
        actions = (
            (
                await db_session.execute(
                    select(AttendanceWaiverRequestAction.action).where(
                        AttendanceWaiverRequestAction.request_id == pending.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert AttendanceWaiverAction.VOIDED in actions
        prompts = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.category == REVIEW_PROMPT_CATEGORY,
                        NotificationLog.notification_metadata[
                            "waiver_request_id"
                        ].as_string()
                        == pending.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert prompts
        assert all(p.read for p in prompts)
        audit = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "attendance_waiver_request_voided",
                    AuditLog.event_data["request_id"].as_string() == pending.id,
                )
            )
        ).scalar_one()
        assert audit.event_data["cause"] == "cancelled"

    async def test_deleting_voids_pending_and_keeps_the_history(self, db_session, dept):
        pending = await _submit(db_session, dept)
        approved = await _submit(db_session, dept, who=dept.other)
        await _svc(db_session).approve(dept.org, dept.clerk, approved.id)

        assert await EventService(db_session).delete_event(dept.meeting, dept.org)

        assert await db_session.get(Event, dept.meeting) is None
        pending_row = await db_session.get(
            AttendanceWaiverRequest, pending.id, populate_existing=True
        )
        assert pending_row.status == AttendanceWaiverStatus.VOIDED
        approved_row = await db_session.get(
            AttendanceWaiverRequest, approved.id, populate_existing=True
        )
        assert approved_row.status == AttendanceWaiverStatus.APPROVED
        assert approved_row.event_id is None

    async def test_training_requests_are_voided_too(self, db_session, dept):
        """One engine: the training workflow's pending requests go the same
        way when their session is cancelled."""
        await set_policy(db_session, dept.org)
        requirement = await make_requirement(db_session, dept.org)
        drill = await make_session(db_session, dept.org, MEETING, link=[requirement])
        training = AttendanceWaiverService(db_session)
        request = await training.submit(dept.org, dept.member, drill, None, None)
        await EventService(db_session).cancel_event(drill, dept.org, "Rain")
        row = await db_session.get(
            AttendanceWaiverRequest, request.id, populate_existing=True
        )
        assert row.status == AttendanceWaiverStatus.VOIDED
