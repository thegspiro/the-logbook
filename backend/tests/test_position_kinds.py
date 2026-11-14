"""``positions.kind``: office, committee or system.

A committee is a position so membership of it is recorded and shown like an
office, but it is not one: it grants nothing, and the platform's own positions
(the baseline member, the owner, the rank mirrors) are neither.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.permissions import (
    COMMITTEE_POSITION_SLUGS,
    DEFAULT_POSITIONS,
    POSITION_KINDS,
    RANK_MIRRORING_POSITION_SLUGS,
    SYSTEM_POSITION_SLUGS,
    default_positions_for,
    position_kind_for,
)
from app.schemas.role import RoleCreate, RoleResponse, RoleUpdate
from app.services.role_service import RoleManagementService

pytestmark = pytest.mark.unit


class TestTheRegistryStatesEveryKind:
    @pytest.mark.parametrize("slug", sorted(DEFAULT_POSITIONS))
    def test_every_seeded_position_has_a_kind(self, slug):
        assert DEFAULT_POSITIONS[slug]["kind"] in POSITION_KINDS

    def test_the_system_set_is_the_rank_mirrors_plus_member_and_owner(self):
        assert SYSTEM_POSITION_SLUGS == RANK_MIRRORING_POSITION_SLUGS | {
            "member",
            "it_manager",
        }
        for slug in SYSTEM_POSITION_SLUGS:
            assert DEFAULT_POSITIONS[slug]["kind"] == "system", slug

    def test_the_four_committees(self):
        assert COMMITTEE_POSITION_SLUGS == {
            "community_outreach_team",
            "history_committee",
            "fundraising_committee",
            "membership_committee",
        }

    @pytest.mark.parametrize("slug", sorted(COMMITTEE_POSITION_SLUGS))
    def test_a_committee_carries_the_baseline_as_a_copy(self, slug):
        """Nothing beyond what every member holds, and never the same list
        object as the member position (pitfall #23)."""
        definition = DEFAULT_POSITIONS[slug]
        baseline = DEFAULT_POSITIONS["member"]["permissions"]
        assert definition["permissions"] == baseline
        assert definition["permissions"] is not baseline
        assert definition["is_system"] is True
        assert definition["kind"] == "committee"

    @pytest.mark.parametrize(
        "slug", ["president", "treasurer", "quartermaster", "historian"]
    )
    def test_an_office_is_an_office(self, slug):
        assert DEFAULT_POSITIONS[slug]["kind"] == "office"

    @pytest.mark.parametrize(
        "org_type", ["fire_department", "ems_only", "fire_ems_combined"]
    )
    def test_committees_are_seeded_to_every_agency(self, org_type):
        assert COMMITTEE_POSITION_SLUGS <= set(default_positions_for(org_type))

    def test_position_kind_for(self):
        assert position_kind_for("captain") == "system"
        assert position_kind_for("member") == "system"
        assert position_kind_for("treasurer") == "office"
        assert position_kind_for("history_committee") == "committee"
        # A department's own slug the registry does not know is an office.
        assert position_kind_for("bingo_night_crew") == "office"
        assert position_kind_for(None) == "office"


class TestTheSchemas:
    def test_create_defaults_to_office_and_refuses_system(self):
        assert RoleCreate(name="Bingo Crew").kind == "office"
        assert RoleCreate(name="Bingo Crew", kind="committee").kind == "committee"
        with pytest.raises(ValueError, match="kind"):
            RoleCreate(name="Owner", kind="system")

    def test_update_refuses_a_null_kind(self):
        with pytest.raises(ValueError, match="kind"):
            RoleUpdate(kind=None)

    def test_response_coerces_a_missing_kind(self):
        """An unflushed ORM object carries None until the column default runs."""
        row = {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "22222222-2222-2222-2222-222222222222",
            "name": "Member",
            "slug": "member",
            "is_system": True,
            "priority": 10,
            "kind": None,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        assert RoleResponse.model_validate(row).kind == "office"


def _mutation_db():
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


class TestTheService:
    async def test_an_unknown_kind_is_refused_on_create(self):
        service = RoleManagementService()
        service._assert_position_name_free = AsyncMock()
        service.get_role_by_slug = AsyncMock(return_value=None)
        db = _mutation_db()
        with pytest.raises(ValueError, match="Unknown position kind"):
            await service.create_role(
                db, "org-1", "Bingo Crew", [], "admin-1", kind="club"
            )
        db.add.assert_not_called()

    async def test_create_role_also_refuses_system(self):
        """`kind="system"` is blocked by the RoleCreate schema before it ever
        reaches the service, but the service itself must refuse it too: a
        future internal caller that builds a role without going through the
        schema (the way ``clone_role`` or a script might) must not be able to
        mint a fake platform-owned position just by calling create_role."""
        service = RoleManagementService()
        service._assert_position_name_free = AsyncMock()
        service.get_role_by_slug = AsyncMock(return_value=None)
        db = _mutation_db()
        with pytest.raises(ValueError, match="Unknown position kind"):
            await service.create_role(
                db, "org-1", "Fake Owner", [], "admin-1", kind="system"
            )
        db.add.assert_not_called()

    async def test_a_system_position_keeps_its_kind(self):
        service = RoleManagementService()
        service.get_role = AsyncMock(
            return_value=SimpleNamespace(
                id="hist",
                name="History Committee",
                slug="history_committee",
                is_system=True,
                kind="committee",
                description=None,
                permissions=[],
            )
        )
        db = _mutation_db()
        with pytest.raises(ValueError, match="Cannot change the kind"):
            await service.update_role(db, "hist", "org-1", "admin-1", kind="office")
        db.commit.assert_not_awaited()

    async def test_a_custom_position_cannot_become_the_platforms(self):
        service = RoleManagementService()
        service.get_role = AsyncMock(
            return_value=SimpleNamespace(
                id="bingo",
                name="Bingo Crew",
                slug="bingo_crew",
                is_system=False,
                kind="office",
                description=None,
                permissions=[],
                priority=10,
            )
        )
        db = _mutation_db()
        with pytest.raises(ValueError, match="reserved for the platform"):
            await service.update_role(db, "bingo", "org-1", "admin-1", kind="system")
        db.commit.assert_not_awaited()
