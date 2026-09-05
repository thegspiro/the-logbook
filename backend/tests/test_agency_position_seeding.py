"""What a department is handed depends on what kind of department it is.

An EMS-only service has the same officer ladder as anyone else and no fire line
at all, so seeding it a "Firefighter" position hands it a title nobody there can
hold, and calling its chief "Fire Chief" is simply wrong. Ranks learned this on
2026-08-26; positions are the half that matters more, because positions — not
ranks — are the primary source of permissions.

The selection rule lives in ``app.core.permissions`` beside both registries, and
is shared with ``default_ranks_for`` so the rank list and the position list
cannot describe the same department differently.

**Only disciplines are enumerated.** A code that is not a discipline is seeded
everywhere, so a rung added to a registry and forgotten here reaches every
agency — the recoverable direction. The golden sets below are what force a new
entry to be classified rather than inherited: they are spelled out by name, so
adding a position without deciding which agencies have it fails here.
"""

import asyncio
import inspect
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from app.core.permissions import (
    ALL_DISCIPLINE_CODES,
    DEFAULT_POSITIONS,
    DISCIPLINE_CODES_BY_ORG_TYPE,
    OPERATIONAL_RANKS,
    default_positions_for,
)
from app.models.user import OrganizationType, Role
from app.services.onboarding import OnboardingService
from app.services.operational_rank_service import DEFAULT_RANKS, default_ranks_for

pytestmark = pytest.mark.unit

_OFFICERS = (
    "fire_chief",
    "deputy_chief",
    "assistant_chief",
    "captain",
    "lieutenant",
)

_ADMINISTRATIVE = (
    "it_manager",
    "president",
    "vice_president",
    "treasurer",
    "secretary",
    "assistant_secretary",
    "board_of_directors",
    "quartermaster",
    # Universal on purpose. Most fire departments run EMS, so withholding the
    # EMS Supply Officer from one would be the mirror of the bug this closes —
    # a department missing a position has no indication anything is absent.
    "ems_supply_officer",
    "public_outreach",
    "communications_officer",
    "historian",
    "apparatus_officer",
    "membership_coordinator",
    "safety_officer",
    "training_officer",
    "fundraising_chair",
    "scheduling_officer",
    "meeting_hall_coordinator",
    "facilities_manager",
    "member",
)

# EMT is a discipline of every agency type — an EMS service has no fire line,
# but a fire department does run EMTs, and the rank registry has always said so.
# The position mirroring it was missing until 2026-09-05, which is what sent the
# setup wizard's EMT through the create-from-checkboxes path.
GOLDEN_POSITIONS = {
    "fire_department": set(
        _OFFICERS + _ADMINISTRATIVE + ("engineer", "firefighter", "emt")
    ),
    "fire_ems_combined": set(
        _OFFICERS + _ADMINISTRATIVE + ("engineer", "firefighter", "emt")
    ),
    "ems_only": set(_OFFICERS + _ADMINISTRATIVE + ("engineer", "emt")),
}


class TestTheSeededSetIsSpelledOut:
    @pytest.mark.parametrize("org_type", sorted(GOLDEN_POSITIONS))
    def test_matches_the_golden_set(self, org_type):
        """Named rather than derived, so a new position must be classified.

        Deriving the expectation from the same rule the code uses would assert
        only that the rule is itself, and a fire-only position added later would
        reach every EMS agency with nothing failing.
        """
        assert set(default_positions_for(org_type)) == GOLDEN_POSITIONS[org_type]

    def test_an_ems_service_is_not_handed_a_firefighter(self):
        assert "firefighter" not in default_positions_for("ems_only")

    def test_an_ems_service_keeps_the_whole_officer_ladder(self):
        seeded = default_positions_for("ems_only")
        for officer in _OFFICERS:
            assert officer in seeded, f"EMS agencies have {officer} too"

    def test_a_fire_department_is_unchanged(self):
        assert set(default_positions_for("fire_department")) == set(DEFAULT_POSITIONS)

    def test_combined_matches_fire(self):
        assert default_positions_for("fire_ems_combined") == default_positions_for(
            "fire_department"
        )

    @pytest.mark.parametrize("org_type", [None, "", "something_new"])
    def test_an_unknown_agency_gets_the_full_set(self, org_type):
        # Seeding too few is the worse failure: a department missing a position
        # has no indication anything is absent, while a spare one is visible in
        # the editor and deletable.
        assert default_positions_for(org_type) == default_positions_for(
            "fire_department"
        )

    def test_every_seeded_slug_is_a_real_position(self):
        for org_type in GOLDEN_POSITIONS:
            for slug in default_positions_for(org_type):
                assert slug in DEFAULT_POSITIONS, f"{org_type} seeds unknown {slug!r}"


