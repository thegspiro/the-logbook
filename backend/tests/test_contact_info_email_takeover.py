"""Changing a colleague's email on PATCH /users/{id}/contact-info.

Forgot-password resolves the account by its email address, so whoever sets a
colleague's email can mail themselves that colleague's reset link. Before this
fix a ``members.manage`` holder (Secretary, Membership Coordinator) could point
the Chief's ``*`` account at their own inbox in one request and reset its
password in the next. A colleague's email change now takes the account-reset
ceiling and step-up that the password, MFA and passkey resets already take, is
audited at warning with both values, and notifies the address being replaced.

DB, audit and notification are mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.v1.endpoints.users import update_contact_info
from app.schemas.user import ContactInfoUpdate

pytestmark = pytest.mark.unit

_USERS = "app.api.v1.endpoints.users"


def _person(user_id, permissions, email):
    return SimpleNamespace(
        id=str(user_id),
        username=f"user-{user_id}",
        organization_id="org-1",
        email=email,
        email_verified=True,
        phone="555-0100",
        mobile="555-0101",
        notification_preferences={},
        rank=None,
        positions=[SimpleNamespace(permissions=permissions)],
        roles=[],
    )


def _result(row):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=row))


def _db(target, payload):
    # The handler's reads, in order: the target, the duplicate-email check (only
    # when an email is sent), then the re-read after commit.
    reads = [_result(target)]
    if "email" in payload:
        reads.append(_result(None))
    reads.append(_result(target))
    db = MagicMock()
    db.execute = AsyncMock(side_effect=reads)
    db.commit = AsyncMock()
    return db


async def _save(caller, target, payload, *, stepup=None):
    db = _db(target, payload)
    audit = AsyncMock()
    notify = AsyncMock()
    ensure = stepup if stepup is not None else AsyncMock()
    with (
        patch(f"{_USERS}.log_audit_event", new=audit),
        patch(f"{_USERS}.notify_security_event", new=notify),
        patch(f"{_USERS}.ensure_stepup", new=ensure),
        patch(f"{_USERS}.report_privilege_escalation_attempt", new=AsyncMock()),
    ):
        await update_contact_info(
            target.id,
            ContactInfoUpdate.model_validate(payload),
            BackgroundTasks(),
            db=db,
            current_user=caller,
        )
    return SimpleNamespace(db=db, audit=audit, notify=notify, stepup=ensure)


class TestColleagueEmailChange:
    async def test_a_secretary_cannot_repoint_the_chiefs_email(self):
        secretary = _person(uuid4(), ["members.manage"], "sec@fd.example")
        chief = _person(uuid4(), ["*"], "chief@fd.example")

        with pytest.raises(HTTPException) as exc:
            await _save(secretary, chief, {"email": "attacker@evil.example"})

        assert exc.value.status_code == 403
        assert chief.email == "chief@fd.example"
        assert chief.email_verified is True

    async def test_within_the_ceiling_it_still_requires_step_up(self):
        coordinator = _person(
            uuid4(), ["members.manage", "members.view"], "mc@fd.example"
        )
        member = _person(uuid4(), ["members.view"], "m@fd.example")
        refusal = AsyncMock(side_effect=HTTPException(status_code=403))

        with pytest.raises(HTTPException):
            await _save(
                coordinator, member, {"email": "new@fd.example"}, stepup=refusal
            )

        refusal.assert_awaited_once()
        assert member.email == "m@fd.example"

    async def test_an_allowed_change_is_audited_and_tells_the_old_address(self):
        coordinator = _person(
            uuid4(), ["members.manage", "members.view"], "mc@fd.example"
        )
        member = _person(uuid4(), ["members.view"], "m@fd.example")

        result = await _save(coordinator, member, {"email": "new@fd.example"})

        assert member.email == "new@fd.example"
        result.stepup.assert_awaited_once()
        audit_kwargs = result.audit.await_args.kwargs
        assert audit_kwargs["severity"] == "warning"
        assert audit_kwargs["event_data"]["email_changed"] == {
            "from": "m@fd.example",
            "to": "new@fd.example",
        }
        result.notify.assert_awaited_once()
        assert result.notify.await_args.kwargs["to_email"] == "m@fd.example"

    async def test_a_phone_only_edit_does_not_ask_for_step_up(self):
        coordinator = _person(
            uuid4(), ["members.manage", "members.view"], "mc@fd.example"
        )
        member = _person(uuid4(), ["members.view"], "m@fd.example")

        result = await _save(coordinator, member, {"phone": "555-0199"})

        result.stepup.assert_not_awaited()
        result.notify.assert_not_awaited()
        assert result.audit.await_args.kwargs["severity"] == "info"

    async def test_resending_the_same_email_is_not_a_change(self):
        coordinator = _person(
            uuid4(), ["members.manage", "members.view"], "mc@fd.example"
        )
        member = _person(uuid4(), ["*"], "m@fd.example")

        result = await _save(coordinator, member, {"email": "m@fd.example"})

        result.stepup.assert_not_awaited()
        result.notify.assert_not_awaited()


class TestOwnEmailChange:
    async def test_no_step_up_but_the_old_address_is_told(self):
        member = _person(uuid4(), ["members.view"], "m@fd.example")

        result = await _save(member, member, {"email": "mine@fd.example"})

        assert member.email == "mine@fd.example"
        assert member.email_verified is False
        result.stepup.assert_not_awaited()
        assert result.notify.await_args.kwargs["to_email"] == "m@fd.example"
        assert result.audit.await_args.kwargs["severity"] == "info"
