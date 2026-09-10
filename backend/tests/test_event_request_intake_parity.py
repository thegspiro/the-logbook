"""The two public intake paths must be gated by the same settings.

``events.request_pipeline`` holds two controls over public intake:
``accept_public_requests`` (the department's opt-in) and ``public_daily_limit``
(its ceiling for a day). Both shipped read by ``POST /event-requests/public``
alone. The Forms path — the one Events settings' "Generate Event Request Form"
button builds, and the route the public actually uses — read neither, so a
department that turned the toggle off kept receiving requests through its own
published form and the ceiling could be walked around by using that form
instead. CLAUDE.md pitfall #19: a switch wired to nothing is worse than no
switch.

They gate *public* traffic only. A signed-in member submitting the same form
from inside the app is not the audience an opt-in for the open internet is
about, and a coordinator reprocessing an already-stored submission must never
be refused by a ceiling that submission already counted against — that would
make a legitimately-stored request permanently unrecoverable the moment a
department turns the toggle off.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.event_request import EventRequest
from app.models.forms import IntegrationType
from app.services.forms_service import FormsService

ORG_ID = "00000000-0000-0000-0000-000000000001"
SUBMISSION_ID = "00000000-0000-0000-0000-0000000000cc"


def _org(pipeline_overrides=None):
    return SimpleNamespace(
        id=ORG_ID,
        name="Oakville Fire Department",
        active=True,
        timezone="America/New_York",
        settings={"events": {"request_pipeline": dict(pipeline_overrides or {})}},
    )


def _submission():
    return SimpleNamespace(
        id=SUBMISSION_ID,
        organization_id=ORG_ID,
        data={
            "f_name": "Dana Reyes",
            "f_email": "dana@example.org",
            "f_type": "station_tour",
            "f_desc": "Station tour for a scout troop.",
        },
        ip_address="203.0.113.9",
    )


def _integration():
    return SimpleNamespace(
        integration_type=IntegrationType.EVENT_REQUEST,
        is_active=True,
        field_mappings={
            "f_name": "contact_name",
            "f_email": "contact_email",
            "f_type": "outreach_type",
            "f_desc": "description",
        },
    )


def _service(org):
    db = AsyncMock()
    db.add = MagicMock()
    db.scalar.side_effect = [org, None]
    db.execute.return_value = SimpleNamespace(first=lambda: ("Sam", "Ortiz"))
    return FormsService(db), db


def _requests_added(db):
    return [
        call.args[0]
        for call in db.add.call_args_list
        if isinstance(call.args[0], EventRequest)
    ]


async def _process(service, *, is_public, cap_exceeded=False):
    with (
        patch(
            "app.services.event_request_service.send_request_notification",
            AsyncMock(),
        ),
        patch(
            "app.services.forms_service.daily_cap_exceeded",
            AsyncMock(return_value=cap_exceeded),
        ) as cap,
    ):
        result = await service._process_event_request(
            _submission(),
            integration=_integration(),
            form=None,
            is_public=is_public,
        )
    return result, cap


# ============================================
# accept_public_requests — the department's opt-in
# ============================================


@pytest.mark.asyncio
async def test_public_form_submission_is_refused_when_intake_is_off():
    service, db = _service(_org({"accept_public_requests": False}))

    result, _ = await _process(service, is_public=True)

    assert result["success"] is False
    assert result["error"] == FormsService.EVENT_REQUEST_CLOSED_ERROR
    assert _requests_added(db) == []


@pytest.mark.asyncio
async def test_public_form_submission_is_accepted_when_intake_is_on():
    service, db = _service(_org({"accept_public_requests": True}))

    result, _ = await _process(service, is_public=True)

    assert result["success"] is True
    assert len(_requests_added(db)) == 1


@pytest.mark.asyncio
async def test_an_internal_submission_is_not_subject_to_the_public_opt_in():
    """A signed-in member using the department's own form is not the public."""
    service, db = _service(_org({"accept_public_requests": False}))

    result, cap = await _process(service, is_public=False)

    assert result["success"] is True
    assert len(_requests_added(db)) == 1
    # A reprocess must not spend an allowance slot either: `daily_cap_exceeded`
    # is an atomic INCR, so merely asking the question costs one.
    assert cap.await_count == 0


# ============================================
# public_daily_limit — the department's ceiling
# ============================================


@pytest.mark.asyncio
async def test_public_form_submission_is_refused_once_the_ceiling_is_spent():
    service, db = _service(_org({"accept_public_requests": True}))

    result, _ = await _process(service, is_public=True, cap_exceeded=True)

    assert result["success"] is False
    assert result["error"] == FormsService.EVENT_REQUEST_DAILY_CAP_ERROR
    assert _requests_added(db) == []


@pytest.mark.asyncio
async def test_the_ceiling_is_counted_under_the_same_key_as_the_json_endpoint():
    """Both paths spend one allowance, not one each."""
    service, _ = _service(
        _org({"accept_public_requests": True, "public_daily_limit": 7})
    )

    _, cap = await _process(service, is_public=True)

    assert cap.await_args.args == (f"pub_event_request:{ORG_ID}", 7)


@pytest.mark.asyncio
async def test_a_refused_submission_does_not_spend_the_ceiling():
    """Every rejection sits above the INCR (the EV-19 ordering).

    Counting a refusal would let traffic the department is not even accepting
    exhaust the allowance that exists to protect the submitters it is.
    """
    service, _ = _service(_org({"accept_public_requests": False}))

    _, cap = await _process(service, is_public=True)

    assert cap.await_count == 0