class TestTheAgencyRename:
    def test_an_ems_service_has_a_chief_not_a_fire_chief(self):
        seeded = default_positions_for("ems_only")
        # The slug is untouched: it keys the permission registry, the office
        # catalog and the shift-eligibility fallback, so it must mean the same
        # thing for every agency. Only the wording changes.
        assert seeded["fire_chief"]["name"] == "Chief"
        assert seeded["fire_chief"]["slug"] == "fire_chief"

    def test_an_ems_engineer_is_a_driver_operator(self):
        assert default_positions_for("ems_only")["engineer"]["name"] == (
            "Driver / Operator"
        )

    def test_a_fire_department_keeps_the_registry_wording(self):
        seeded = default_positions_for("fire_department")
        assert seeded["fire_chief"]["name"] == "Fire Chief"
        assert seeded["engineer"]["name"] == "Engineer / Driver Operator"

    def test_the_rename_does_not_reach_the_registry(self):
        default_positions_for("ems_only")
        assert DEFAULT_POSITIONS["fire_chief"]["name"] == "Fire Chief"


class TestTheCopyIsShallowOnPurpose:
    """Pitfall #23 has to survive the filter.

    ``DEFAULT_POSITIONS[slug]["permissions"]`` *is* the rank registry's list
    object for the rank-mirroring slugs, which is what makes a seeded-grant
    change reach the database through a position. Copying the list here would
    end that quietly — the aliasing test in test_rank_registry_agreement.py
    reads the registry, not this function's output, so it would still pass.
    """

    @pytest.mark.parametrize("org_type", sorted(GOLDEN_POSITIONS))
    def test_a_mirrored_position_still_carries_the_ranks_own_list(self, org_type):
        seeded = default_positions_for(org_type)
        mirrored = [c for c in seeded if c in OPERATIONAL_RANKS]
        assert mirrored, "expected at least one rank-mirroring position"
        for code in mirrored:
            assert (
                seeded[code]["permissions"]
                is OPERATIONAL_RANKS[code]["default_permissions"]
            ), f"{code!r} stopped aliasing the rank's list (pitfall #23)"

    def test_everything_but_the_name_survives_the_copy(self):
        seeded = default_positions_for("ems_only")
        for slug, definition in seeded.items():
            original = DEFAULT_POSITIONS[slug]
            for key in original:
                if key == "name":
                    continue
                assert definition[key] == original[key], f"{slug}.{key} changed"

    def test_editing_the_result_does_not_edit_the_registry(self):
        seeded = default_positions_for("fire_department")
        seeded["member"]["priority"] = 999
        assert DEFAULT_POSITIONS["member"]["priority"] != 999


class TestTheVocabularyIsWellFormed:
    def test_every_agency_type_is_mapped(self):
        """A new OrganizationType must be classified, not silently defaulted.

        The keys are plain strings rather than enum members on purpose:
        ``permissions.py`` is stdlib-only and importing the model would pull
        SQLAlchemy into a module that ``api/dependencies.py`` imports. This is
        the check that keeps the strings honest.
        """
        assert set(DISCIPLINE_CODES_BY_ORG_TYPE) == {t.value for t in OrganizationType}

    def test_every_discipline_code_is_a_real_rank_code(self):
        # A typo here would not raise; it would silently seed the misspelled
        # code to nobody and the real one to everybody.
        known = {code for code, _l, _o, _p in DEFAULT_RANKS}
        assert ALL_DISCIPLINE_CODES <= known

    @pytest.mark.parametrize("org_type", sorted(GOLDEN_POSITIONS))
    def test_ranks_and_positions_select_the_same_disciplines(self, org_type):
        """The one invariant the shared rule exists to hold.

        A department must not be told it has EMTs by one screen and firefighters
        by the next. Scoped to the discipline codes, because the two registries
        legitimately differ elsewhere — ``emt`` is a rank with no position, and
        most positions are not ranks at all.
        """
        ranks = {code for code, _l, _o, _p in default_ranks_for(org_type)}
        positions = set(default_positions_for(org_type))
        assert ranks & ALL_DISCIPLINE_CODES & set(DEFAULT_POSITIONS) == (
            positions & ALL_DISCIPLINE_CODES
        )


# ---------------------------------------------------------------------------
# End to end, against a real database
# ---------------------------------------------------------------------------


def _org_data(organization_type: str) -> dict:
    return {
        "name": f"Test {organization_type} Agency",
        "slug": f"test-{organization_type.replace('_', '-')}-{uuid.uuid4().hex[:8]}",
        "organization_type": organization_type,
        "identifier_type": "department_id",
        "department_id": "DEPT-001",
        "mailing_address_line1": "100 Main St",
        "mailing_city": "Springfield",
        "mailing_state": "IL",
        "mailing_zip": "62701",
        "physical_address_same": True,
    }


