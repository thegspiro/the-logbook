"""Who an event counting toward attendance requirements is mandatory for.

``mandatory_tiers_for_requirements`` pre-fills an event's "Mandatory for"
from the session-attendance requirements it counts toward. It must read a
requirement the way ``requirement_applies_to_member`` grades one (pitfall
#29), and say so rather than guess where no membership tier stands for the
members a requirement grades.
"""

from types import SimpleNamespace

import pytest

from app.services.training_compliance import (
    UnmappedRequirement,
    mandatory_tiers_for_requirements,
)

pytestmark = [pytest.mark.unit]

DEFAULT_LADDER = ["probationary", "active", "senior", "life"]


def _req(
    name="Drills",
    *,
    applies_to_all=False,
    types=None,
    roles=None,
    positions=None,
    active=True,
):
    return SimpleNamespace(
        id=f"req-{name.lower()}",
        name=name,
        applies_to_all=applies_to_all,
        required_membership_types=types,
        required_roles=roles,
        required_positions=positions,
        active=active,
    )


class TestTheProjection:
    def test_applies_to_all_means_everyone_and_covers_the_rest(self):
        tiers = mandatory_tiers_for_requirements(
            [_req("Admin", types=["administrative"]), _req("All", applies_to_all=True)],
            DEFAULT_LADDER,
        )

        assert (tiers.everyone, tiers.tier_ids, tiers.unmapped) == (True, [], [])

    def test_active_is_the_regular_tier(self):
        tiers = mandatory_tiers_for_requirements(
            [_req(types=["active"])], DEFAULT_LADDER
        )

        assert tiers.tier_ids == ["active"]
        assert tiers.unmapped == []

    def test_a_ladder_that_spells_the_regular_rung_differently_still_matches(self):
        tiers = mandatory_tiers_for_requirements(
            [_req(types=["active"])], ["probationary", "regular", "life"]
        )

        assert tiers.tier_ids == ["regular"]

    def test_probationary_takes_the_junior_tier_too(self):
        tiers = mandatory_tiers_for_requirements(
            [_req(types=["probationary"])], ["junior", "probationary", "active"]
        )

        assert tiers.tier_ids == ["junior", "probationary"]

    @pytest.mark.parametrize("word", ["administrative", "honorary"])
    def test_a_class_word_is_named_not_guessed(self, word):
        tiers = mandatory_tiers_for_requirements(
            [_req("Admin", types=[word])], DEFAULT_LADDER
        )

        # Administrative members stand on the regular rung, so mapping the
        # word there would make the event mandatory for every regular member.
        assert tiers.tier_ids == []
        assert tiers.unmapped == [
            UnmappedRequirement(
                "req-admin",
                "Admin",
                f"{word.capitalize()} members can't be chosen by member type",
            )
        ]

    def test_a_word_with_no_tier_on_the_ladder_is_named(self):
        tiers = mandatory_tiers_for_requirements(
            [_req("Retirees", types=["retired"])], DEFAULT_LADDER
        )

        assert tiers.tier_ids == []
        assert tiers.unmapped == [
            UnmappedRequirement(
                "req-retirees",
                "Retirees",
                "No member type here stands for retired members",
            )
        ]

    @pytest.mark.parametrize(
        "scope", [{"roles": ["captain"]}, {"positions": ["engineer"]}]
    )
    def test_a_rank_or_position_scope_is_named(self, scope):
        tiers = mandatory_tiers_for_requirements(
            [_req("Officers", **scope)], DEFAULT_LADDER
        )

        assert tiers.tier_ids == []
        assert [u.reason for u in tiers.unmapped] == [
            "It applies by rank or position, which can't be chosen as a member type"
        ]

    def test_membership_types_win_over_ranks_as_the_grader_reads_them(self):
        tiers = mandatory_tiers_for_requirements(
            [_req(types=["life"], roles=["captain"])], DEFAULT_LADDER
        )

        assert (tiers.tier_ids, tiers.unmapped) == (["life"], [])

    # The grader applies it to no member, as the Counts toward attendance
    # checklist says. Left silent, it read as a source of the tiers the
    # other requirements suggested, or left Mandatory for with no word.
    @pytest.mark.parametrize("types", [None, [], ["", "  "]])
    def test_a_requirement_naming_nobody_is_named_and_suggests_no_one(self, types):
        tiers = mandatory_tiers_for_requirements(
            [_req("Unscoped", types=types), _req("Drills", types=["active"])],
            DEFAULT_LADDER,
        )

        assert (tiers.everyone, tiers.tier_ids) == (False, ["active"])
        assert tiers.unmapped == [
            UnmappedRequirement(
                "req-unscoped",
                "Unscoped",
                "It applies to no members, since no member categories, ranks "
                "or positions are set",
                applies_to_no_one=True,
            )
        ]

    # A link the session keeps to a requirement since deactivated: nothing
    # grades through it any more, so it decides no one, even one that applied
    # to everyone, and the form says it adds no one rather than offering to
    # choose All members for it.
    @pytest.mark.parametrize(
        "scope", [{"applies_to_all": True}, {"types": ["senior"]}, {"types": []}]
    )
    def test_a_requirement_no_longer_active_suggests_no_one(self, scope):
        tiers = mandatory_tiers_for_requirements(
            [_req("Retired", active=False, **scope), _req("Drills", types=["active"])],
            DEFAULT_LADDER,
        )

        assert (tiers.everyone, tiers.tier_ids) == (False, ["active"])
        assert tiers.unmapped == [
            UnmappedRequirement(
                "req-retired",
                "Retired",
                "It is no longer active",
                applies_to_no_one=True,
            )
        ]

    # All members covers every requirement that grades someone, but not one
    # that grades no one: the form's checklist says it "Applies to no
    # members", so it is still named, never read as a source of All members.
    # Either order, since the projection used to stop at the first
    # applies_to_all and drop what it had collected.
    @pytest.mark.parametrize(
        ("no_one", "reason"),
        [
            (
                _req("Empty"),
                "It applies to no members, since no member categories, ranks "
                "or positions are set",
            ),
            (
                _req("Empty", types=["", "  "]),
                "It applies to no members, since no member categories, ranks "
                "or positions are set",
            ),
            (
                _req("Empty", active=False, types=["senior"]),
                "It is no longer active",
            ),
        ],
        ids=["no-scope", "blank-categories", "inactive"],
    )
    @pytest.mark.parametrize("all_first", [True, False], ids=["all-first", "all-last"])
    def test_all_members_still_names_a_requirement_that_grades_no_one(
        self, no_one, reason, all_first
    ):
        everyone = _req("All", applies_to_all=True)
        admin = _req("Admin", types=["administrative"])
        ordered = [everyone, no_one, admin] if all_first else [admin, no_one, everyone]

        tiers = mandatory_tiers_for_requirements(ordered, DEFAULT_LADDER)

        assert (tiers.everyone, tiers.tier_ids) == (True, [])
        assert tiers.unmapped == [
            UnmappedRequirement("req-empty", "Empty", reason, applies_to_no_one=True)
        ]

    # Only a requirement that grades no one says so: one whose members no
    # tier stands for still grades them, and the form offers All members.
    def test_a_requirement_no_tier_stands_for_still_grades_someone(self):
        tiers = mandatory_tiers_for_requirements(
            [_req("Admin", types=["administrative"]), _req("Ranks", roles=["captain"])],
            DEFAULT_LADDER,
        )

        assert [u.applies_to_no_one for u in tiers.unmapped] == [False, False]

    def test_several_requirements_union_in_ladder_order(self):
        tiers = mandatory_tiers_for_requirements(
            [_req("A", types=["life", "active"]), _req("B", types=["active"])],
            DEFAULT_LADDER,
        )

        assert tiers.tier_ids == ["active", "life"]

    def test_a_training_exempt_tier_is_not_left_out(self):
        # The requirement rule never reads training_exempt, so the
        # projection must not either: life is exempt on the default ladder.
        tiers = mandatory_tiers_for_requirements([_req(types=["life"])], DEFAULT_LADDER)

        assert tiers.tier_ids == ["life"]


