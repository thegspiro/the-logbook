"""Public event-request intake gates (EV-5).

`POST /event-requests/public` writes rows and emails a coordinator, and it
takes the organization from a query parameter — organization ids are
discoverable through the public calendar, so before these gates every active
department was reachable by anyone who looked one up. Its only protection was
a per-IP limit of 10.

These cover the four gates that closed it: the per-organization opt-in, the
honeypot, the valid-only daily cap, and the ordering between them. The human
challenge is a route dependency and is covered by `test_captcha.py`.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.event_requests import submit_public_event_request
from app.schemas.event_request import EventRequestCreate

ORG_ID = "00000000-0000-0000-0000-000000000001"


def _org(pipeline_overrides=None):
    """An active organization whose stored settings carry the overrides."""
    request_pipeline = dict(pipeline_overrides or {})
    return SimpleNamespace(
        id=ORG_ID,
        name="Oakville Fire Department",
        active=True,
        settings={"events": {"request_pipeline": request_pipeline}},
    )


def _db(org):
    """A db whose first execute() resolves the organization lookup."""
    db = AsyncMock()
    result = SimpleNamespace(scalar_one_or_none=lambda: org)
    db.execute.return_value = result
    # `add` is synchronous on a Session; leaving it an AsyncMock returns a
    # coroutine nobody awaits and buries a RuntimeWarning in the run.
    db.add = MagicMock()
    return db


def _request():
    return SimpleNamespace(
        headers={},
        client=SimpleNamespace(host="203.0.113.4"),
        state=SimpleNamespace(),
    )


def _payload(**overrides):
    data = {
        "contact_name": "Dana Reyes",
        "contact_email": "dana@example.org",
        "outreach_type": "fire_safety_demo",
        "description": "Fire safety talk for a third grade class of about 25.",
    }
    data.update(overrides)
    return EventRequestCreate(**data)


async def _submit(org, data=None, *, cap_exceeded=False):
    with (
        patch(
            "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
            AsyncMock(return_value=(True, 1, 10)),
        ),
        patch(
            "app.api.v1.endpoints.event_requests.daily_cap_exceeded",
            AsyncMock(return_value=cap_exceeded),
        ) as cap,
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        response = await submit_public_event_request(
            data=data or _payload(),
            request=_request(),
            organization_id=ORG_ID,
            db=_db(org),
        )
    return response, cap


@pytest.mark.asyncio
async def test_intake_is_closed_until_the_organization_opts_in():
    """A department that never configured outreach accepts nothing."""
    with pytest.raises(HTTPException) as exc:
        await _submit(_org())

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_closed_intake_is_indistinguishable_from_a_missing_organization():
    """The refusal must not confirm the organization exists.

    A distinguishable response turns this endpoint into an oracle for "which
    departments accept public requests" — the reconnaissance step before the
    flood the opt-in exists to stop.
    """
    with pytest.raises(HTTPException) as closed:
        await _submit(_org({"accept_public_requests": False}))

    db = AsyncMock()
    db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: None)
    db.add = MagicMock()
    with (
        patch(
            "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
            AsyncMock(return_value=(True, 1, 10)),
        ),
        pytest.raises(HTTPException) as missing,
    ):
        await submit_public_event_request(
            data=_payload(),
            request=_request(),
            organization_id=ORG_ID,
            db=db,
        )

    assert closed.value.status_code == missing.value.status_code == 404
    assert closed.value.detail == missing.value.detail


@pytest.mark.asyncio
async def test_honeypot_submission_is_accepted_looking_but_writes_nothing():
    """A bot gets the success shape and no record, so it has nothing to tune."""
    org = _org({"accept_public_requests": True})
    db = _db(org)

    with (
        patch(
            "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
            AsyncMock(return_value=(True, 1, 10)),
        ),
        patch(
            "app.api.v1.endpoints.event_requests.daily_cap_exceeded",
            AsyncMock(return_value=False),
        ) as cap,
    ):
        response = await submit_public_event_request(
            data=_payload(website="http://spam.example"),
            request=_request(),
            organization_id=ORG_ID,
            db=db,
        )

    assert response["id"] is None
    assert response["status"] == "submitted"
    db.add.assert_not_called()
    # The bot must not spend the department's daily allowance either — that is
    # exactly how anonymous traffic locked legitimate submitters out of the
    # forms module before the cap was moved behind validation.
    cap.assert_not_awaited()


@pytest.mark.asyncio
async def test_daily_cap_refuses_once_the_department_ceiling_is_spent():
    org = _org({"accept_public_requests": True, "public_daily_limit": 3})

    with pytest.raises(HTTPException) as exc:
        await _submit(org, cap_exceeded=True)

    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_daily_cap_is_scoped_per_organization_and_uses_the_configured_limit():
    org = _org({"accept_public_requests": True, "public_daily_limit": 7})

    _response, cap = await _submit(org)

    cap.assert_awaited_once_with(f"pub_event_request:{ORG_ID}", 7)


@pytest.mark.asyncio
async def test_an_opted_in_department_still_accepts_a_real_request():
    """The gates must not close the workflow they are protecting."""
    org = _org({"accept_public_requests": True})
    db = _db(org)

    with (
        patch(
            "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
            AsyncMock(return_value=(True, 1, 10)),
        ),
        patch(
            "app.api.v1.endpoints.event_requests.daily_cap_exceeded",
            AsyncMock(return_value=False),
        ),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        await submit_public_event_request(
            data=_payload(),
            request=_request(),
            organization_id=ORG_ID,
            db=db,
        )

    assert db.add.called, "an opted-in department should still record the request"
