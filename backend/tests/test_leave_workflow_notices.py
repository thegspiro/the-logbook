"""The leave-ending reminder, the open-ended digest, and the request emails.

Each scheduled email is claimed before it is sent, so a second run sends
nothing (pitfall #36), and none carries a leave's reason or type.
"""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.models.compliance_config import ComplianceConfig
from app.models.leave_request import LeaveRequest, LeaveRequestStatus
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Organization,
    Position,
    User,
    user_positions,
)
from app.services import leave_workflow_notices as notices

PRIVATE_REASON = "Recovering from surgery"
TODAY = date(2026, 11, 24)


def _leave(start, end, exempt=False):
    return SimpleNamespace(
        start_date=start, end_date=end, exempt_from_training_waiver=exempt
    )


@pytest.mark.unit
class TestWhenRequirementsResume:
    def test_full_month_excuses_the_last_month(self):
        note = notices.resume_note(
            _leave(date(2026, 6, 1), date(2026, 9, 1)), "full_month"
        )
        assert "September 2026 is excused in full" in note
        assert "from October 2026" in note

    def test_proportional_gives_the_share(self):
        note = notices.resume_note(
            _leave(date(2026, 6, 1), date(2026, 9, 10)), "proportional"
        )
        assert "September 2026 is 33% excused" in note

    def test_half_rule_owes_a_short_last_month_in_full(self):
        note = notices.resume_note(_leave(date(2026, 6, 1), date(2026, 9, 3)), "half")
        assert "September 2026 is owed in full" in note
        assert "from September 2026" in note

    def test_an_exempt_leave_changes_nothing(self):
        note = notices.resume_note(
            _leave(date(2026, 6, 1), date(2026, 9, 1), exempt=True), "full_month"
        )
        assert "stayed in force" in note


