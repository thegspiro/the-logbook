"""
Tests for the member delete and position-assignment endpoints.

Both endpoints used to clear ``user_positions`` with a hand-written DELETE
while SQLAlchemy still held the collection loaded, which made the following
flush raise StaleDataError ("expected to delete 2 row(s); Only 0 were
matched") — and, on the assignment path, silently drop positions that were
meant to be kept. These tests pin the statement counts so neither raw DELETE
can come back. The session and its collaborators are mocked, so the suite
needs no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import users as users_endpoint
from app.models.user import UserStatus


def _result(scalar_one=None, scalars_all=None):
    r = MagicMock()
    r.scalar_one_or_none.return_value = scalar_one
    r.scalars.return_value.all.return_value = scalars_all or []
    return r


def _db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.delete = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _member(**kw):
    return SimpleNamespace(
        id=kw.get("id", str(uuid4())),
        username=kw.get("username", "jsmith"),
        full_name=kw.get("full_name", "Jane Smith"),
        organization_id=kw.get("organization_id", "org-1"),
        rank=kw.get("rank"),
        status=kw.get("status", UserStatus.ACTIVE),
        roles=kw.get("roles", []),
        membership_number=kw.get("membership_number"),
        previous_membership_number=None,
        deleted_at=None,
    )


@pytest.fixture(autouse=True)
def _quiet_collaborators(monkeypatch):
    """Neutralise audit logging and the administrator-continuity guards."""
    monkeypatch.setattr(users_endpoint, "log_audit_event", AsyncMock())
    monkeypatch.setattr(users_endpoint, "assert_not_last_administrator", AsyncMock())
    monkeypatch.setattr(
        users_endpoint, "assert_positions_retain_administrator", AsyncMock()
    )


class TestDeleteUserHard:
    @pytest.fixture(autouse=True)
    def _no_blocking_references(self, monkeypatch):
        monkeypatch.setattr(
            users_endpoint, "find_hard_delete_blockers", AsyncMock(return_value=[])
        )
        monkeypatch.setattr(
            users_endpoint, "release_user_references", AsyncMock(return_value=0)
        )

    async def test_leaves_user_positions_to_the_orm(self):
        """
        The only statement the endpoint issues itself is the member lookup:
        deleting the User is what removes its user_positions rows. Issuing a
        separate DELETE would leave the loaded collection stale and raise
        StaleDataError at flush.
        """
        target = _member()
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=True, db=db, current_user=_member(id="admin-1")
        )

        assert db.execute.await_count == 1
        db.delete.assert_awaited_once_with(target)
        db.commit.assert_awaited_once()

    async def test_clears_restricted_references_before_deleting(self, monkeypatch):
        release = AsyncMock(return_value=4)
        monkeypatch.setattr(users_endpoint, "release_user_references", release)
        target = _member()
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=True, db=db, current_user=_member(id="admin-1")
        )

        release.assert_awaited_once_with(db, str(target.id))

    async def test_refuses_when_records_must_keep_an_owner(self, monkeypatch):
        monkeypatch.setattr(
            users_endpoint,
            "find_hard_delete_blockers",
            AsyncMock(return_value=[("purchase_requests", 2)]),
        )
        target = _member()
        db = _db(_result(scalar_one=target))

        with pytest.raises(HTTPException) as exc:
            await users_endpoint.delete_user(
                user_id=target.id, hard=True, db=db, current_user=_member(id="admin-1")
            )

        assert exc.value.status_code == 409
        assert "2 purchase requests" in exc.value.detail
        assert "anonymize" in exc.value.detail
        db.delete.assert_not_awaited()

    async def test_rejects_self_deletion(self):
        admin = _member(id="admin-1")
        db = _db()

        with pytest.raises(HTTPException) as exc:
            await users_endpoint.delete_user(
                user_id=admin.id, hard=True, db=db, current_user=admin
            )

        assert exc.value.status_code == 400

    async def test_missing_member_is_a_404(self):
        db = _db(_result(scalar_one=None))

        with pytest.raises(HTTPException) as exc:
            await users_endpoint.delete_user(
                user_id=str(uuid4()),
                hard=True,
                db=db,
                current_user=_member(id="admin-1"),
            )

        assert exc.value.status_code == 404


class TestDeleteUserSoft:
    async def test_frees_the_membership_number_but_remembers_it(self):
        target = _member(membership_number="42")
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=False, db=db, current_user=_member(id="admin-1")
        )

        assert target.previous_membership_number == "42"
        assert target.membership_number is None
        assert target.deleted_at is not None
        db.delete.assert_not_awaited()


class TestAssignUserRoles:
    async def test_replaces_positions_through_the_orm_collection(self, monkeypatch):
        """
        Assigning the collection is the whole operation. A hand-written DELETE
        on user_positions beforehand would hide retained positions from
        SQLAlchemy's diff, so their rows would never be re-inserted.
        """
        monkeypatch.setattr(users_endpoint, "_enforce_role_grant_ceiling", AsyncMock())
        monkeypatch.setattr(users_endpoint, "get_client_ip", lambda request: "1.2.3.4")

        kept = SimpleNamespace(id="role-kept", permissions=[], slug="member")
        added = SimpleNamespace(id="role-added", permissions=[], slug="treasurer")
        target = _member(roles=[kept, SimpleNamespace(id="role-dropped")])
        db = _db(
            _result(scalar_one=target),
            _result(scalars_all=[kept, added]),
            _result(scalar_one=target),
        )

        response = await users_endpoint.assign_user_roles(
            user_id=target.id,
            role_assignment=SimpleNamespace(role_ids=["role-kept", "role-added"]),
            request=MagicMock(),
            db=db,
            current_user=_member(id="admin-1"),
        )

        # Lookup, role validation, and the post-commit re-query — nothing else.
        assert db.execute.await_count == 3
        assert target.roles == [kept, added]
        assert response["roles"] == [kept, added]
