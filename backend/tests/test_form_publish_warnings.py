"""What the Forms screen's publish confirmation warns about.

Publishing a public request form warns while public intake is turned off.

Owner decision (outreach-publish-toggle): warn on publish when
``events.request_pipeline.accept_public_requests`` is off. A public form that
files event requests stores each submission and files no request in that
state, so ``GET /forms/{id}/publish-warnings`` names it for the Forms screen's
publish confirmation. The condition mirrors what ``_process_event_request``
refuses on.

A form that feeds any integration also warns when it has fields marked
Sensitive: integrations read only the plain answers, so those answers reach no
other module.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.models.forms import IntegrationType
from app.services.forms_service import FormsService

pytestmark = pytest.mark.unit


def _form(*, is_public=True, marker=IntegrationType.EVENT_REQUEST, rows=(), fields=()):
    return SimpleNamespace(
        id=str(uuid4()),
        is_public=is_public,
        integration_type=marker,
        integrations=list(rows),
        fields=list(fields),
    )


def _field(label, sensitive=False):
    return SimpleNamespace(label=label, is_sensitive=sensitive)


def _row(active=True, kind=IntegrationType.EVENT_REQUEST):
    return SimpleNamespace(integration_type=kind, is_active=active)


def _org(accept):
    return SimpleNamespace(
        settings={"events": {"request_pipeline": {"accept_public_requests": accept}}}
    )


async def _warnings(form, org):
    db = AsyncMock()
    db.scalar.return_value = org
    service = FormsService(db)
    with patch.object(service, "get_form_by_id", AsyncMock(return_value=form)):
        return await service.get_publish_warnings(uuid4(), uuid4())


async def test_warns_for_a_public_request_form_while_intake_is_off():
    warnings = await _warnings(_form(rows=[_row()]), _org(False))

    assert [w["code"] for w in warnings] == ["public_intake_off"]
    assert "file no requests" in warnings[0]["message"]


async def test_the_default_setting_is_off_and_warns():
    warnings = await _warnings(_form(), SimpleNamespace(settings={}))

    assert [w["code"] for w in warnings] == ["public_intake_off"]


async def test_no_warning_once_intake_is_on():
    assert await _warnings(_form(rows=[_row()]), _org(True)) == []


async def test_no_warning_for_a_form_that_is_not_public():
    assert await _warnings(_form(is_public=False), _org(False)) == []


async def test_no_warning_when_every_request_row_is_switched_off():
    form = _form(rows=[_row(active=False)])

    assert await _warnings(form, _org(False)) == []


async def test_an_active_legacy_row_alone_counts():
    form = _form(marker=None, rows=[_row()])

    assert [w["code"] for w in await _warnings(form, _org(False))] == [
        "public_intake_off"
    ]


async def test_another_integration_does_not_warn():
    form = _form(
        marker=IntegrationType.MEMBERSHIP_INTEREST,
        rows=[_row(kind=IntegrationType.MEMBERSHIP_INTEREST)],
    )

    assert await _warnings(form, _org(False)) == []


async def test_a_form_outside_the_org_is_none():
    db = AsyncMock()
    service = FormsService(db)
    with patch.object(service, "get_form_by_id", AsyncMock(return_value=None)):
        assert await service.get_publish_warnings(uuid4(), uuid4()) is None


async def test_sensitive_fields_on_an_integrated_form_warn_by_label():
    form = _form(
        is_public=False,
        marker=IntegrationType.MEMBERSHIP_INTEREST,
        fields=[_field("Email"), _field("Criminal history", sensitive=True)],
    )

    warnings = await _warnings(form, _org(True))

    assert [w["code"] for w in warnings] == ["sensitive_not_integrated"]
    assert "Criminal history" in warnings[0]["message"]
    assert "Email" not in warnings[0]["message"]


async def test_sensitive_fields_without_an_integration_do_not_warn():
    form = _form(marker=None, fields=[_field("Criminal history", sensitive=True)])

    assert await _warnings(form, _org(False)) == []


async def test_an_inactive_legacy_row_alone_is_no_integration():
    form = _form(
        marker=None,
        rows=[_row(active=False, kind=IntegrationType.MEMBERSHIP_INTEREST)],
        fields=[_field("Criminal history", sensitive=True)],
    )

    assert await _warnings(form, _org(False)) == []


async def test_both_warnings_are_reported_together():
    form = _form(rows=[_row()], fields=[_field("Medical history", sensitive=True)])

    assert [w["code"] for w in await _warnings(form, _org(False))] == [
        "sensitive_not_integrated",
        "public_intake_off",
    ]