async def _user(db, org_id: str, first: str, permissions=None) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@example.com",
        },
    )
    if permissions:
        position = Position(
            organization_id=org_id,
            name=f"{first} position",
            slug=f"{first.lower()}-{user_id[:8]}",
            permissions=permissions,
        )
        db.add(position)
        await db.flush()
        await db.execute(
            user_positions.insert().values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    return (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _org(db, org_id: str) -> Organization:
    return (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one()


async def _set(db, org_id: str, **settings) -> None:
    org = await _org(db, org_id)
    stored = dict(org.settings or {})
    stored["leave_of_absence"] = settings
    org.settings = stored
    await db.flush()


def _seed_leave(db, org_id, member, start, end, **extra):
    leave = MemberLeaveOfAbsence(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=member.id,
        leave_type=LeaveType.MEDICAL,
        reason=PRIVATE_REASON,
        start_date=start,
        end_date=end,
        active=True,
        **extra,
    )
    db.add(leave)
    return leave


async def _today(*_a, **_kw):
    return TODAY


def _sent(send: AsyncMock):
    return [
        (c.kwargs["to_emails"][0], c.kwargs["subject"], c.kwargs["text_body"])
        for c in send.call_args_list
    ]


@pytest.mark.integration
class TestLeaveEndingReminder:
    async def _run(self, db, org_id):
        with patch.object(notices, "resolve_org_today", _today), patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            count = await notices.send_leave_ending_reminders(
                db, await _org(db, org_id)
            )
        return count, _sent(send)

    async def test_member_and_officers_are_reminded_once(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", ["members.manage"])
        member = await _user(db_session, org_id, "Morgan")
        _seed_leave(db_session, org_id, member, date(2026, 6, 1), date(2026, 11, 30))
        db_session.add(
            ComplianceConfig(organization_id=org_id, leave_month_rule="half")
        )
        await db_session.flush()

        count, sent = await self._run(db_session, org_id)

        assert count == 1
        to = {addr: (subject, body) for addr, subject, body in sent}
        subject, body = to[member.email]
        assert subject == "Your leave of absence ends November 30, 2026"
        assert "November 2026 is excused in full" in body
        assert officer.email in to
        assert "Morgan" in to[officer.email][1]
        for _, _, text_body in sent:
            assert "surgery" not in text_body.lower()
            assert "medical" not in text_body.lower()

        # The next day's run finds the claim and sends nothing.
        assert await self._run(db_session, org_id) == (0, [])

    async def test_officers_are_not_copied_when_the_department_says_not(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", ["members.manage"])
        member = await _user(db_session, org_id, "Morgan")
        _seed_leave(db_session, org_id, member, date(2026, 6, 1), date(2026, 11, 30))
        await _set(db_session, org_id, end_reminder_copy_officers=False)

        _, sent = await self._run(db_session, org_id)

        assert [addr for addr, _, _ in sent] == [member.email]
        assert officer.email not in {addr for addr, _, _ in sent}

    async def test_outside_the_window_or_switched_off_sends_nothing(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _user(db_session, org_id, "Morgan")
        _seed_leave(db_session, org_id, member, date(2026, 6, 1), date(2026, 12, 15))
        await _set(db_session, org_id, end_reminder_days=7)
        assert await self._run(db_session, org_id) == (0, [])

        await _set(db_session, org_id, end_reminder_days=0)
        _seed_leave(db_session, org_id, member, date(2026, 6, 1), date(2026, 11, 25))
        await db_session.flush()
        assert await self._run(db_session, org_id) == (0, [])

    async def test_a_moved_end_date_earns_a_new_reminder(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _user(db_session, org_id, "Morgan")
        leave = _seed_leave(
            db_session, org_id, member, date(2026, 6, 1), date(2026, 11, 30)
        )
        await _set(db_session, org_id, end_reminder_copy_officers=False)
        assert (await self._run(db_session, org_id))[0] == 1

        leave.end_date = date(2026, 11, 28)
        await db_session.flush()

        assert (await self._run(db_session, org_id))[0] == 1


@pytest.mark.integration
class TestOpenEndedDigest:
    async def _run(self, db, org_id, today=TODAY):
        async def _on(*_a, **_kw):
            return today

        with patch.object(notices, "resolve_org_today", _on), patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            count = await notices.send_open_ended_leave_digest(
                db, await _org(db, org_id)
            )
        return count, _sent(send)

    async def test_long_open_ended_leaves_are_listed_once_a_month(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", ["members.manage"])
        old = await _user(db_session, org_id, "Avery")
        recent = await _user(db_session, org_id, "Blake")
        ended = await _user(db_session, org_id, "Casey")
        _seed_leave(db_session, org_id, old, date(2026, 3, 3), None)
        _seed_leave(db_session, org_id, recent, date(2026, 9, 1), None)
        _seed_leave(db_session, org_id, ended, date(2025, 1, 1), date(2026, 1, 1))
        await db_session.flush()

        count, sent = await self._run(db_session, org_id)

        assert count == 1
        [(to, subject, body)] = sent
        assert to == officer.email
        assert subject == "Open-ended leaves to review (1)"
        assert "Avery" in body
        assert "March 03, 2026" in body
        assert "Blake" not in body
        assert "Casey" not in body
        assert "surgery" not in body.lower()

        # Later the same month: already sent.
        assert await self._run(db_session, org_id, date(2026, 11, 28)) == (0, [])
        # Next month it goes again.
        assert (await self._run(db_session, org_id, date(2026, 12, 1)))[0] == 1

    async def test_nothing_is_sent_when_none_qualify(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        await _user(db_session, org_id, "Olive", ["members.manage"])
        member = await _user(db_session, org_id, "Blake")
        _seed_leave(db_session, org_id, member, date(2026, 9, 1), None)
        await db_session.flush()

        assert await self._run(db_session, org_id) == (0, [])


@pytest.mark.integration
class TestRequestEmails:
    async def test_approvers_are_told_without_the_reason(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", ["members.manage"])
        member = await _user(db_session, org_id, "Morgan")
        request = LeaveRequest(
            organization_id=org_id,
            user_id=member.id,
            leave_type=LeaveType.MEDICAL,
            start_date=date(2026, 12, 1),
            end_date=None,
            reason=PRIVATE_REASON,
        )
        db_session.add(request)
        await db_session.flush()

        with patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            count = await notices.notify_request_submitted(
                db_session, org_id, request.id
            )

        # No Chief in this department, so the request goes to those who
        # manage leave.
        assert count == 1
        [(to, subject, body)] = _sent(send)
        assert to == officer.email
        assert subject.startswith("Leave request: Morgan")
        assert "Reason provided: Yes" in body
        assert "No end date" in body
        assert "surgery" not in body.lower()
        assert "medical" not in body.lower()

    async def test_a_denial_tells_the_member(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer = await _user(db_session, org_id, "Olive", ["members.manage"])
        member = await _user(db_session, org_id, "Morgan")
        request = LeaveRequest(
            organization_id=org_id,
            user_id=member.id,
            start_date=date(2026, 12, 1),
            end_date=date(2027, 1, 31),
            status=LeaveRequestStatus.DENIED,
            decided_by=officer.id,
        )
        db_session.add(request)
        await db_session.flush()

        with patch(
            "app.services.email_service.EmailService.send_email",
            AsyncMock(return_value=(1, 0)),
        ) as send:
            assert await notices.notify_request_denied(
                db_session, org_id, request.id, "Coverage is short."
            )

        [(to, subject, body)] = _sent(send)
        assert to == member.email
        assert subject == "Your leave request was denied"
        assert "Coverage is short." in body
