"""
Tests for the role service permission helpers
(app/services/role_service.py).

Focus on the wildcard-aware permission checks: a user whose role grants a
module wildcard (e.g. ``training.*``) must be reported as having the concrete
action (``training.view``). Before centralizing on permission_matches these
service methods only honored the global ``*`` and exact matches, so they
disagreed with the HTTP enforcement layer. Also covers the slugify helper.
DB mocked; no MySQL.
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.permissions import permission_matches
from app.services.role_service import RoleManagementService, slugify


def _roles_result(roles):
    r = MagicMock()
    r.scalars.return_value.all.return_value = roles
    return r


def _db_with_roles(roles):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_roles_result(roles))
    return db


def _role(permissions):
    return SimpleNamespace(id="r1", name="R", priority=0, permissions=permissions)


class TestSlugify:
    def test_spaces_to_underscores(self):
        assert slugify("Training Officer") == "training_officer"

    def test_strips_and_collapses_punctuation(self):
        assert slugify("  Assistant / Chief!! ") == "assistant_chief"

    def test_already_slug(self):
        assert slugify("admin") == "admin"


class TestGetUserPermissions:
    async def test_unions_permissions_across_roles(self):
        db = _db_with_roles([_role(["users.view"]), _role(["events.*", "users.view"])])
        perms = await RoleManagementService().get_user_permissions(db, "u1")
        assert perms == {"users.view", "events.*"}

    async def test_handles_role_with_no_permissions(self):
        db = _db_with_roles([_role(None), _role(["a.b"])])
        perms = await RoleManagementService().get_user_permissions(db, "u1")
        assert perms == {"a.b"}


class TestUserHasPermission:
    async def test_module_wildcard_satisfies_action(self):
        db = _db_with_roles([_role(["training.*"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "training.view")
            is True
        )

    async def test_exact_match(self):
        db = _db_with_roles([_role(["training.view"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "training.view")
            is True
        )

    async def test_denied_across_modules(self):
        db = _db_with_roles([_role(["training.*"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "events.view")
            is False
        )

    async def test_global_wildcard(self):
        db = _db_with_roles([_role(["*"])])
        assert (
            await RoleManagementService().user_has_permission(db, "u1", "anything.goes")
            is True
        )


class TestUserHasAnyPermission:
    async def test_true_via_wildcard(self):
        db = _db_with_roles([_role(["roles.*"])])
        assert (
            await RoleManagementService().user_has_any_permission(
                db, "u1", ["users.view", "roles.edit"]
            )
            is True
        )

    async def test_false_when_none_match(self):
        db = _db_with_roles([_role(["events.*"])])
        assert (
            await RoleManagementService().user_has_any_permission(
                db, "u1", ["users.view", "roles.edit"]
            )
            is False
        )


def _mutation_db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _in_org_result(found: bool = True):
    """What ``org_scoping.is_in_org`` reads: a scalar id, or None."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value="row-id" if found else None)
    return result


def _mutation_db_with_user(role_ids=("new-role",), rank=None):
    """A mutation db that also answers set_user_roles' two scoping reads.

    set_user_roles now resolves the target user inside the org and runs
    assert_all_in_org over the position ids before it writes anything, so a
    bare AsyncMock is no longer enough: the user read must return a row, and
    the in-org id lookup must report every requested id as present.
    """
    db = _mutation_db()
    user = SimpleNamespace(id="user-1", organization_id="org-1", rank=rank)

    user_result = MagicMock()
    user_result.scalar_one_or_none = MagicMock(return_value=user)

    # assert_all_in_org reads result.all() and takes row[0], not .scalars().
    ids_result = MagicMock()
    ids_result.all.return_value = [(str(r),) for r in role_ids]

    generic = MagicMock()
    generic.scalars.return_value.all.return_value = []
    generic.scalar_one_or_none = MagicMock(return_value=None)

    db.execute = AsyncMock(side_effect=[user_result, ids_result] + [generic] * 12)
    return db


