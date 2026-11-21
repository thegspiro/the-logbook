"""A former decider sees a request's outcome, not its reason or notes.

The reason and the deciders' notes can be medical, and they are shown only to
the member and to those who may decide (TRAINING_WAIVERS.md). Whoever decided
a request can still open it afterwards, so their "decided by me" history
works, but once they no longer hold the deciding position they read it the
way the documents on it already are: without the protected text. Their own
note stays, since they wrote it.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.models.attendance_waiver import AttendanceWaiverAttachment
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import AttendanceWaiverService
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
DRILL = utc(2026, 11, 20, 23)
REASON = "Post-op cardiac rehab"
DENIAL = "Drill is mandatory this month"
ANSWER = "Cleared by cardiology on 1 December"


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    approver_pos = await make_position(db_session, org_id, "Training Officer")
    member = await make_member(db_session, org_id, "Sam")
    captain = await make_member(db_session, org_id, "Ava")
    await assign(db_session, captain, approver_pos)
    await set_policy(db_session, org_id, approver_position_ids=[approver_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        approver_pos=approver_pos,
        member=await load(db_session, member),
        captain=await load(db_session, captain),
        captain_id=captain,
        drill=drill,
    )


async def _decided(db, dept):
    """A request the captain asked about, the member answered, then denied."""
    service = AttendanceWaiverService(db)
    request = await service.submit(dept.org, dept.member, dept.drill, None, REASON)
    await service.request_info(dept.org, dept.captain, request.id, "Return date?")
    await service.respond(dept.org, dept.member, request.id, ANSWER)
    db.add(
        AttendanceWaiverAttachment(
            organization_id=dept.org,
            request_id=str(request.id),
            ordinal=1,
            file_path=f"{dept.org}/attendance-waivers/{request.id}/1",
            mime_type="application/pdf",
            file_size=10,
            sha256="0" * 64,
            uploaded_by=str(dept.member.id),
        )
    )
    await service.deny(dept.org, dept.captain, request.id, DENIAL)
    return request


async def _view(db, dept, viewer):
    service = AttendanceWaiverService(db)
    request = await service.get(dept.org, viewer, dept.request_id)
    (body,) = await service.describe(dept.org, viewer, [request], with_actions=True)
    return body


async def _leave_position(db, dept):
    await db.execute(
        text("DELETE FROM user_positions WHERE user_id = :u AND position_id = :p"),
        {"u": dept.captain_id, "p": dept.approver_pos},
    )
    return await load(db, dept.captain_id)


class TestAFormerDecider:
    async def test_reads_the_outcome_without_the_reason_or_others_notes(
        self, db_session, dept
    ):
        dept.request_id = (await _decided(db_session, dept)).id
        former = await _leave_position(db_session, dept)

        body = await _view(db_session, dept, former)

        assert body["status"] == "denied"
        assert body["decided_by"] == dept.captain_id
        assert body["reason"] is None
        notes = {a["action"]: a["note"] for a in body["actions"]}
        assert notes["member_responded"] is None
        # Their own words are theirs to read.
        assert notes["denied"] == DENIAL
        assert notes["info_requested"] == "Return date?"
        assert REASON not in str(body)
        assert ANSWER not in str(body)
        # The documents' download already refuses them; nor are they listed.
        assert body["attachments"] == []

    async def test_still_finds_it_in_their_decided_history(self, db_session, dept):
        dept.request_id = (await _decided(db_session, dept)).id
        former = await _leave_position(db_session, dept)

        found, _ = await AttendanceWaiverService(db_session).list_for_decider(
            dept.org, former
        )

        assert [str(r.id) for r in found] == [str(dept.request_id)]


class TestThoseWhoMaySeeIt:
    async def test_a_current_decider_reads_everything(self, db_session, dept):
        dept.request_id = (await _decided(db_session, dept)).id

        body = await _view(db_session, dept, dept.captain)

        assert body["reason"] == REASON
        notes = {a["action"]: a["note"] for a in body["actions"]}
        assert notes["member_responded"] == ANSWER
        assert len(body["attachments"]) == 1

    async def test_the_member_reads_everything(self, db_session, dept):
        dept.request_id = (await _decided(db_session, dept)).id

        body = await _view(db_session, dept, dept.member)

        assert body["reason"] == REASON
        notes = {a["action"]: a["note"] for a in body["actions"]}
        assert notes["denied"] == DENIAL
