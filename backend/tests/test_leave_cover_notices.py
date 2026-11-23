"""A stand-in is told about their cover; an approver going on leave is asked
to name one.

Owner decisions of 2026-11-22:

- The officer named to decide leave requests in an approver's place gets an
  email and an in-app notice when named, when the cover is cleared, and the
  day after it ends. Each once, whatever re-runs.
- When an approver's own leave request is approved, the approval notice and
  an in-app notice ask them to name a stand-in, and Leave Requests offers
  the form with the leave's dates filled in.
"""

from datetime import date, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.email_template import EmailTemplateType
from app.models.leave_request import LeaveApproverCover, LeaveNoticeSend
from app.models.notification import NotificationLog
from app.models.user import LeaveType, MemberLeaveOfAbsence, Organization
from app.services import leave_workflow_notices as notices
from app.services.leave_request_service import LeaveRequestService
from app.utils.org_timezone import resolve_org_today
from tests.test_leave_chief_routing_and_cover import (
    _board,
    _board_department,
    _cover,
)
from tests.test_leave_requests import _as, _ask, _configure, _vote

pytestmark = pytest.mark.integration

PRIVATE_REASON = "Recovering from knee surgery"


async def _bells(db, recipient_id: str):
    return list(
        (
            await db.execute(
                select(NotificationLog).where(
                    NotificationLog.recipient_id == recipient_id,
                    NotificationLog.category == notices.BELL_CATEGORY,
                )
            )
        ).scalars()
    )


class _Emails:
    """Stands in for the sender, noting each email as it is sent.

    The ids are read inside the call: a claim that loses its race rolls the
    session back, which expires every loaded row, so reading ``user.id``
    afterwards would need the database again.
    """

    def __init__(self):
        self.sent: list = []

    async def __call__(self, db, org, user, kind, template_type, context):
        self.sent.append((str(user.id), template_type, dict(context)))
        return True

    def to(self, user_id: str) -> list:
        return [t for uid, t, _ in self.sent if uid == user_id]


def _emails(recorder: "_Emails"):
    return patch.object(notices, "_send", recorder)


async def _stored_cover(db, org_id, approver, stand_in, start, end):
    cover = LeaveApproverCover(
        organization_id=org_id,
        approver_id=str(approver.id),
        stand_in_id=str(stand_in.id),
        start_date=start,
        end_date=end,
    )
    db.add(cover)
    await db.flush()
    return cover


async def _leave(db, org_id, member, start, end):
    leave = MemberLeaveOfAbsence(
        organization_id=org_id,
        user_id=str(member.id),
        leave_type=LeaveType.MEDICAL,
        reason=PRIVATE_REASON,
        start_date=start,
        end_date=end,
        active=True,
    )
    db.add(leave)
    await db.flush()
    return leave


