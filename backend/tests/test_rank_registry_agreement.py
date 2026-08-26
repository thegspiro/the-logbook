"""The rank a department is given must be a rank the system understands.

Three lists described operational ranks, and they had drifted apart:

* ``DEFAULT_RANKS`` (``operational_rank_service``) — the rows written into
  ``operational_ranks`` for a new organization. What a department *sees*.
* ``OPERATIONAL_RANKS`` (``core.permissions``) — the registry
  ``get_rank_default_permissions`` resolves against. What a rank *does*.
* ``OPERATIONAL_ROLE_SLUGS`` (``core.constants``) — a third vocabulary that
  agreed with neither and was read by nothing. Deleted 2026-08-26.

``emt`` was seeded by the first and absent from the second, so it appeared in
the rank picker like any other rank and conferred nothing. A member whose only
standing was EMT held no permissions at all, and unlike Firefighter there is
no mirroring entry in ``DEFAULT_POSITIONS`` to make up the difference.

The failure mode is silent in both directions, which is why it survived: a
rank that grants nothing looks identical in the UI to one that grants
everything it should, and the drift shows up only as a member quietly unable
to see anything.

These assertions are the pair that would have caught it.
"""

import pytest

from app.core.permissions import (
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
    get_rank_default_permissions,
)
from app.services.operational_rank_service import DEFAULT_RANKS

SEEDED_CODES = tuple(code for code, _label, _order, _positions in DEFAULT_RANKS)


class TestSeedAndRegistryAgree:
    @pytest.mark.parametrize("code", SEEDED_CODES)
    def test_every_seeded_rank_resolves_to_permissions(self, code):
        """A rank a department is handed at onboarding must confer something.

        Zero grants is never a deliberate answer for a seeded rank: the rank
        picker offers it, an officer assigns it, and the member silently holds
        nothing.
        """
        granted = get_rank_default_permissions(code)
        assert granted, (
            f"rank {code!r} is seeded into every new organization's rank list "
            "but resolves to no permissions — it will be offered in the rank "
            "picker and confer nothing"
        )

    @pytest.mark.parametrize("code", sorted(OPERATIONAL_RANKS))
    def test_every_registry_rank_is_actually_seeded(self, code):
        """The reverse drift: grants defined for a rank nobody is given.

        Harmless on its own, but it is how the registry comes to disagree with
        the seed without anyone noticing in either direction.
        """
        assert code in SEEDED_CODES, (
            f"rank {code!r} carries default permissions but is not in "
            "DEFAULT_RANKS, so no organization is ever seeded with it"
        )

    def test_the_two_lists_are_the_same_set(self):
        assert set(SEEDED_CODES) == set(OPERATIONAL_RANKS)


class TestLineMemberRanksMatch:
    """Firefighter and EMT are one standing on the permission axis.

    They differ in discipline, not in what they may see. Splitting them was
    how EMT came to hold nothing, so the equality is asserted rather than left
    to the shared list object — an edit that stops them aliasing should have to
    say so here.
    """

    def test_emt_and_firefighter_grant_the_same_set(self):
        assert set(get_rank_default_permissions("emt")) == set(
            get_rank_default_permissions("firefighter")
        )

    def test_emt_grants_no_management(self):
        manage = sorted(
            p for p in get_rank_default_permissions("emt") if p.endswith(".manage")
        )
        assert manage == [], f"the EMT rank would hold management grants: {manage}"


class TestRankCodesAreNotPositionSlugs:
    """A rank code and a position slug are different namespaces.

    Where they overlap it is deliberate and load-bearing: onboarding writes a
    system position mirroring the rank's grants, and
    ``DEFAULT_POSITIONS[slug]["permissions"]`` *is* the rank's list object
    (CLAUDE.md pitfall #23). Where they do not overlap, the rank stands alone
    and nothing else supplies its grants — which is exactly the case that made
    the EMT gap invisible, since every other seeded rank had a position
    backstop.
    """

    def test_a_mirroring_position_carries_the_ranks_own_list(self):
        mirrored = [c for c in SEEDED_CODES if c in DEFAULT_POSITIONS]
        assert mirrored, "expected at least one rank mirrored as a position"
        for code in mirrored:
            assert (
                DEFAULT_POSITIONS[code]["permissions"]
                is OPERATIONAL_RANKS[code]["default_permissions"]
            ), (
                f"position {code!r} no longer aliases the rank's list; a "
                "seeded-grant change now needs a migration for both (pitfall #23)"
            )

    def test_a_rank_without_a_position_still_grants_on_its_own(self):
        standalone = [c for c in SEEDED_CODES if c not in DEFAULT_POSITIONS]
        for code in standalone:
            assert get_rank_default_permissions(code), (
                f"rank {code!r} has no mirroring position, so the registry is "
                "the only thing that can grant it anything — and it grants none"
            )


def test_the_dead_role_slug_constants_stay_deleted():
    """``OPERATIONAL_ROLE_SLUGS`` read as a third authority and was read by none.

    It listed ``chief`` where the seed says ``fire_chief``, and offered
    ``driver`` and ``paramedic``, which are not ranks at all. Reintroducing a
    vocabulary nothing consults is how the drift above started.
    """
    import app.core.constants as constants

    for name in ("OPERATIONAL_ROLE_SLUGS", "ADMINISTRATIVE_ROLE_SLUGS"):
        assert not hasattr(constants, name), (
            f"{name} is back in core.constants. It is a third rank/position "
            "vocabulary that agrees with neither DEFAULT_RANKS nor "
            "DEFAULT_POSITIONS; resolve against those instead."
        )
