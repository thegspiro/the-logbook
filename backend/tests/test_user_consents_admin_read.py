"""Staff-facing read of another member's consents
(GET /users/{user_id}/consents).

The endpoint exists so staff editing a member's notification preferences can
see whether SMS consent is on record — the SMS preference cannot switch texts
on without it. It is read-only on purpose: consent recorded by somebody other
than the member is not consent. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.users import get_user_consents, router

ORG = str(uuid4())
OTHER_ORG = str(uuid4())


def _user(user_id, org_id=ORG, permissions=()):
    return SimpleNamespace(
        id=str(user_id),
        organization_id=org_id,
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


def _db(found):
    """A db whose single by-id lookup returns *found* (None = no match)."""
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=found))
    )
    return db


def _patch_consents(items):
    from app.services.consent_service import ConsentService

    return patch.object(
        ConsentService, "list_for_user", new=AsyncMock(return_value=items)
    )


SMS_GRANTED = [
    {"consent_type": "sms_notifications", "granted": True, "updated_at": None}
]


class TestPermissionGating:
    async def test_a_member_may_read_their_own_consents_without_a_permission(self):
        uid = uuid4()
        caller = _user(uid)
        with _patch_consents(SMS_GRANTED):
            result = await get_user_consents(uid, caller, _db(caller))
        assert result == SMS_GRANTED

    async def test_a_plain_member_cannot_read_someone_elses(self):
        target = uuid4()
        with pytest.raises(HTTPException) as exc:
            await get_user_consents(target, _user(uuid4()), _db(_user(target)))
        assert exc.value.status_code == 403

    @pytest.mark.parametrize("permission", ["users.edit", "members.manage"])
    async def test_staff_with_an_edit_permission_may_read(self, permission):
        target = uuid4()
        caller = _user(uuid4(), permissions=[permission])
        with _patch_consents(SMS_GRANTED):
            result = await get_user_consents(target, caller, _db(_user(target)))
        assert result == SMS_GRANTED


class TestOrgScoping:
    async def test_a_permission_does_not_reach_into_another_org(self):
        # CLAUDE.md pitfall 14b: require_permission-style checks assert the
        # caller holds the permission in their OWN org. The lookup is org
        # scoped, so a member of another org is simply not found.
        target = uuid4()
        caller = _user(uuid4(), permissions=["members.manage"])
        with pytest.raises(HTTPException) as exc:
            await get_user_consents(target, caller, _db(None))
        assert exc.value.status_code == 404


class TestNoAdminWriteCounterpart:
    def test_consent_cannot_be_set_on_a_member_s_behalf(self):
        # TCPA consent has to come from the member. If a write route on this
        # path is ever added, this is the test that should stop it.
        writable = [
            route
            for route in router.routes
            if getattr(route, "path", None) == "/{user_id}/consents"
            and getattr(route, "methods", set()) & {"PUT", "POST", "PATCH", "DELETE"}
        ]
        assert writable == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
