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
):
    return SimpleNamespace(
        id=f"req-{name.lower()}",
        name=name,
        applies_to_all=applies_to_all,
        required_membership_types=types,
        required_roles=roles,
        required_positions=positions,
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
                f"{word.capitalize()} is a member class, not a membership tier",
            )
        ]

    def test_a_word_with_no_tier_on_the_ladder_is_named(self):
        tiers = mandatory_tiers_for_requirements(
            [_req("Retirees", types=["retired"])], DEFAULT_LADDER
        )

        assert tiers.tier_ids == []
        assert tiers.unmapped == [
            UnmappedRequirement(
                "req-retirees", "Retirees", "No membership tier stands for retired"
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
            "It applies by rank or position, not membership"
        ]

    def test_membership_types_win_over_ranks_as_the_grader_reads_them(self):
        tiers = mandatory_tiers_for_requirements(
            [_req(types=["life"], roles=["captain"])], DEFAULT_LADDER
        )

        assert (tiers.tier_ids, tiers.unmapped) == (["life"], [])

    def test_a_requirement_naming_nobody_contributes_nothing(self):
        tiers = mandatory_tiers_for_requirements([_req()], DEFAULT_LADDER)

        assert (tiers.everyone, tiers.tier_ids, tiers.unmapped) == (False, [], [])

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