class TestRoleMutationAuditing:
    async def test_member_system_position_display_name_can_change(self):
        db = _mutation_db()
        service = RoleManagementService()
        member = SimpleNamespace(
            id="member-role",
            organization_id="org-1",
            name="Member",
            slug="member",
            description="Baseline",
            permissions=["events.view"],
            is_system=True,
            priority=10,
        )
        service.get_role = AsyncMock(return_value=member)

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=object()),
        ) as audit:
            updated = await service.update_role(
                db, "member-role", "org-1", "admin-1", name="Volunteer"
            )

        assert updated.name == "Volunteer"
        assert updated.slug == "member"
        assert updated.permissions == ["events.view"]
        assert permission_matches("events.view", set(updated.permissions))
        assert audit.await_args.kwargs["event_data"]["changes"]["name"] == {
            "old": "Member",
            "new": "Volunteer",
        }

    async def test_other_system_position_name_update_is_rejected(self):
        db = _mutation_db()
        service = RoleManagementService()
        service.get_role = AsyncMock(
            return_value=SimpleNamespace(
                id="chief-role",
                name="Chief",
                slug="chief",
                is_system=True,
            )
        )

        with pytest.raises(ValueError, match="Cannot rename this system position"):
            await service.update_role(
                db, "chief-role", "org-1", "admin-1", name="Commander"
            )

        db.flush.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_create_has_one_canonical_audit_before_commit(self):
        db = _mutation_db()
        service = RoleManagementService()
        service.get_role_by_slug = AsyncMock(return_value=None)

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=object()),
        ) as audit:
            await service.create_role(db, "org-1", "Officer", [], "user-1")

        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_type"] == "role_created"
        db.commit.assert_awaited_once()

    async def test_create_audit_failure_rolls_back_without_commit(self):
        db = _mutation_db()
        service = RoleManagementService()
        service.get_role_by_slug = AsyncMock(return_value=None)

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(RuntimeError, match="creation audit"):
                await service.create_role(db, "org-1", "Officer", [], "user-1")

        db.commit.assert_not_awaited()
        db.rollback.assert_awaited_once()

    async def test_assignment_has_one_audit_and_one_commit(self):
        db = _mutation_db()
        absent = MagicMock()
        absent.first.return_value = None
        role_name = MagicMock()
        role_name.scalar.return_value = "Officer"
        # Two in-org lookups (member, position) precede the assignment reads.
        db.execute.side_effect = [
            _in_org_result(),
            _in_org_result(),
            absent,
            MagicMock(),
            role_name,
        ]

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=object()),
        ) as audit:
            changed = await RoleManagementService().assign_role_to_user(
                db, "user-1", "role-1", "admin-1", organization_id="org-1"
            )

        assert changed is True
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_type"] == "role_assigned"
        db.commit.assert_awaited_once()

    async def test_assignment_audit_failure_rolls_back_without_commit(self):
        db = _mutation_db()
        absent = MagicMock()
        absent.first.return_value = None
        role_name = MagicMock()
        role_name.scalar.return_value = "Officer"
        db.execute.side_effect = [
            _in_org_result(),
            _in_org_result(),
            absent,
            MagicMock(),
            role_name,
        ]

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(RuntimeError, match="assignment audit"):
                await RoleManagementService().assign_role_to_user(
                    db, "user-1", "role-1", "admin-1", organization_id="org-1"
                )

        db.commit.assert_not_awaited()
        db.rollback.assert_awaited_once()

    async def test_removal_audit_failure_rolls_back_without_commit(self):
        db = _mutation_db()
        role_name = MagicMock()
        role_name.scalar.return_value = "Officer"
        deleted = MagicMock()
        deleted.rowcount = 1
        db.execute.side_effect = [
            _in_org_result(),
            _in_org_result(),
            role_name,
            deleted,
        ]

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(RuntimeError, match="removal audit"):
                await RoleManagementService().remove_role_from_user(
                    db, "user-1", "role-1", "admin-1", organization_id="org-1"
                )

        db.commit.assert_not_awaited()
        db.rollback.assert_awaited_once()


