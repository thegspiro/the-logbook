"""Authorization regression tests for member profile updates.

A colleague's profile and contact information are written by the member and by
``members.manage`` holders only. ``users.edit`` used to pass both gates too;
the profile page hid the forms from a ``users.edit`` holder, but the API still
accepted the write from anyone who called it directly.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.users import update_contact_info, update_user_profile
from app.schemas.user import ContactInfoUpdate, UserUpdate

pytestmark = [pytest.mark.unit]


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


def _caller(permissions, user_id=None):
    return SimpleNamespace(
        id=str(user_id or uuid4()),
        organization_id=str(uuid4()),
        username="caller",
        rank=None,
        positions=[SimpleNamespace(permissions=permissions)],
    )


class TestColleagueProfileWrite:
    @pytest.mark.parametrize(
        "permissions", [["users.edit"], ["users.edit", "users.view"]]
    )
    async def test_users_edit_without_members_manage_is_refused(self, permissions):
        caller = _caller(permissions)
        db = AsyncMock()
        db.execute.side_effect = [_Result(caller)]

        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                uuid4(), UserUpdate(first_name="Changed"), db, caller
            )

        assert exc.value.status_code == 403
        assert db.execute.await_count == 1  # the caller's own permissions only
        db.commit.assert_not_awaited()

    async def test_members_manage_passes_the_gate(self):
        caller = _caller(["members.manage"])
        db = AsyncMock()
        # Caller's permissions, then the target lookup. No target, so the
        # handler stops at 404 -- past the gate, before any write.
        db.execute.side_effect = [_Result(caller), _Result(None)]

        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                uuid4(), UserUpdate(first_name="Changed"), db, caller
            )

        assert exc.value.status_code == 404

    async def test_a_member_may_edit_their_own(self):
        caller = _caller([])
        db = AsyncMock()
        db.execute.side_effect = [_Result(None)]  # straight to the target lookup

        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                caller.id, UserUpdate(first_name="Changed"), db, caller
            )

        assert exc.value.status_code == 404


class TestMemberStatusTierLookupGate:
    """USR-14: an unrecognised ``member_status`` makes the org-tier lookup
    raise with the organization's own tier ids in its 400 detail, and that
    list is ``members.manage``-gated elsewhere (``get_membership_tier_config``).
    A self-update without the permission must be refused before reaching
    that lookup, not after."""

    async def test_unauthorized_self_update_is_refused_before_the_tier_lookup(self):
        caller = _caller([])
        db = AsyncMock()
        db.execute.side_effect = [_Result(caller)]

        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                caller.id, UserUpdate(member_status="made-up-tier"), db, caller
            )

        assert exc.value.status_code == 403
        # Only the permission lookup ran -- never the Organization tier
        # lookup `_accepted_member_status_or_400` would otherwise issue.
        assert db.execute.await_count == 1
        db.commit.assert_not_awaited()

    async def test_authorized_self_update_still_reaches_the_tier_lookup(self):
        caller = _caller(["members.manage"])
        organization = SimpleNamespace(
            settings={"membership_tiers": {"tiers": [{"id": "senior"}]}}
        )
        db = AsyncMock()
        db.execute.side_effect = [_Result(caller), _Result(organization)]

        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                caller.id, UserUpdate(member_status="made-up-tier"), db, caller
            )

        assert exc.value.status_code == 400
        assert "senior" in exc.value.detail


class TestColleagueContactInfoWrite:
    async def test_users_edit_without_members_manage_is_refused(self):
        caller = _caller(["users.edit", "users.view"])
        db = AsyncMock()

        with pytest.raises(HTTPException) as exc:
            await update_contact_info(
                uuid4(), ContactInfoUpdate(phone="555-0100"), db, caller
            )

        assert exc.value.status_code == 403
        db.execute.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_members_manage_passes_the_gate(self):
        caller = _caller(["members.manage"])
        db = AsyncMock()
        db.execute.side_effect = [_Result(None)]

        with pytest.raises(HTTPException) as exc:
            await update_contact_info(
                uuid4(), ContactInfoUpdate(phone="555-0100"), db, caller
            )

        assert exc.value.status_code == 404

    async def test_a_member_may_edit_their_own(self):
        caller = _caller([])
        db = AsyncMock()
        db.execute.side_effect = [_Result(None)]

        with pytest.raises(HTTPException) as exc:
            await update_contact_info(
                caller.id, ContactInfoUpdate(phone="555-0100"), db, caller
            )

        assert exc.value.status_code == 404


async def test_a_member_cannot_change_their_own_hire_date():
    """Tier-eligibility hire dates require members.manage, even on oneself."""
    member_id = uuid4()
    caller = _caller(["users.edit"], user_id=member_id)
    target = SimpleNamespace(id=str(member_id), rank=None, membership_number=None)
    db = AsyncMock()
    # Target lookup (a self-edit skips the colleague gate), then the
    # restricted-field check's own permission load.
    db.execute.side_effect = [_Result(target), _Result(caller)]

    with pytest.raises(HTTPException) as exc:
        await update_user_profile(
            member_id,
            UserUpdate(hire_date=date(1980, 1, 1)),
            db,
            caller,
        )

    assert exc.value.status_code == 403
    assert "hire date" in exc.value.detail
    db.commit.assert_not_awaited()
