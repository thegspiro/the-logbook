"""
An officer can void a training record a member should not have been credited
for — a completion they cheated on, say — or edit one, and the member is told.

A void needs a reason, which the member sees on the record and in the notice.
The record is kept, marked voided, so the correction stays auditable, and it
cannot be edited back into credit. An imported record keeps its provider id,
so a later sync or upload of the same completion links to the voided record
instead of crediting it again.
"""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.external_training import upload_report
from app.api.v1.endpoints.training import update_record, void_record
from app.models.email_template import EmailTemplateType
from app.models.notification import NotificationLog
from app.models.qualification import MemberQualification
from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import User, UserStatus
from app.schemas.training import TrainingRecordResponse, TrainingRecordUpdate
from app.services.qualification_service import QualificationService
from app.services.training_record_notices import (
    CHANGED,
    NOTICE_CATEGORY,
    VOIDED,
    build_notice,
    deliver_training_record_notice,
    describe_changes,
    send_training_record_notice,
    snapshot,
)
from tests.test_external_training_report_upload import (
    MATCHED,
    _records_for,
    _report,
    _setup,
    _upload,
)

_SENDER = "app.services.email_service.EmailService.send_training_record_notice_email"


def _record(**overrides):
    fields = dict(
        course_name="HIPAA Awareness",
        training_type=TrainingType.CONTINUING_EDUCATION,
        completion_date=date(2026, 9, 1),
        hours_completed=1.0,
        credit_hours=1.0,
        expiration_date=None,
        certification_number=None,
        status=TrainingStatus.COMPLETED,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


@pytest.mark.unit
class TestDescribeChanges:
    def test_lists_each_member_visible_change(self):
        before = snapshot(_record())
        after = snapshot(_record(hours_completed=0.5, completion_date=date(2026, 9, 2)))

        assert describe_changes(before, after) == [
            ("Completed", "September 01, 2026", "September 02, 2026"),
            ("Hours", "1", "0.5"),
        ]

    def test_nothing_visible_changed(self):
        assert describe_changes(snapshot(_record()), snapshot(_record())) == []


@pytest.mark.unit
class TestBuildNotice:
    def test_void_carries_the_reason(self):
        notice = build_notice(
            _record(), VOIDED, "Captain Lopez", reason="Someone else took it"
        )

        assert notice["subject"] == "Training record voided — HIPAA Awareness"
        assert "Captain Lopez voided" in notice["message"]
        assert "Reason: Someone else took it" in notice["message"]
        assert notice["email_context"]["void_reason"] == "Someone else took it"
        assert "September 01, 2026" in notice["email_context"]["details_html"]

    def test_change_lists_before_and_after(self):
        notice = build_notice(
            _record(),
            CHANGED,
            "Captain Lopez",
            reason="Provider credits 0.5 hours",
            changes=[("Hours", "1", "0.5")],
        )

        assert "• Hours: 1 → 0.5" in notice["message"]
        assert "Officer's notes: Provider credits 0.5 hours" in notice["message"]
        assert "Hours: 1 -> 0.5" in notice["email_context"]["details_text"]

    def test_markup_is_escaped_in_the_raw_html_variables(self):
        notice = build_notice(
            _record(),
            CHANGED,
            "Captain Lopez",
            reason="<script>x</script>",
            changes=[("Course", "<b>A</b>", "B")],
        )

        context = notice["email_context"]
        assert "<script>" not in context["notes_html"]
        assert "<b>" not in context["details_html"]

    def test_a_subject_is_one_line(self):
        notice = build_notice(_record(course_name="HIPAA\nBcc: x"), VOIDED, "Lopez")
        assert "\n" not in notice["subject"]


async def _officer(db_session, org):
    officer = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"o{uuid.uuid4().hex[:10]}",
        email="officer@dept.test",
        first_name="Maria",
        last_name="Lopez",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(officer)
    await db_session.flush()
    return officer


async def _imported_record(db_session):
    org, member, provider = await _setup(db_session)
    await upload_report(
        uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
    )
    (record,) = await _records_for(db_session, provider)
    officer = await _officer(db_session, org)
    return org, member, officer, provider, record


@pytest.mark.integration
class TestVoid:
    async def test_void_keeps_the_record_and_says_why(self, db_session):
        _, member, officer, _, record = await _imported_record(db_session)
        tasks = BackgroundTasks()

        await void_record(
            uuid.UUID(record.id),
            tasks,
            "Completed by another member",
            db_session,
            officer,
        )

        await db_session.refresh(record)
        assert record.status == TrainingStatus.CANCELLED
        assert record.void_reason == "Completed by another member"
        assert record.voided_by == officer.id
        assert record.voided_at is not None
        assert "Completed by another member" in record.notes
        response = TrainingRecordResponse.model_validate(record)
        assert response.void_reason == "Completed by another member"
        assert response.voided_at is not None
        (task,) = tasks.tasks
        assert task.func is send_training_record_notice
        assert task.args[3] == VOIDED
        assert task.kwargs["reason"] == "Completed by another member"

    async def test_a_blank_reason_is_refused(self, db_session):
        _, _, officer, _, record = await _imported_record(db_session)

        with pytest.raises(HTTPException) as err:
            await void_record(
                uuid.UUID(record.id), BackgroundTasks(), "   ", db_session, officer
            )

        assert err.value.status_code == 400
        await db_session.refresh(record)
        assert record.status == TrainingStatus.COMPLETED

    async def test_a_voided_record_cannot_be_edited_back(self, db_session):
        _, _, officer, _, record = await _imported_record(db_session)
        await void_record(
            uuid.UUID(record.id), BackgroundTasks(), "Cheated", db_session, officer
        )

        with pytest.raises(HTTPException) as err:
            await update_record(
                uuid.UUID(record.id),
                TrainingRecordUpdate(status="completed"),
                BackgroundTasks(),
                None,
                db_session,
                officer,
            )

        assert err.value.status_code == 400
        await db_session.refresh(record)
        assert record.status == TrainingStatus.CANCELLED

    async def test_reimporting_the_completion_does_not_credit_it_again(
        self, db_session
    ):
        _, member, officer, provider, record = await _imported_record(db_session)
        await void_record(
            uuid.UUID(record.id), BackgroundTasks(), "Cheated", db_session, officer
        )

        again = await upload_report(
            uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
        )

        assert again.training_records_created == 0
        (only,) = await _records_for(db_session, provider)
        assert only.id == record.id
        assert only.status == TrainingStatus.CANCELLED

    async def test_void_withdraws_the_qualification_it_granted(self, db_session):
        org, member, officer, _, _ = await _imported_record(db_session)
        course = TrainingCourse(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="EMT-B",
            training_type=TrainingType.CERTIFICATION,
            grants_qualification="emt",
        )
        db_session.add(course)
        record = TrainingRecord(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            user_id=member.id,
            course_id=course.id,
            course_name="EMT-B",
            training_type=TrainingType.CERTIFICATION,
            completion_date=date(2026, 9, 1),
            hours_completed=120,
            status=TrainingStatus.COMPLETED,
        )
        db_session.add(record)
        await db_session.flush()
        await QualificationService(db_session).sync_from_training_record(record)
        await db_session.commit()

        await void_record(
            uuid.UUID(record.id), BackgroundTasks(), "Cheated", db_session, officer
        )

        held = (
            await db_session.execute(
                select(MemberQualification).where(
                    MemberQualification.user_id == member.id,
                    MemberQualification.qualification_code == "emt",
                )
            )
        ).scalar_one_or_none()
        assert held is None


@pytest.mark.integration
class TestEdit:
    async def test_a_visible_change_tells_the_member(self, db_session):
        _, _, officer, _, record = await _imported_record(db_session)
        tasks = BackgroundTasks()

        await update_record(
            uuid.UUID(record.id),
            TrainingRecordUpdate(hours_completed=0.5),
            tasks,
            "Provider credits half an hour",
            db_session,
            officer,
        )

        (task,) = tasks.tasks
        assert task.args[3] == CHANGED
        assert task.kwargs["changes"] == [("Hours", "1", "0.5")]
        assert task.kwargs["reason"] == "Provider credits half an hour"

    async def test_an_internal_edit_sends_nothing(self, db_session):
        _, _, officer, _, record = await _imported_record(db_session)
        tasks = BackgroundTasks()

        await update_record(
            uuid.UUID(record.id),
            TrainingRecordUpdate(notes="checked against the roster"),
            tasks,
            None,
            db_session,
            officer,
        )

        assert tasks.tasks == []


@pytest.mark.integration
class TestDelivery:
    async def test_void_notice_reaches_the_bell_and_the_inbox(self, db_session):
        org, member, officer, _, record = await _imported_record(db_session)

        with patch(_SENDER, new=AsyncMock(return_value=True)) as send:
            sent = await deliver_training_record_notice(
                db_session,
                org.id,
                record.id,
                officer.id,
                VOIDED,
                reason="Completed by another member",
            )

        assert sent is True
        bell = (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.recipient_id == member.id,
                    NotificationLog.category == NOTICE_CATEGORY,
                )
            )
        ).scalar_one()
        assert "Completed by another member" in bell.message
        assert bell.notification_metadata == {"record_id": record.id, "change": VOIDED}
        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["template_type"] == EmailTemplateType.TRAINING_RECORD_VOIDED
        assert kwargs["to_email"] == "pat@dept.test"
        assert kwargs["context"]["void_reason"] == "Completed by another member"
        assert kwargs["context"]["officer_name"]

    async def test_email_ignores_the_members_master_switch(self, db_session):
        # Required kind: a member who turned email off still learns of a void.
        org, member, officer, _, record = await _imported_record(db_session)
        member.notification_preferences = {"email_notifications": False}
        await db_session.flush()

        with patch(_SENDER, new=AsyncMock(return_value=True)) as send:
            await deliver_training_record_notice(
                db_session, org.id, record.id, officer.id, VOIDED, reason="Cheated"
            )

        send.assert_awaited_once()

    async def test_an_officers_own_record_sends_nothing(self, db_session):
        org, member, _, _, record = await _imported_record(db_session)

        with patch(_SENDER, new=AsyncMock(return_value=True)) as send:
            sent = await deliver_training_record_notice(
                db_session, org.id, record.id, member.id, VOIDED, reason="Mine"
            )

        assert sent is False
        send.assert_not_awaited()

    async def test_another_orgs_record_is_not_found(self, db_session):
        _, _, officer, _, record = await _imported_record(db_session)

        with patch(_SENDER, new=AsyncMock(return_value=True)) as send:
            sent = await deliver_training_record_notice(
                db_session,
                str(uuid.uuid4()),
                record.id,
                officer.id,
                VOIDED,
                reason="x",
            )

        assert sent is False
        send.assert_not_awaited()
