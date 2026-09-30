"""Clearing a phone or mobile number on PATCH /users/{id}/contact-info.

The handler wrote each number only ``if ... is not None``, so an explicit null
could never clear one: the member emptied the box, saved, got a 200 and the old
number back. It now writes whatever the caller named, and a blank clears too.
DB and the audit log are mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.users import update_contact_info
from app.schemas.user import ContactInfoUpdate

pytestmark = pytest.mark.unit


def _member(user_id):
    return SimpleNamespace(
        id=str(user_id),
        username="jsmith",
        organization_id=str(uuid4()),
        email="member@fd.example",
        email_verified=True,
        phone="555-0100",
        mobile="555-0101",
        notification_preferences={},
    )


async def _save(payload):
    uid = uuid4()
    member = _member(uid)
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=member))
    )
    db.commit = AsyncMock()
    with patch("app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()):
        await update_contact_info(
            uid, ContactInfoUpdate.model_validate(payload), db, member
        )
    return member


async def test_an_explicit_null_clears_the_number():
    member = await _save({"phone": None, "mobile": None})

    assert (member.phone, member.mobile) == (None, None)


async def test_a_blank_clears_it_too():
    member = await _save({"mobile": "   "})

    assert member.mobile is None


async def test_an_omitted_number_is_left_alone():
    member = await _save({"mobile": "555-0199"})

    assert member.phone == "555-0100"
    assert member.mobile == "555-0199"