class TestTheSources:
    """Which requirements the note credits with the suggestion.

    A requirement can map partly: some of its member types stand on a tier
    and another does not. It is still a source of the tiers it contributed,
    so the form must not read "named in unmapped" as "contributed nothing".
    """

    def test_a_partly_mapped_requirement_is_a_source_of_its_tiers(self):
        tiers = mandatory_tiers_for_requirements(
            [
                _req("A", types=["probationary", "honorary"]),
                _req("B", types=["active"]),
            ],
            ["active", "probationary", "life"],
        )

        assert tiers.tier_ids == ["active", "probationary"]
        assert [u.requirement_id for u in tiers.unmapped] == ["req-a"]
        assert tiers.source_ids == ["req-a", "req-b"]

    def test_a_requirement_that_maps_to_no_tier_is_no_source(self):
        tiers = mandatory_tiers_for_requirements(
            [
                _req("Admin", types=["administrative"]),
                _req("Ranks", roles=["captain"]),
                _req("Empty"),
                _req("B", types=["active"]),
            ],
            DEFAULT_LADDER,
        )

        assert tiers.source_ids == ["req-b"]

    # All members stands for every requirement that grades someone, whether a
    # tier stands for its members or not; one that grades no one is not.
    def test_all_members_is_sourced_by_every_requirement_that_grades_someone(self):
        tiers = mandatory_tiers_for_requirements(
            [
                _req("Admin", types=["administrative"]),
                _req("Empty"),
                _req("All", applies_to_all=True),
                _req("Retired", active=False, applies_to_all=True),
            ],
            DEFAULT_LADDER,
        )

        assert tiers.everyone is True
        assert tiers.source_ids == ["req-admin", "req-all"]
