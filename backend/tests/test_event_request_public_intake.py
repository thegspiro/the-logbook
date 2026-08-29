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

from datetime import datetime, timedelta, timezone
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


class TestRequestPipelineSettingsAreSettable:
    """The intake gate is only real if an administrator can reach the switch.

    EV-5 added ``accept_public_requests`` and ``public_daily_limit`` to
    ``EVENT_SETTINGS_DEFAULTS`` and gated the public endpoint on them, but never
    declared them on ``RequestPipelineUpdate``. Pydantic drops undeclared fields
    silently, so ``PATCH /events/settings`` deep-merged an empty dict: the write
    never happened and the caller got a ``200``.

    Public intake could therefore not be turned on at all. The settings screen's
    toggle read the unchanged response back and announced the form was "now
    closed" — the failure looked like a working control that the administrator
    kept mis-clicking.
    """

    def test_every_default_key_is_settable(self):
        """A structural check, because the field-by-field version only catches
        the two keys we already know about. Anything added to the defaults from
        now on has to be declared here too, or it is stored-but-unwritable."""
        from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS
        from app.schemas.event import RequestPipelineUpdate

        defaults = set(EVENT_SETTINGS_DEFAULTS["request_pipeline"])
        settable = set(RequestPipelineUpdate.model_fields)

        assert not defaults - settable, (
            "request_pipeline keys with no field on RequestPipelineUpdate: "
            f"{sorted(defaults - settable)}. Pydantic drops them silently, so "
            "PATCH /events/settings returns 200 and writes nothing."
        )

    def test_the_two_ev5_keys_survive_validation(self):
        from app.schemas.event import RequestPipelineUpdate

        parsed = RequestPipelineUpdate.model_validate(
            {"accept_public_requests": True, "public_daily_limit": 25}
        ).model_dump(exclude_unset=True)

        assert parsed == {"accept_public_requests": True, "public_daily_limit": 25}

    def test_a_zero_daily_limit_is_refused(self):
        """Zero would accept nothing while the intake toggle still read as open
        — a confusing way to spell what ``accept_public_requests: false`` says
        plainly."""
        import pytest
        from pydantic import ValidationError

        from app.schemas.event import RequestPipelineUpdate

        with pytest.raises(ValidationError):
            RequestPipelineUpdate.model_validate({"public_daily_limit": 0})


class TestRejectedTrafficCannotSpendTheDailyCap:
    """EV-19: every rejection path belongs above ``daily_cap_exceeded``.

    ``daily_cap_exceeded`` is an atomic Redis ``INCR`` — *asking* the question
    spends a slot. The lead-time check used to run after it, so a distributed
    caller posting too-soon dates could exhaust a department's whole daily
    allowance with requests that were never going to be stored, denying the
    legitimate submitters the cap exists to protect.
    """

    @staticmethod
    def _too_soon_payload():
        return _payload(
            date_flexibility="specific_dates",
            preferred_date_start=datetime.now(timezone.utc) + timedelta(days=2),
        )

    @pytest.mark.asyncio
    async def test_a_too_soon_date_is_refused_without_touching_the_counter(self):
        org = _org(
            {
                "accept_public_requests": True,
                "min_lead_time_days": 21,
                "public_daily_limit": 5,
            }
        )

        with (
            patch(
                "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
                AsyncMock(return_value=(True, 1, 10)),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.daily_cap_exceeded",
                AsyncMock(return_value=False),
            ) as cap,
            pytest.raises(HTTPException) as exc,
        ):
            await submit_public_event_request(
                data=self._too_soon_payload(),
                request=_request(),
                organization_id=ORG_ID,
                db=_db(org),
            )

        assert exc.value.status_code == 400
        cap.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_flood_of_too_soon_dates_leaves_the_cap_unspent(self):
        """More attempts than the ceiling, and the counter is never consulted."""
        limit = 3
        org = _org(
            {
                "accept_public_requests": True,
                "min_lead_time_days": 21,
                "public_daily_limit": limit,
            }
        )

        with (
            patch(
                "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
                AsyncMock(return_value=(True, 1, 10)),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.daily_cap_exceeded",
                AsyncMock(return_value=False),
            ) as cap,
            patch(
                "app.api.v1.endpoints.event_requests._send_request_notification",
                AsyncMock(),
            ),
        ):
            for _ in range(limit * 2):
                with pytest.raises(HTTPException) as exc:
                    await submit_public_event_request(
                        data=self._too_soon_payload(),
                        request=_request(),
                        organization_id=ORG_ID,
                        db=_db(org),
                    )
                assert exc.value.status_code == 400

            cap.assert_not_awaited()

            # …and the department is still open to a legitimate submitter.
            db = _db(org)
            await submit_public_event_request(
                data=_payload(
                    date_flexibility="specific_dates",
                    preferred_date_start=(
                        datetime.now(timezone.utc) + timedelta(days=60)
                    ),
                ),
                request=_request(),
                organization_id=ORG_ID,
                db=db,
            )

        assert db.add.called
        cap.assert_awaited_once_with(f"pub_event_request:{ORG_ID}", limit)


class TestPublicSubmitControlOrdering:
    """EV-18: the cheap per-IP limiter must run before the CAPTCHA dependency.

    ``require_captcha`` makes an outbound provider request for every non-empty
    token. While the IP limiter lived in the handler body it necessarily ran
    *after* every declared dependency, so one IP could burn unlimited provider
    verifications. FastAPI resolves route ``dependencies`` in declaration
    order, which makes this list the enforcement order.
    """

    def test_the_ip_limiter_is_declared_before_require_captcha(self):
        from app.api.v1.endpoints.event_requests import router

        route = next(
            r
            for r in router.routes
            if getattr(r, "path", None) == "/event-requests/public"
            and "POST" in getattr(r, "methods", set())
        )
        names = [d.dependency.__name__ for d in route.dependencies]

        assert "_rate_limit_public_request" in names, (
            "the per-IP limiter must be a route dependency, not a call in the "
            "handler body — a body call runs after every dependency"
        )
        assert "require_captcha" in names
        assert names.index("_rate_limit_public_request") < names.index(
            "require_captcha"
        ), f"IP limiter must precede the CAPTCHA dependency, got {names}"
