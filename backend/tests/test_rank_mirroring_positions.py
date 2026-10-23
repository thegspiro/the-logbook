"""The seeded mirror of a rank is flagged, so member pickers can leave it out.

Onboarding seeds Chief, Captain, Firefighter and the rest as *positions* as
well as ranks, because the rank registry lends those positions its permission
lists (pitfall #23). The Add Member form then offered "Firefighter" in the
position dropdown beside "Firefighter" in the rank dropdown, and a member
could hold one without the other, which is how the roster came to show the
same word in two columns for some members and in neither for others.

The fix is a flag, not a frontend slug list: ``OPERATIONAL_RANKS`` is the
authority on which codes are ranks, and the screens consume its answer
rather than re-deriving it (CLAUDE.md pitfall #29).
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.core.permissions import (
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
    RANK_MIRRORING_POSITION_SLUGS,
    position_mirrors_rank,
)
from app.models.user import Organization, Position
from app.schemas.role import RoleResponse, RoleWithUserCount
from app.schemas.user import RoleResponse as UserRoleResponseItem
from app.services.role_service import role_service


def _position(slug: str, *, is_system: bool) -> Position:
    now = datetime.now(timezone.utc)
    return Position(
        id=str(uuid.uuid4()),
        organization_id=str(uuid.uuid4()),
        name=slug.replace("_", " ").title(),
        slug=slug,
        permissions=[],
        is_system=is_system,
        priority=10,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.unit
class TestTheSetFollowsTheRankRegistry:
    def test_the_set_is_exactly_the_rank_codes(self):
        """A rank added to the registry is a mirroring slug the same day.

        The set is derived rather than listed so that a new rank cannot
        appear in the position picker before anyone remembers to add it here.
        """
        assert RANK_MIRRORING_POSITION_SLUGS == frozenset(OPERATIONAL_RANKS)

    @pytest.mark.parametrize("slug", sorted(RANK_MIRRORING_POSITION_SLUGS))
    def test_every_mirroring_slug_that_is_seeded_aliases_its_ranks_list(self, slug):
        """The flag names precisely the positions pitfall #23 is about.

        A seeded position in the set must carry the rank registry's own list
        object, or the two would be able to drift apart while the picker
        still hid the position as "the rank's".
        """
        if slug not in DEFAULT_POSITIONS:
            pytest.skip(f"{slug} is a rank with no seeded position")
        assert (
            DEFAULT_POSITIONS[slug]["permissions"]
            is OPERATIONAL_RANKS[slug]["default_permissions"]
        )
        assert DEFAULT_POSITIONS[slug]["is_system"] is True

    def test_no_other_seeded_position_borrows_a_ranks_list(self):
        """The reverse: a position outside the set is not a rank in disguise."""
        rank_lists = {
            id(rank["default_permissions"]) for rank in OPERATIONAL_RANKS.values()
        }
        borrowed = sorted(
            slug
            for slug, definition in DEFAULT_POSITIONS.items()
            if slug not in RANK_MIRRORING_POSITION_SLUGS
            and id(definition["permissions"]) in rank_lists
        )
        assert borrowed == [], (
            f"{borrowed} carry a rank's permission list but are not flagged as "
            "mirroring a rank; the picker would still offer them"
        )


@pytest.mark.unit
class TestThePredicate:
    @pytest.mark.parametrize("slug", sorted(RANK_MIRRORING_POSITION_SLUGS))
    def test_a_system_position_with_a_rank_code_mirrors_it(self, slug):
        assert position_mirrors_rank(slug, True) is True

    @pytest.mark.parametrize("slug", ["member", "secretary", "training_officer"])
    def test_a_system_position_with_another_code_does_not(self, slug):
        assert position_mirrors_rank(slug, True) is False

    def test_a_departments_own_position_under_a_rank_name_is_theirs(self):
        """An EMS-only service that creates "Firefighter" itself keeps it.

        That department was never seeded the mirror, so its row is a custom
        office and belongs in the pickers like any other.
        """
        assert position_mirrors_rank("firefighter", False) is False
        assert position_mirrors_rank("firefighter", None) is False

    def test_a_missing_slug_is_not_a_rank(self):
        assert position_mirrors_rank(None, True) is False


@pytest.mark.unit
class TestTheFlagReachesEveryRoleResponse:
    def test_the_model_property(self):
        assert _position("captain", is_system=True).mirrors_rank is True
        assert _position("captain", is_system=False).mirrors_rank is False
        assert _position("secretary", is_system=True).mirrors_rank is False

    def test_the_positions_list_schema(self):
        payload = RoleResponse.model_validate(_position("firefighter", is_system=True))
        assert payload.mirrors_rank is True
        counted = RoleWithUserCount.model_validate(
            _position("secretary", is_system=True)
        )
        assert counted.mirrors_rank is False

    def test_the_schema_nested_under_a_member(self):
        """``GET /users/with-roles`` and the profile use the other RoleResponse."""
        payload = UserRoleResponseItem.model_validate(
            _position("fire_chief", is_system=True)
        )
        assert payload.mirrors_rank is True

    def test_a_dict_without_the_key_still_validates(self):
        """Older callers that build the dict by hand keep working."""
        payload = RoleResponse.model_validate(
            {
                "id": str(uuid.uuid4()),
                "organization_id": str(uuid.uuid4()),
                "name": "Secretary",
                "slug": "secretary",
                "permissions": [],
                "is_system": True,
                "priority": 10,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        )
        assert payload.mirrors_rank is False


@pytest.mark.integration
class TestListRolesReportsIt:
    async def test_list_roles_flags_the_seeded_mirror_only(self, db_session):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Mirror Department",
            slug=f"mirror-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(org)
        await db_session.flush()
        rows = [
            Position(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name=name,
                slug=slug,
                permissions=[],
                is_system=is_system,
                priority=priority,
            )
            for name, slug, is_system, priority in (
                ("Member", "member", True, 10),
                ("Firefighter", "firefighter", True, 15),
                ("Captain", "captain", True, 60),
                # A custom office the department named after a rank it was
                # never seeded; theirs, so offered.
                ("Firefighter", "firefighter_2", False, 20),
            )
        ]
        db_session.add_all(rows)
        await db_session.flush()

        listed = await role_service.list_roles(
            db_session, organization_id=org.id, include_user_count=False
        )

        by_slug = {row["slug"]: row["mirrors_rank"] for row in listed}
        assert by_slug == {
            "member": False,
            "firefighter": True,
            "captain": True,
            "firefighter_2": False,
        }
        # And the response model carries it through unchanged.
        assert [
            RoleWithUserCount.model_validate(row).mirrors_rank for row in listed
        ] == [by_slug[row["slug"]] for row in listed]