async def _seeded(db_session, organization_type: str) -> dict:
    """slug -> Position row, as onboarding actually wrote them."""
    org = await OnboardingService(db_session).create_organization(
        **_org_data(organization_type)
    )
    await db_session.flush()
    rows = (
        (await db_session.execute(select(Role).where(Role.organization_id == org.id)))
        .scalars()
        .all()
    )
    return {row.slug: row for row in rows}


@pytest.mark.integration
class TestOnboardingWritesTheRightPositions:
    """The rule is only worth having if the rows it decides actually land.

    ``create_organization`` seeds positions inline and rejects a second
    organization, so this is the one chance the department gets — whatever it
    writes on day one is what the department lives with.
    """

    async def test_an_ems_service_gets_no_firefighter_row(self, db_session):
        seeded = await _seeded(db_session, "ems_only")
        assert "firefighter" not in seeded
        assert "fire_chief" in seeded, "an EMS service still has a chief"

    async def test_an_ems_service_reads_chief_on_the_row(self, db_session):
        seeded = await _seeded(db_session, "ems_only")
        assert seeded["fire_chief"].name == "Chief"
        assert seeded["engineer"].name == "Driver / Operator"

    async def test_a_fire_department_is_seeded_exactly_as_before(self, db_session):
        seeded = await _seeded(db_session, "fire_department")
        assert set(seeded) == set(DEFAULT_POSITIONS)
        assert seeded["firefighter"].name == "Firefighter"

    async def test_an_unknown_agency_type_falls_back_to_the_full_set(self, db_session):
        # create_organization coerces anything it does not recognise to
        # fire_department, and the seed is handed that coerced value rather
        # than the raw string — so the two cannot disagree about what was
        # written.
        seeded = await _seeded(db_session, "something_new")
        assert "firefighter" in seeded


class TestTheSeederDoesNotPersistTheModuleConstant:
    """A row that shares the registry's list is one edit from rewriting it.

    The seven rank-mirroring entries alias the rank registry's list object
    (pitfall #23), so handing that reference to an ORM column would put a module
    constant behind a database row: an in-place edit of one department's
    permissions would rewrite every other department's seed for the life of the
    process, and the rank registry with it.

    Asserted against the objects the seeder builds rather than against rows read
    back, because a round-trip through the JSON column decodes a fresh list
    either way — a test on reloaded rows passes whether or not the copy is
    there, which is worse than not testing it at all.
    """

    @staticmethod
    def _added(organization_type: str) -> list:
        db = MagicMock()
        db.add = MagicMock()
        db.flush = AsyncMock()
        service = OnboardingService(db)
        asyncio.run(service._create_default_roles("org-1", organization_type))
        return [call.args[0] for call in db.add.call_args_list]

    def test_no_seeded_row_shares_a_list_with_the_registry(self):
        for role in self._added("fire_department"):
            assert (
                role.permissions is not DEFAULT_POSITIONS[role.slug]["permissions"]
            ), f"{role.slug!r} was handed the registry's list by reference"

    def test_the_grants_themselves_are_unchanged(self):
        # The copy has to be a copy, not a filter.
        for role in self._added("fire_department"):
            assert role.permissions == DEFAULT_POSITIONS[role.slug]["permissions"]

    def test_the_agency_type_is_required(self):
        """A second caller must decide, not inherit a fire department.

        Defaulting it is how an EMS-only service would quietly be seeded a fire
        ladder again the day somebody adds another way to create organizations.
        """
        params = inspect.signature(OnboardingService._create_default_roles).parameters
        assert params["organization_type"].default is inspect.Parameter.empty


@pytest.mark.integration
class TestTheRecordedAgencyTypeMatchesTheRow:
    """One answer to "what kind of agency is this", not two.

    ``create_organization`` coerces anything it does not recognise to
    ``fire_department`` before writing the enum column. The onboarding status
    record used to keep the raw argument, so the two could disagree — and the
    status record is what a resumed wizard reads back.
    """

    @staticmethod
    async def _recorded(db_session, organization_type: str):
        # The status row only records the agency type if it exists when the
        # organization is created — the wizard starts onboarding first.
        service = OnboardingService(db_session)
        await service.start_onboarding()
        org = await service.create_organization(**_org_data(organization_type))
        await db_session.flush()
        return org, await service.get_onboarding_status()

    async def test_an_unknown_type_is_recorded_as_it_was_stored(self, db_session):
        org, status = await self._recorded(db_session, "something_new")
        assert org.organization_type == OrganizationType.FIRE_DEPARTMENT
        assert status is not None
        assert status.organization_type == org.organization_type.value

    async def test_a_known_type_round_trips(self, db_session):
        org, status = await self._recorded(db_session, "ems_only")
        assert status is not None
        assert status.organization_type == "ems_only"
        assert org.organization_type is OrganizationType.EMS_ONLY
