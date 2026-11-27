"""Forms submission pipeline (app-review B13 pass 6).

- Length limits count what the person typed, not its HTML-escaped form.
- ``min_length`` applies to any answer given; a number must be finite.
- A required question the public page never shows (a member lookup) is not
  demanded of a public submission.
- Reprocessing an event-request submission does not file a second request or
  resend its emails.
- An equipment-assignment form assigns gear only to a current member.
- Deleting a submission is audited.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select, text

from app.models.event_request import EventRequest
from app.models.forms import (
    FieldType,
    Form,
    FormField,
    FormIntegration,
    FormStatus,
    FormSubmission,
)
from app.services.forms_service import FormsService


def _field(**kw) -> FormField:
    return FormField(id=kw.pop("id"), label=kw.pop("label"), **kw)


@pytest.mark.unit
class TestAnswerLimits:
    def test_a_quote_counts_as_one_character(self):
        surname = _field(
            id="f1", label="Surname", field_type=FieldType.TEXT, max_length=10
        )
        data, err = FormsService._sanitize_submission_data(
            {"f1": "O'Brien's"}, [surname]
        )
        assert err is None
        assert data == {"f1": "O&#x27;Brien&#x27;s"}

    def test_the_limit_still_refuses_what_is_too_long(self):
        surname = _field(
            id="f1", label="Surname", field_type=FieldType.TEXT, max_length=10
        )
        _, err = FormsService._sanitize_submission_data(
            {"f1": "O'Brien-Smith"}, [surname]
        )
        assert err == "Value for 'Surname' exceeds maximum length of 10 characters"

    def test_min_length_applies_to_an_optional_answer(self):
        notes = _field(
            id="s",
            label="Notes",
            field_type=FieldType.TEXT,
            min_length=10,
            required=False,
        )
        _, err = FormsService._sanitize_submission_data({"s": "ab"}, [notes])
        assert err == "Value for 'Notes' must be at least 10 characters"

    def test_an_optional_answer_may_still_be_left_empty(self):
        notes = _field(
            id="s",
            label="Notes",
            field_type=FieldType.TEXT,
            min_length=10,
            required=False,
        )
        data, err = FormsService._sanitize_submission_data({"s": ""}, [notes])
        assert err is None
        assert data == {"s": ""}

    @pytest.mark.parametrize("value", ["nan", "inf", "-Infinity"])
    def test_a_number_must_be_finite(self, value):
        age = _field(
            id="n",
            label="Age",
            field_type=FieldType.NUMBER,
            min_value=18,
            max_value=65,
        )
        _, err = FormsService._sanitize_submission_data({"n": value}, [age])
        assert err == "Invalid number for 'Age'"

    def test_a_number_in_bounds_is_kept(self):
        age = _field(
            id="n",
            label="Age",
            field_type=FieldType.NUMBER,
            min_value=18,
            max_value=65,
        )
        data, err = FormsService._sanitize_submission_data({"n": "30"}, [age])
        assert err is None
        assert data == {"n": "30"}


@pytest.mark.unit
class TestSubmissionDeleteAudit:
    async def test_deleting_a_submission_is_audited_with_ids_only(self):
        from app.api.v1.endpoints import forms as endpoints

        form_id, submission_id = uuid.uuid4(), uuid.uuid4()
        user = SimpleNamespace(id="u-1", username="officer", organization_id="org-1")
        audit = AsyncMock()
        with patch.object(
            endpoints.FormsService,
            "delete_submission",
            AsyncMock(return_value=(True, None)),
        ), patch.object(endpoints, "log_audit_event", audit):
            await endpoints.delete_submission(
                form_id=form_id,
                submission_id=submission_id,
                db=AsyncMock(),
                current_user=user,
            )

        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "form_submission_deleted"
        assert kwargs["event_data"] == {
            "form_id": str(form_id),
            "submission_id": str(submission_id),
        }

    async def test_a_refused_delete_is_not_audited(self):
        from fastapi import HTTPException

        from app.api.v1.endpoints import forms as endpoints

        user = SimpleNamespace(id="u-1", username="officer", organization_id="org-1")
        audit = AsyncMock()
        with patch.object(
            endpoints.FormsService,
            "delete_submission",
            AsyncMock(return_value=(False, "Submission not found")),
        ), patch.object(endpoints, "log_audit_event", audit):
            with pytest.raises(HTTPException):
                await endpoints.delete_submission(
                    form_id=uuid.uuid4(),
                    submission_id=uuid.uuid4(),
                    db=AsyncMock(),
                    current_user=user,
                )
        audit.assert_not_awaited()


async def _org_and_members(db, statuses=("active",)):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Pipeline FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"pipeline-{org_id[:8]}"},
    )
    members = []
    for n, member_status in enumerate(statuses):
        uid = str(uuid.uuid4())
        await db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'P', 'Q', :em, 'h', :st)"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"m{n}-{uid[:8]}",
                "em": f"{uid[:8]}@pipeline.test",
                "st": member_status,
            },
        )
        members.append(uid)
    return org_id, members


async def _form(db, org_id, fields, **kw):
    form = Form(
        organization_id=org_id,
        name="Pipeline form",
        status=FormStatus.PUBLISHED,
        allow_multiple_submissions=True,
        **kw,
    )
    db.add(form)
    await db.flush()
    stored = []
    for i, spec in enumerate(fields):
        field = FormField(form_id=form.id, sort_order=i, **spec)
        db.add(field)
        stored.append(field)
    await db.flush()
    await db.commit()
    return form, stored


@pytest.mark.integration
class TestPublicMemberLookup:
    async def test_a_required_member_lookup_is_not_demanded_of_a_public_submission(
        self, db_session
    ):
        org_id, _ = await _org_and_members(db_session)
        form, (name, _lookup) = await _form(
            db_session,
            org_id,
            [
                {"label": "Your name", "field_type": FieldType.TEXT, "required": True},
                {
                    "label": "Who referred you",
                    "field_type": FieldType.MEMBER_LOOKUP,
                    "required": True,
                },
            ],
            is_public=True,
            require_authentication=False,
        )

        submission, err = await FormsService(db_session).submit_public_form(
            form.public_slug, {name.id: "Pat"}, enforce_daily_cap=False
        )

        assert err is None
        assert submission is not None
        assert submission.data[name.id] == "Pat"

    async def test_a_shown_required_question_is_still_demanded(self, db_session):
        org_id, _ = await _org_and_members(db_session)
        form, (_name, _lookup) = await _form(
            db_session,
            org_id,
            [
                {"label": "Your name", "field_type": FieldType.TEXT, "required": True},
                {
                    "label": "Who referred you",
                    "field_type": FieldType.MEMBER_LOOKUP,
                    "required": True,
                },
            ],
            is_public=True,
            require_authentication=False,
        )

        submission, err = await FormsService(db_session).submit_public_form(
            form.public_slug, {}, enforce_daily_cap=False
        )

        assert submission is None
        assert err == "Required field 'Your name' is missing"


@pytest.mark.integration
class TestEventRequestReprocess:
    async def test_reprocessing_files_no_second_request_and_sends_no_second_email(
        self, db_session
    ):
        org_id, (member,) = await _org_and_members(db_session)
        form, (name, email) = await _form(
            db_session,
            org_id,
            [
                {"label": "Contact Name", "field_type": FieldType.TEXT},
                {"label": "Contact Email", "field_type": FieldType.EMAIL},
            ],
            integration_type="event_request",
        )
        notify = AsyncMock()
        with patch(
            "app.services.event_request_service.send_request_notification", notify
        ):
            submission, err = await FormsService(db_session).submit_form(
                form.id,
                org_id,
                {name.id: "Dana", email.id: "dana@example.org"},
                submitted_by=member,
            )
            assert err is None
            first = await db_session.scalar(
                select(EventRequest.id).where(
                    EventRequest.form_submission_id == submission.id
                )
            )
            for _ in range(2):
                _, err = await FormsService(
                    db_session
                ).reprocess_submission_integrations(submission.id, org_id)
                assert err is None

        filed = await db_session.scalar(
            select(func.count()).where(EventRequest.form_submission_id == submission.id)
        )
        assert filed == 1
        assert notify.await_count == 1
        stored = await db_session.scalar(
            select(FormSubmission.integration_result).where(
                FormSubmission.id == submission.id
            )
        )
        results = list(stored.values())
        assert len(results) == 1
        assert results[0]["success"] is True
        assert results[0]["event_request_id"] == first


@pytest.mark.integration
class TestEquipmentAssignee:
    async def _process(self, db, org_id, member_id):
        form, (member_field, item_field) = await _form(
            db,
            org_id,
            [
                {"label": "Member", "field_type": FieldType.TEXT},
                {"label": "Item", "field_type": FieldType.TEXT},
            ],
        )
        integration = FormIntegration(
            form_id=form.id,
            organization_id=org_id,
            field_mappings={member_field.id: "member_id", item_field.id: "item_id"},
        )
        submission = FormSubmission(
            organization_id=org_id,
            form_id=form.id,
            data={member_field.id: member_id, item_field.id: str(uuid.uuid4())},
        )
        return await FormsService(db)._process_equipment_assignment(
            submission, integration, form
        )

    async def test_a_departed_member_is_not_assigned_gear(self, db_session):
        org_id, (departed,) = await _org_and_members(
            db_session, statuses=("dropped_voluntary",)
        )

        result = await self._process(db_session, org_id, departed)

        assert result == {
            "success": False,
            "error": "Assigned member is not a current member of this organization",
        }

    @pytest.mark.parametrize("member_status", ["active", "probationary"])
    async def test_a_current_member_passes_the_member_check(
        self, db_session, member_status
    ):
        org_id, (member,) = await _org_and_members(
            db_session, statuses=(member_status,)
        )

        result = await self._process(db_session, org_id, member)

        # The made-up item is what stops it, so the member check passed.
        assert result == {"success": False, "error": "Item is not in this organization"}
