"""The public request form's confirmation hands the requester their status link.

Owner decision, 2026-11-21, reversing the coordinator-shared posture of
2026-10-05 for the confirmation screen only. Driven through the real public
submit endpoint against real rows. Pinned:

* a submission that files an outreach request is answered with that request's
  status path, and with no other request's;
* the token is not written to the submission's ``integration_result``, which
  forms administrators can read;
* a form that files no request answers with no path.
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.public.forms import submit_public_form
from app.models.event_request import EventRequest
from app.models.forms import (
    FieldType,
    Form,
    FormField,
    FormStatus,
    FormSubmission,
    IntegrationType,
)
from app.schemas.forms import PublicFormSubmissionCreate
from app.services.forms_service import FormsService

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/public/v1/forms/x/submit",
            "headers": [(b"user-agent", b"pytest")],
            "client": ("203.0.113.9", 50000),
        }
    )


@pytest.fixture(autouse=True)
def _no_daily_cap(monkeypatch):
    async def _never(*_args, **_kwargs):
        return False

    monkeypatch.setattr("app.services.forms_service.daily_cap_exceeded", _never)


async def _org(db) -> str:
    org_id = _uid()
    settings = {"events": {"request_pipeline": {"accept_public_requests": True}}}
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {"id": org_id, "slug": f"s-{org_id[:8]}", "settings": json.dumps(settings)},
    )
    return org_id


async def _form(db, org_id: str, *, files_requests: bool) -> Form:
    form = Form(
        id=_uid(),
        organization_id=org_id,
        name="Request a Public Event",
        status=FormStatus.PUBLISHED,
        is_public=True,
        require_authentication=False,
        allow_multiple_submissions=True,
        integration_type=IntegrationType.EVENT_REQUEST if files_requests else None,
    )
    db.add(form)
    for order, label in enumerate(
        ("Your Name", "Email Address", "Type of Event", "Description")
    ):
        db.add(
            FormField(
                id=_uid(),
                form_id=form.id,
                label=label,
                field_type=FieldType.TEXT,
                required=False,
                sort_order=order,
            )
        )
    await db.flush()
    loaded = await FormsService(db).get_form_by_slug(form.public_slug)
    assert loaded is not None
    return loaded


async def _submit(db, form: Form):
    answers = {
        "Your Name": "Pat Rivera",
        "Email Address": "pat@example.org",
        "Type of Event": "station_tour",
        "Description": "A tour for our scout den of about twelve.",
    }
    data = {str(f.id): answers[f.label] for f in form.fields}
    with patch(
        "app.services.event_request_service.send_request_notification",
        AsyncMock(return_value=True),
    ):
        return await submit_public_form(
            slug=form.public_slug,
            submission=PublicFormSubmissionCreate(data=data),
            request=_request(),
            db=db,
            current_user=None,
        )


async def test_a_request_form_answers_with_its_own_status_path(db_session):
    org_id = await _org(db_session)
    form = await _form(db_session, org_id, files_requests=True)

    first = await _submit(db_session, form)
    second = await _submit(db_session, form)

    requests = {
        str(r.form_submission_id): r
        for r in (
            await db_session.execute(
                select(EventRequest).where(EventRequest.organization_id == org_id)
            )
        ).scalars()
    }
    for response in (first, second):
        request = requests[str(response.id)]
        assert response.event_request_status_path == (
            f"/event-request/status/{request.status_token}"
        )
    assert first.event_request_status_path != second.event_request_status_path


async def test_the_token_is_not_stored_on_the_submission(db_session):
    org_id = await _org(db_session)
    form = await _form(db_session, org_id, files_requests=True)

    response = await _submit(db_session, form)

    token = response.event_request_status_path.rsplit("/", 1)[-1]
    submission = await db_session.scalar(
        select(FormSubmission).where(FormSubmission.id == str(response.id))
    )
    assert token not in json.dumps(submission.integration_result or {})


async def test_a_form_that_files_no_request_answers_with_no_path(db_session):
    org_id = await _org(db_session)
    form = await _form(db_session, org_id, files_requests=False)

    response = await _submit(db_session, form)

    assert response.event_request_status_path is None
