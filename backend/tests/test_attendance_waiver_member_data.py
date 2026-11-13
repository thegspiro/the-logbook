"""A member's waiver requests in their data export, and after anonymization.

The export carries the member's own requests, reason included: it is their
own words. It carries the decision log of those requests too, deciders' notes
included, which the member already reads on the request itself; never the log
of anyone else's request, though the member may have decided it. Anonymizing a departed member clears the reason and the deciders'
notes, which may be medical, and keeps the rows, which are the record that a
session was excused and which grading still reads. Another member's requests
are untouched either way.
"""

import json
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.meeting import Meeting, MeetingAttendee, MeetingStatus, MeetingType
from app.models.user import Organization, User
from app.services.data_export_service import DataExportService
from app.services.member_anonymization_service import MemberAnonymizationService

pytestmark = pytest.mark.integration


async def _org(db) -> Organization:
    org = Organization(name="Waiver Data FD", slug=f"wd-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, **overrides) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Pat",
        last_name="Member",
        **overrides,
    )
    db.add(user)
    await db.flush()
    return user


async def _request(
    db,
    org,
    user,
    reason,
    note,
    workflow=AttendanceWaiverWorkflow.TRAINING_SESSION,
):
    request = AttendanceWaiverRequest(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        workflow=workflow,
        user_id=user.id,
        event_id=None,
        event_title_snapshot="Company Drill",
        event_start_snapshot=datetime(2026, 3, 4, 23, tzinfo=UTC),
        session_date=date(2026, 3, 4),
        status=AttendanceWaiverStatus.DENIED,
        category="Medical",
        reason=reason,
        submitted_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    db.add(request)
    await db.flush()
    db.add(
        AttendanceWaiverRequestAction(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            request_id=request.id,
            action=AttendanceWaiverAction.DENIED,
            actor_id=None,
            note=note,
            created_at=datetime(2026, 3, 2, tzinfo=UTC),
        )
    )
    await db.flush()
    return request


async def test_the_export_carries_the_members_own_requests(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    other = await _member(db_session, org)
    mine = await _request(db_session, org, member, "Knee surgery", "Sorry")
    await _request(db_session, org, other, "Not theirs", "No")

    export = await DataExportService(db_session).export_user_data(member)

    rows = export["attendance_waiver_requests"]
    assert [r["id"] for r in rows] == [mine.id]
    assert rows[0]["reason"] == "Knee surgery"
    assert rows[0]["status"] == "denied"
    json.dumps(export)


async def test_the_export_carries_the_decision_log_of_the_members_requests(
    db_session,
):
    org = await _org(db_session)
    member = await _member(db_session, org)
    other = await _member(db_session, org)
    mine = await _request(db_session, org, member, "Knee surgery", "Sorry, no")
    theirs = await _request(db_session, org, other, "Flu", "Not this time")
    # The member decided the other's request: a note about someone else.
    db_session.add(
        AttendanceWaiverRequestAction(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            request_id=theirs.id,
            action=AttendanceWaiverAction.APPROVED,
            actor_id=member.id,
            note="Get well soon",
            created_at=datetime(2026, 3, 3, tzinfo=UTC),
        )
    )
    await db_session.flush()

    export = await DataExportService(db_session).export_user_data(member)

    log = export["attendance_waiver_request_actions"]
    assert [(a["request_id"], a["action"], a["note"]) for a in log] == [
        (mine.id, "denied", "Sorry, no")
    ]
    json.dumps(export)


async def test_anonymizing_clears_the_reason_and_notes_and_keeps_the_rows(
    db_session,
):
    org = await _org(db_session)
    departed = await _member(db_session, org, deleted_at=datetime.now(UTC))
    other = await _member(db_session, org)
    gone = await _request(db_session, org, departed, "Knee surgery", "Get well")
    kept = await _request(db_session, org, other, "Flu", "Feel better")

    summary = await MemberAnonymizationService(db_session).anonymize_member(departed)

    assert summary["attendance_waiver_reasons_scrubbed"] == 1
    assert summary["attendance_waiver_notes_scrubbed"] == 1
    for request_id, reason, note in (
        (gone.id, None, None),
        (kept.id, "Flu", "Feel better"),
    ):
        row = (
            await db_session.execute(
                select(AttendanceWaiverRequest)
                .where(AttendanceWaiverRequest.id == request_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert row.reason == reason
        assert row.status == AttendanceWaiverStatus.DENIED
        assert row.category == "Medical"
        action = (
            await db_session.execute(
                select(AttendanceWaiverRequestAction)
                .where(AttendanceWaiverRequestAction.request_id == request_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert action.note == note


async def _approved_meeting_waiver(db, org, member):
    """A business-meeting request and the waiver its approval wrote."""
    request = await _request(
        db,
        org,
        member,
        "Chemo appointment",
        "Approved",
        workflow=AttendanceWaiverWorkflow.BUSINESS_MEETING,
    )
    meeting = Meeting(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Business Meeting",
        meeting_type=MeetingType.BUSINESS,
        meeting_date=date(2026, 3, 4),
        status=MeetingStatus.APPROVED,
    )
    db.add(meeting)
    await db.flush()
    db.add(
        MeetingAttendee(
            organization_id=org.id,
            meeting_id=meeting.id,
            user_id=member.id,
            present=False,
            excused=True,
            waiver_reason="Excused: approved request (Medical)",
            waiver_request_id=request.id,
        )
    )
    await db.flush()
    return request


async def test_the_export_carries_meeting_requests_and_their_waiver(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    request = await _approved_meeting_waiver(db_session, org, member)

    export = await DataExportService(db_session).export_user_data(member)

    rows = export["attendance_waiver_requests"]
    assert [(r["id"], r["workflow"]) for r in rows] == [
        (request.id, "business_meeting")
    ]
    assert rows[0]["reason"] == "Chemo appointment"
    assert [a["request_id"] for a in export["attendance_waiver_request_actions"]] == [
        request.id
    ]
    (attendance,) = export["meeting_attendance"]
    assert attendance["waiver_request_id"] == request.id
    json.dumps(export)


async def test_anonymizing_clears_a_meeting_request_and_its_waiver_text(
    db_session,
):
    org = await _org(db_session)
    departed = await _member(db_session, org, deleted_at=datetime.now(UTC))
    request = await _approved_meeting_waiver(db_session, org, departed)

    summary = await MemberAnonymizationService(db_session).anonymize_member(departed)

    assert summary["attendance_waiver_reasons_scrubbed"] == 1
    assert summary["meeting_waiver_reasons_scrubbed"] == 1
    row = (
        await db_session.execute(
            select(AttendanceWaiverRequest)
            .where(AttendanceWaiverRequest.id == request.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert row.reason is None
    attendee = (
        await db_session.execute(
            select(MeetingAttendee)
            .where(MeetingAttendee.user_id == departed.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert attendee.waiver_reason is None
    # The link stays: it is the record that the meeting was excused.
    assert attendee.waiver_request_id == request.id