class TestTheStandInIsTold:
    async def test_setting_a_cover_queues_the_named_notice(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        queued: list = []
        async with _as(db_session, away, queued) as client:
            response = await client.post(
                "/users/leave-requests/covers",
                json={
                    "approver_id": str(away.id),
                    "stand_in_id": str(officer.id),
                    "start_date": today.isoformat(),
                    "end_date": (today + timedelta(days=6)).isoformat(),
                },
            )

        assert response.status_code == 201, response.text
        cover_id = response.json()["covers"][0]["id"]
        assert queued == [("cover_named", (org_id, cover_id, str(away.id)), {})]

    async def test_named_is_one_email_and_one_bell_however_often_it_runs(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        cover = await _stored_cover(
            db_session, org_id, away, officer, today, today + timedelta(days=6)
        )
        cover_id, away_id, officer_id = cover.id, str(away.id), str(officer.id)
        away_name = notices._name(away)
        emails = _Emails()

        with _emails(emails):
            assert await notices.notify_cover_named(
                db_session, org_id, cover_id, away_id
            )
            assert not await notices.notify_cover_named(
                db_session, org_id, cover_id, away_id
            )

        assert emails.to(officer_id) == [EmailTemplateType.LEAVE_COVER_NAMED]
        [(_, _, context)] = emails.sent
        assert context["approver_name"] == away_name
        assert context["set_by_name"] == away_name
        assert PRIVATE_REASON not in str(context)
        [bell] = await _bells(db_session, officer_id)
        assert bell.notification_metadata == {"leave_cover_id": cover_id}
        assert bell.action_url == notices.REQUESTS_PATH

    async def test_clearing_queues_the_cleared_notice_with_the_cover_it_was(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        end = today + timedelta(days=6)
        await _cover(db_session, away, away, officer, today, end)
        cover_id = (await _board(db_session, away))["covers"][0]["id"]
        queued: list = []
        async with _as(db_session, away, queued) as client:
            response = await client.delete(f"/users/leave-requests/covers/{cover_id}")

        assert response.status_code == 200, response.text
        [(name, args, _)] = queued
        assert name == "cover_cleared"
        assert args[0] == org_id
        assert args[1] == {
            "id": cover_id,
            "approver_id": str(away.id),
            "stand_in_id": str(officer.id),
            "start_date": today,
            "end_date": end,
        }
        assert args[2] == str(away.id)

    async def test_cleared_is_sent_once_and_never_to_a_stand_in_who_cleared_it(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        away_id, officer_id = str(away.id), str(officer.id)
        cover: dict[str, Any] = {
            "id": "c-1",
            "approver_id": away_id,
            "stand_in_id": officer_id,
            "start_date": today,
            "end_date": today + timedelta(days=3),
        }
        emails = _Emails()

        with _emails(emails):
            assert not await notices.notify_cover_cleared(
                db_session, org_id, cover, officer_id
            )
            assert await notices.notify_cover_cleared(
                db_session, org_id, cover, away_id
            )
            assert not await notices.notify_cover_cleared(
                db_session, org_id, cover, away_id
            )

        assert emails.to(officer_id) == [EmailTemplateType.LEAVE_COVER_CLEARED]
        assert len(await _bells(db_session, officer_id)) == 1


class TestTheDayAfterACoverEnds:
    async def test_only_a_recently_ended_cover_is_told_and_only_once(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, other), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        ended = await _stored_cover(
            db_session,
            org_id,
            away,
            officer,
            today - timedelta(days=10),
            today - timedelta(days=1),
        )
        # Ended longer ago than the lookback: never told, so an upgrade does
        # not reach back over every old cover.
        await _stored_cover(
            db_session,
            org_id,
            other,
            officer,
            today - timedelta(days=30),
            today - timedelta(days=notices.COVER_ENDED_LOOKBACK_DAYS + 1),
        )
        # Ends today: still running.
        await _stored_cover(db_session, org_id, other, officer, today, today)
        ended_id, officer_id = ended.id, str(officer.id)
        org = await db_session.get(Organization, org_id)
        emails = _Emails()

        with _emails(emails):
            assert await notices.send_cover_endings(db_session, org) == 1
            org = await db_session.get(Organization, org_id)
            assert await notices.send_cover_endings(db_session, org) == 0

        assert emails.to(officer_id) == [EmailTemplateType.LEAVE_COVER_ENDED]
        claims = (
            await db_session.execute(
                select(LeaveNoticeSend.key).where(
                    LeaveNoticeSend.organization_id == org_id,
                    LeaveNoticeSend.kind == notices.KIND_COVER_ENDED,
                )
            )
        ).scalars()
        assert list(claims) == [ended_id]

    async def test_the_daily_upkeep_sends_it(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _stored_cover(
            db_session,
            org_id,
            away,
            officer,
            today - timedelta(days=3),
            today - timedelta(days=1),
        )
        officer_id = str(officer.id)
        org = await db_session.get(Organization, org_id)
        emails = _Emails()

        with _emails(emails):
            await notices.run_request_upkeep(db_session, org)

        assert emails.to(officer_id) == [EmailTemplateType.LEAVE_COVER_ENDED]


class TestAnApproverGoingOnLeaveIsAskedToNameOne:
    async def test_the_board_offers_the_leaves_dates(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        leave = await _leave(
            db_session,
            org_id,
            away,
            today - timedelta(days=2),
            today + timedelta(days=9),
        )

        board = await _board(db_session, away)

        assert board["suggested"] == [
            {
                "leave_id": leave.id,
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=9)).isoformat(),
            }
        ]

    async def test_an_open_ended_leave_is_offered_without_an_end(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        start = today + timedelta(days=5)
        await _leave(db_session, org_id, away, start, None)

        [offer] = (await _board(db_session, away))["suggested"]

        assert offer["start_date"] == start.isoformat()
        assert offer["end_date"] is None

    async def test_a_covered_leave_is_not_offered_again(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _leave(db_session, org_id, away, today, today + timedelta(days=9))
        await _cover(db_session, away, away, officer, today, today + timedelta(days=2))

        assert (await _board(db_session, away))["suggested"] == []

    async def test_a_member_who_decides_nothing_is_not_asked(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, _, _, _, member = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _leave(db_session, org_id, member, today, today + timedelta(days=9))

        assert (await _board(db_session, member))["suggested"] == []

    async def test_nobody_is_asked_while_the_department_takes_no_requests(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        await _leave(db_session, org_id, away, today, today + timedelta(days=9))
        await _configure(db_session, officer, requests_enabled=False)

        assert (
            await LeaveRequestService(db_session).cover_suggestions(org_id, away.id)
            == []
        )

    async def test_the_approval_notice_asks_an_approver_and_rings_the_bell(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, chief, _, (away, _), _ = await _board_department(db_session, org_id)
        today = await resolve_org_today(db_session, org_id)
        leave = await _leave(
            db_session,
            org_id,
            away,
            today + timedelta(days=3),
            today + timedelta(days=9),
        )
        away_id, leave_id = str(away.id), leave.id
        deliver = AsyncMock(return_value=True)

        with patch(
            "app.services.leave_of_absence_notices.deliver_leave_notice", deliver
        ):
            await notices.deliver_approval_notice(
                db_session,
                org_id,
                leave_id,
                str(chief.id),
                "recorded",
                "Your request for a leave of absence was approved.",
            )

        summary = deliver.await_args.kwargs["summary"]
        assert summary.startswith("Your request for a leave of absence was approved. ")
        assert summary.endswith(
            notices.cover_prompt_sentence(
                today + timedelta(days=3), today + timedelta(days=9)
            )
        )
        [bell] = await _bells(db_session, away_id)
        assert bell.subject == "Name a stand-in while you are away"
        assert bell.notification_metadata == {"leave_id": leave_id}

    async def test_a_members_approval_notice_is_unchanged(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        _, _, _, (board0, _), member = await _board_department(db_session, org_id)
        member_id = str(member.id)
        request = await _ask(db_session, member)
        queued: list = []
        await _vote(db_session, board0, request["id"], "approve", queued)
        [(_, args, kwargs)] = queued
        deliver = AsyncMock(return_value=True)

        with patch(
            "app.services.leave_of_absence_notices.deliver_leave_notice", deliver
        ):
            await notices.deliver_approval_notice(
                db_session, org_id, args[1], args[2], args[3], kwargs["summary"]
            )

        assert (
            deliver.await_args.kwargs["summary"]
            == "Your request for a leave of absence was approved."
        )
        assert await _bells(db_session, member_id) == []

    async def test_an_open_ended_prompt_names_only_its_first_day(
        self, db_session, setup_org_and_admin
    ):
        """With no end date the prompt gives the first day alone."""
        assert notices.cover_prompt_sentence(date(2027, 1, 4), None) == (
            "You decide leave requests, so name an officer to decide them in "
            "your place from January 04, 2027 on the Leave Requests page."
        )