class TestSingleAssignmentOrgScoping:
    """PERM-7: both single-assignment helpers bound their ids to the org.

    Neither has a caller in ``app/``. That is exactly why they are guarded:
    the tenancy check has to already be there when an endpoint is wired up,
    because the reviewer of that change sees only a one-line service call.
    """

    async def test_assign_refuses_a_member_from_another_org(self):
        db = _mutation_db()
        db.execute.side_effect = [_in_org_result(found=False)]

        with pytest.raises(ValueError, match="Invalid member"):
            await RoleManagementService().assign_role_to_user(
                db, "user-1", "role-1", "admin-1", organization_id="org-1"
            )

        db.commit.assert_not_awaited()

    async def test_assign_refuses_a_position_from_another_org(self):
        db = _mutation_db()
        db.execute.side_effect = [_in_org_result(), _in_org_result(found=False)]

        with pytest.raises(ValueError, match="Invalid position"):
            await RoleManagementService().assign_role_to_user(
                db, "user-1", "role-1", "admin-1", organization_id="org-1"
            )

        db.commit.assert_not_awaited()

    async def test_remove_refuses_a_member_from_another_org(self):
        db = _mutation_db()
        db.execute.side_effect = [_in_org_result(found=False)]

        with pytest.raises(ValueError, match="Invalid member"):
            await RoleManagementService().remove_role_from_user(
                db, "user-1", "role-1", "admin-1", organization_id="org-1"
            )

        db.commit.assert_not_awaited()

    async def test_remove_refuses_a_position_from_another_org(self):
        db = _mutation_db()
        db.execute.side_effect = [_in_org_result(), _in_org_result(found=False)]

        with pytest.raises(ValueError, match="Invalid position"):
            await RoleManagementService().remove_role_from_user(
                db, "user-1", "role-1", "admin-1", organization_id="org-1"
            )

        db.commit.assert_not_awaited()

    @pytest.mark.parametrize(
        "method", ["assign_role_to_user", "remove_role_from_user", "set_user_roles"]
    )
    def test_organization_id_is_required_and_keyword_only(self, method):
        """A positional org id, or none at all, must not compile a call."""
        signature = inspect.signature(getattr(RoleManagementService, method))
        param = signature.parameters["organization_id"]
        assert param.kind is inspect.Parameter.KEYWORD_ONLY
        assert param.default is inspect.Parameter.empty

    async def test_bulk_replacement_writes_only_its_canonical_audit(self):
        db = _mutation_db_with_user()
        service = RoleManagementService()
        new_role = SimpleNamespace(id="new-role")
        service.get_user_roles = AsyncMock(side_effect=[[], [new_role]])

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=object()),
        ) as audit:
            roles = await service.set_user_roles(
                db, "user-1", ["new-role"], "admin-1", organization_id="org-1"
            )

        assert roles == [new_role]
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_type"] == "user_roles_replaced"
        db.commit.assert_awaited_once()

    async def test_bulk_audit_failure_rolls_back_all_assignment_changes(self):
        db = _mutation_db_with_user()
        service = RoleManagementService()
        service.get_user_roles = AsyncMock(return_value=[])

        with patch(
            "app.services.role_service.log_audit_event",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(RuntimeError, match="replacement audit"):
                await service.set_user_roles(
                    db, "user-1", ["new-role"], "admin-1", organization_id="org-1"
                )

        db.commit.assert_not_awaited()
        db.rollback.assert_awaited_once()

    async def test_a_user_outside_the_org_is_refused(self):
        """The target is resolved inside organization_id, so a foreign user
        simply does not exist as far as this method is concerned."""
        db = _mutation_db()
        no_user = MagicMock()
        no_user.scalar_one_or_none = MagicMock(return_value=None)
        db.execute = AsyncMock(return_value=no_user)

        with pytest.raises(ValueError, match="User not found"):
            await RoleManagementService().set_user_roles(
                db,
                "user-in-another-org",
                ["new-role"],
                "admin-1",
                organization_id="org-1",
            )

        db.commit.assert_not_awaited()

    async def test_a_position_outside_the_org_is_refused_before_any_write(self):
        """XC-1: an unvalidated position id would persist a foreign position —
        and positions carry permissions — so it is rejected before the insert,
        not after."""
        db = _mutation_db()
        user = SimpleNamespace(id="user-1", organization_id="org-1", rank=None)
        user_result = MagicMock()
        user_result.scalar_one_or_none = MagicMock(return_value=user)
        # assert_all_in_org resolves none of the requested ids in this org.
        ids_result = MagicMock()
        ids_result.all.return_value = []
        db.execute = AsyncMock(side_effect=[user_result, ids_result])

        with pytest.raises(ValueError, match="Invalid position"):
            await RoleManagementService().set_user_roles(
                db,
                "user-1",
                ["role-from-another-org"],
                "admin-1",
                organization_id="org-1",
            )

        db.commit.assert_not_awaited()

    async def test_organization_id_is_keyword_only(self):
        """So a future caller cannot supply it by accident of argument order."""
        with pytest.raises(TypeError):
            await RoleManagementService().set_user_roles(
                _mutation_db(), "user-1", ["new-role"], "admin-1", "org-1"
            )
