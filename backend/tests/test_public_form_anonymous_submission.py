"""
Anonymous submission to a public form is governed by the form's own
``require_authentication`` setting.

A public form defaults to requiring a session, so a signed-out visitor at
``/f/<slug>`` was refused with a 401 — and until the Share dialog offered the
setting, no manager could turn that off. These drive the public submit
endpoint against real rows: the setting is flipped through
``FormsService.update_form`` (the path the Share dialog's checkbox takes), and
a signed-out submission is then accepted or refused on it.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.public.forms import submit_public_form
from app.models.forms import FieldType, Form, FormField, FormStatus, FormSubmission
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


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"s-{org_id[:8]}"},
    )
    return org_id


async def _public_form(db, org_id: str) -> Form:
    # Constructed without require_authentication so the model default — the
    # secure one, which this change deliberately keeps — is what applies.
    form = Form(
        id=_uid(),
        organization_id=org_id,
        name="Open House Sign-up",
        status=FormStatus.PUBLISHED,
        is_public=True,
    )
    db.add(form)
    db.add(
        FormField(
            id=_uid(),
            form_id=form.id,
            label="Name",
            field_type=FieldType.TEXT,
            required=True,
            sort_order=0,
        )
    )
    await db.flush()
    return form


@pytest.fixture(autouse=True)
def _no_daily_cap(monkeypatch):
    async def _never(*_args, **_kwargs):
        return False

    # The per-form daily cap is a Redis counter shared with every other test
    # run on this machine; it is not what these tests are about.
    monkeypatch.setattr("app.services.forms_service.daily_cap_exceeded", _never)


async def _submit(db, form: Form, current_user=None):
    field = form.fields[0]
    return await submit_public_form(
        slug=form.public_slug,
        submission=PublicFormSubmissionCreate(
            data={str(field.id): "Pat Visitor"},
            submitter_name="Pat Visitor",
        ),
        request=_request(),
        db=db,
        current_user=current_user,
    )


async def _submission_count(db, form: Form) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(FormSubmission)
            .where(FormSubmission.form_id == form.id)
        )
    ).scalar_one()


async def _reload(db, form: Form) -> Form:
    loaded = await FormsService(db).get_form_by_slug(form.public_slug)
    assert loaded is not None
    return loaded


async def test_signed_out_submission_is_refused_while_the_default_holds(db_session):
    org_id = await _org(db_session)
    form = await _reload(db_session, await _public_form(db_session, org_id))
    assert form.require_authentication is True

    with pytest.raises(HTTPException) as exc:
        await _submit(db_session, form)

    assert exc.value.status_code == 401
    assert await _submission_count(db_session, form) == 0


async def test_signed_out_submission_is_accepted_once_the_manager_allows_it(
    db_session,
):
    org_id = await _org(db_session)
    form = await _public_form(db_session, org_id)

    updated, error = await FormsService(db_session).update_form(
        form.id, org_id, {"require_authentication": False}
    )
    assert error is None
    assert updated.require_authentication is False

    form = await _reload(db_session, form)
    response = await _submit(db_session, form)

    assert response.form_name == "Open House Sign-up"
    rows = (
        (
            await db_session.execute(
                select(FormSubmission).where(FormSubmission.form_id == form.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].organization_id == org_id
    assert rows[0].submitted_by is None
    assert rows[0].is_public_submission is True


async def test_the_setting_cannot_be_flipped_from_another_organization(db_session):
    org_id = await _org(db_session)
    other_org = await _org(db_session)
    form = await _public_form(db_session, org_id)

    updated, error = await FormsService(db_session).update_form(
        form.id, other_org, {"require_authentication": False}
    )

    assert updated is None
    assert error == "Form not found"
    form = await _reload(db_session, form)
    assert form.require_authentication is True


async def test_forbidding_repeat_submissions_still_requires_a_session(db_session):
    # A no-repeat form needs a stable identity to enforce "once each", so
    # allowing anonymous submission does not reach it — the Share dialog says
    # so rather than offering a switch that would do nothing.
    org_id = await _org(db_session)
    form = await _public_form(db_session, org_id)
    await FormsService(db_session).update_form(
        form.id,
        org_id,
        {"require_authentication": False, "allow_multiple_submissions": False},
    )

    form = await _reload(db_session, form)
    with pytest.raises(HTTPException) as exc:
        await _submit(db_session, form)

    assert exc.value.status_code == 401
    assert await _submission_count(db_session, form) == 0
