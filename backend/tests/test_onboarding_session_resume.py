"""A setup whose session lapsed after step 1 must stay resumable.

Step 1 of the wizard creates the real Organization row. `get_or_create_session`
used to refuse to mint any further session once an organization existed, which
made a lapsed 30-minute session unrecoverable: /start returned 403, /reset
needed that same dead session to authenticate, and the System Owner who could
have logged in does not exist until a much later step. The only way out was
dropping the database.

The guard now keys on completion, and authority over an in-progress setup is
bounded by the System Owner instead -- the same boundary /reset applies.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.onboarding import (
    _rehydrate_department_org_id,
    _require_owner_authority,
    get_or_create_session,
)


def _request(session_id=None):
    req = MagicMock()
    req.headers = {"X-Session-ID": session_id} if session_id else {}
    return req


def _db(execute_results):
    """A db whose successive execute() calls return the given results."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=execute_results)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


def _result(value):
    res = MagicMock()
    res.scalar_one_or_none.return_value = value
    return res


def _scalars(values):
    res = MagicMock()
    res.scalars.return_value.all.return_value = values
    return res


def _user(user_id, permissions=None):
    positions = [SimpleNamespace(permissions=permissions)] if permissions else []
    return SimpleNamespace(id=user_id, positions=positions)


class TestSessionMintingKeysOnCompletion:
    async def test_mints_a_session_while_setup_is_still_in_progress(self):
        """The regression: an existing organization must not block the resume."""
        db = _db([_result(None)])  # the rehydration lookup finds no org id
        service = MagicMock()
        service.needs_onboarding = AsyncMock(return_value=True)

        with patch("app.api.v1.onboarding.OnboardingService", return_value=service):
            session = await get_or_create_session(_request(), db)

        assert session.session_id
        db.add.assert_called_once()

    async def test_refuses_once_onboarding_is_completed(self):
        db = _db([])
        service = MagicMock()
        service.needs_onboarding = AsyncMock(return_value=False)

        with patch("app.api.v1.onboarding.OnboardingService", return_value=service):
            with pytest.raises(HTTPException) as exc:
                await get_or_create_session(_request(), db)

        assert exc.value.status_code == 403
        assert "already been completed" in exc.value.detail


class TestDepartmentOrgIdRehydration:
    async def test_adopts_the_organization_an_earlier_session_created(self):
        """Without this, /session/stations rejects a setup whose org exists."""
        session = SimpleNamespace(data={})
        db = _db([_result("org-1")])

        await _rehydrate_department_org_id(session, db)

        assert session.data["department"]["organization_id"] == "org-1"
        db.commit.assert_awaited_once()

    async def test_leaves_an_already_populated_session_untouched(self):
        session = SimpleNamespace(
            data={"department": {"organization_id": "org-1", "name": "Engine Co."}}
        )
        db = _db([])

        await _rehydrate_department_org_id(session, db)

        assert session.data["department"]["name"] == "Engine Co."
        db.execute.assert_not_awaited()

    async def test_no_organization_yet_is_a_no_op(self):
        session = SimpleNamespace(data={})
        db = _db([_result(None)])

        await _rehydrate_department_org_id(session, db)

        assert session.data == {}

    async def test_preserves_other_session_keys(self):
        """The whole mapping is reassigned, so siblings must survive it."""
        session = SimpleNamespace(data={"csrf_token": "abc", "stations": {"count": 2}})
        db = _db([_result("org-1")])

        await _rehydrate_department_org_id(session, db)

        assert session.data["csrf_token"] == "abc"
        assert session.data["stations"] == {"count": 2}
        assert session.data["department"]["organization_id"] == "org-1"


class TestOwnerAuthority:
    async def test_open_before_any_owner_exists(self):
        """The wizard is unauthenticated by design up to owner creation."""
        db = _db([_scalars([])])
        await _require_owner_authority(db, None, "denied")

    async def test_anonymous_caller_refused_once_an_owner_exists(self):
        db = _db([_scalars([_user("owner-1", ["*"])])])

        with pytest.raises(HTTPException) as exc:
            await _require_owner_authority(db, None, "denied")

        assert exc.value.status_code == 403
        assert exc.value.detail == "denied"

    async def test_a_different_user_is_refused(self):
        db = _db([_scalars([_user("owner-1", ["*"]), _user("member-2")])])

        with pytest.raises(HTTPException) as exc:
            await _require_owner_authority(db, _user("member-2"), "denied")

        assert exc.value.status_code == 403

    async def test_the_owner_is_allowed(self):
        owner = _user("owner-1", ["*"])
        db = _db([_scalars([owner])])

        await _require_owner_authority(db, owner, "denied")

    async def test_fails_closed_when_users_exist_but_none_is_the_owner(self):
        """A damaged owner row must never promote an arbitrary first user."""
        db = _db([_scalars([_user("member-1"), _user("member-2")])])

        with pytest.raises(HTTPException) as exc:
            await _require_owner_authority(db, _user("member-1"), "denied")

        assert exc.value.status_code == 409
