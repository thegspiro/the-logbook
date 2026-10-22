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
        display_name=kw.get("display_name", kw.get("full_name", "Jane Smith")),
        organization_id=kw.get("organization_id", "org-1"),
        rank=kw.get("rank"),
        status=kw.get("status", UserStatus.ACTIVE),
        roles=kw.get("roles", []),
        positions=kw.get("positions", []),
        membership_number=kw.get("membership_number"),
        previous_membership_number=None,
        deleted_at=None,
    )


@pytest.fixture(autouse=True)
def _quiet_collaborators(monkeypatch):
    """Neutralise audit logging, the administrator-continuity guards, and the
    inventory return / shift release side effects (each has its own
    database-backed tests)."""
    monkeypatch.setattr(users_endpoint, "log_audit_event", AsyncMock())
    monkeypatch.setattr(users_endpoint, "assert_not_last_administrator", AsyncMock())
    monkeypatch.setattr(
        users_endpoint, "assert_positions_retain_administrator", AsyncMock()
    )
    monkeypatch.setattr(
        users_endpoint,
        "return_member_inventory",
        AsyncMock(
            return_value=SimpleNamespace(unassigned=0, pool_returns=0, checked_in=0)
        ),
    )
    monkeypatch.setattr(users_endpoint, "release_future_shift_commitments", AsyncMock())


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

    async def test_returns_held_inventory_before_deleting(self, monkeypatch):
        """Gear goes back to stock in the delete's own transaction, before the
        holding rows CASCADE away with the member."""
        order: list[str] = []
        returned = AsyncMock(
            side_effect=lambda *a, **k: order.append("return")
            or SimpleNamespace(unassigned=1, pool_returns=2, checked_in=0)
        )
        monkeypatch.setattr(users_endpoint, "return_member_inventory", returned)
        target = _member()
        db = _db(_result(scalar_one=target))
        db.delete = AsyncMock(side_effect=lambda *_: order.append("delete"))
        db.commit = AsyncMock(side_effect=lambda: order.append("commit"))

        await users_endpoint.delete_user(
            user_id=target.id, hard=True, db=db, current_user=_member(id="admin-1")
        )

        returned.assert_awaited_once_with(
            db, str(target.id), "org-1", performed_by="admin-1"
        )
        assert order == ["return", "delete", "commit"]

    async def test_hard_delete_does_not_run_the_shift_release(self):
        """The member's assignments CASCADE with them; there is nothing to
        hand back through the roster."""
        target = _member()
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=True, db=db, current_user=_member(id="admin-1")
        )

        users_endpoint.release_future_shift_commitments.assert_not_awaited()

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
        assert "purchase requests" not in exc.value.detail
        assert "2" not in exc.value.detail
        assert "must retain an owner" in exc.value.detail
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

    async def test_releases_future_shifts_after_committing(self):
        target = _member()
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=False, db=db, current_user=_member(id="admin-1")
        )

        release = users_endpoint.release_future_shift_commitments
        release.assert_awaited_once()
        assert release.await_args.kwargs["user_id"] == str(target.id)
        assert release.await_args.kwargs["organization_id"] == "org-1"
        assert release.await_args.kwargs["reason"] == "soft_deleted"
        db.commit.assert_awaited_once()


def _position(*permissions):
    return SimpleNamespace(permissions=list(permissions))


class TestDeleteUserPrivilegeCeiling:
    """A member manager may not delete an account holding permissions they
    lack — the same ceiling password and MFA resets apply."""

    @pytest.fixture(autouse=True)
    def _no_blocking_references(self, monkeypatch):
        monkeypatch.setattr(
            users_endpoint, "find_hard_delete_blockers", AsyncMock(return_value=[])
        )
        monkeypatch.setattr(
            users_endpoint, "release_user_references", AsyncMock(return_value=0)
        )

    @pytest.mark.parametrize("hard", [False, True])
    async def test_refuses_a_more_privileged_member(self, monkeypatch, hard):
        report = AsyncMock()
        monkeypatch.setattr(
            users_endpoint, "report_privilege_escalation_attempt", report
        )
        target = _member(positions=[_position("members.manage", "settings.manage")])
        caller = _member(id="secretary-1", positions=[_position("members.manage")])
        db = _db(_result(scalar_one=target))

        with pytest.raises(HTTPException) as exc:
            await users_endpoint.delete_user(
                user_id=target.id, hard=hard, db=db, current_user=caller
            )

        assert exc.value.status_code == 403
        assert "privileges beyond your own" in exc.value.detail
        report.assert_awaited_once()
        assert report.await_args.args[2] == f"member-delete:{target.id}"
        assert target.deleted_at is None
        db.delete.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_allows_a_member_within_the_callers_permissions(self):
        target = _member(positions=[_position("events.view")])
        caller = _member(
            id="secretary-1", positions=[_position("members.manage", "events.view")]
        )
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=False, db=db, current_user=caller
        )

        assert target.deleted_at is not None

    async def test_wildcard_administrator_may_delete_anyone(self):
        target = _member(positions=[_position("members.manage", "security.manage")])
        caller = _member(id="owner-1", positions=[_position("*")])
        db = _db(_result(scalar_one=target))

        await users_endpoint.delete_user(
            user_id=target.id, hard=False, db=db, current_user=caller
        )

        assert target.deleted_at is not None


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
        target = _member(
            roles=[kept, SimpleNamespace(id="role-dropped", slug="driver")]
        )
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

    async def test_only_added_positions_are_held_to_the_ceiling(self, monkeypatch):
        """
        The call replaces the whole set, so the list repeats positions the
        member already holds. Checking those refused a coordinator adding a
        position to the Chief -- and raised a CRITICAL escalation alert --
        because the Chief's own position was still in the list.
        """
        ceiling = AsyncMock()
        monkeypatch.setattr(users_endpoint, "_enforce_role_grant_ceiling", ceiling)
        monkeypatch.setattr(users_endpoint, "get_client_ip", lambda request: "1.2.3.4")

        chief = SimpleNamespace(id="role-chief", permissions=["*"], slug="chief")
        driver = SimpleNamespace(id="role-driver", permissions=[], slug="driver")
        target = _member(roles=[chief])
        db = _db(
            _result(scalar_one=target),
            _result(scalars_all=[chief, driver]),
            _result(scalar_one=target),
        )

        await users_endpoint.assign_user_roles(
            user_id=target.id,
            role_assignment=SimpleNamespace(role_ids=["role-chief", "role-driver"]),
            request=MagicMock(),
            db=db,
            current_user=_member(id="coordinator-1"),
        )

        checked = ceiling.await_args.args[1]
        assert checked == [driver]
