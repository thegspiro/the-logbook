"""Member class and status, and the legacy field they replace.

``membership_type`` held two independent facts in one column — what kind of
member somebody is, and where they sit on the membership ladder — so neither
could be stated without losing the other. These assertions cover the split, the
derivation back to the legacy field that ~160 call sites still read, and the
one behaviour the fusion was actively getting wrong.
"""

import pytest

from app.utils.membership import (
    DEFAULT_CLASS,
    DEFAULT_STATUS,
    MemberClass,
    MemberStatus,
    derive_membership_type,
    is_operational,
    split_membership_type,
)

LEGACY_VALUES = (
    "prospective",
    "probationary",
    "active",
    "life",
    "retired",
    "administrative",
    "honorary",
)


class TestSplitAndDerive:
    @pytest.mark.parametrize("legacy", LEGACY_VALUES)
    def test_every_legacy_value_round_trips(self, legacy):
        """The split loses nothing the legacy vocabulary could express.

        Lossy in the *other* direction is fine and expected — that is the point
        of the change — but a value that exists today must survive being split
        and put back, or upgrading would silently reclassify live members.
        """
        member_class, member_status = split_membership_type(legacy)
        assert derive_membership_type(member_class, member_status) == legacy

    @pytest.mark.parametrize("legacy", LEGACY_VALUES)
    def test_split_produces_known_values(self, legacy):
        member_class, member_status = split_membership_type(legacy)
        assert member_class in MemberClass.ALL
        assert member_status in MemberStatus.ALL

    @pytest.mark.parametrize("junk", [None, "", "   ", "not_a_membership_type"])
    def test_unknown_values_land_on_the_default(self, junk):
        # The column is a free string with no enum constraint, so unrecognised
        # values genuinely occur and must not raise on a login path.
        assert split_membership_type(junk) == (DEFAULT_CLASS, DEFAULT_STATUS)

    def test_case_and_whitespace_are_tolerated(self):
        assert split_membership_type("  Administrative ") == (
            MemberClass.ADMINISTRATIVE,
            MemberStatus.REGULAR,
        )


class TestShapesTheLegacyFieldCouldNotHold:
    """The three standings that had nowhere to live, and what they collapse to.

    Each derives to *something* — the legacy column is NOT NULL in practice and
    every existing gate reads it — but the derived value is deliberately
    lossier than the pair. The pair is the authority.
    """

    def test_a_probationary_treasurer(self):
        legacy = derive_membership_type(
            MemberClass.ADMINISTRATIVE, MemberStatus.PROBATIONARY
        )
        assert legacy == "administrative"

    def test_a_junior_operational_member(self):
        # No legacy word for "junior". "probationary" is the closest value
        # every existing gate already treats as limited.
        assert (
            derive_membership_type(MemberClass.OPERATIONAL, MemberStatus.JUNIOR)
            == "probationary"
        )

    def test_a_social_member_at_any_status(self):
        # Every social status is non-riding, which is the one thing the legacy
        # value is used for.
        for status in MemberStatus.ALL:
            assert derive_membership_type(MemberClass.SOCIAL, status) == "honorary"


class TestHonoraryStaysNonRiding:
    """Mapping honorary anywhere but `social` would widen access on upgrade.

    ``honorary`` sits in ``DEFAULT_EXCLUDED_MEMBERSHIP_TYPES`` beside
    administrative and retired, so an honorary member has never been able to
    self-sign up for a shift. The class it backfills to has to preserve that.
    """

    def test_honorary_splits_to_the_social_class(self):
        member_class, _status = split_membership_type("honorary")
        assert member_class == MemberClass.SOCIAL

    def test_honorary_is_not_operational(self):
        member_class, _status = split_membership_type("honorary")
        assert not is_operational(member_class)

    def test_the_derived_value_stays_in_the_exclusion_list(self):
        from app.services.shift_eligibility_service import (
            DEFAULT_EXCLUDED_MEMBERSHIP_TYPES,
        )

        derived = derive_membership_type(MemberClass.SOCIAL, MemberStatus.HONORARY)
        assert derived in DEFAULT_EXCLUDED_MEMBERSHIP_TYPES


class TestOperationalIsAClassNotAStatus:
    """The bug the fusion was causing, stated directly.

    ``ElectionService`` could only answer "is this member operational" as
    ``membership_type == "active"``, because that was the only value that meant
    it. Every probationary, life and retired member — all of them operational —
    fell outside a category that plainly includes them, and the same helper
    decides who receives a ballot.
    """

    @pytest.mark.parametrize(
        "legacy",
        ["active", "life", "probationary", "retired", "prospective"],
    )
    def test_every_operational_standing_is_operational(self, legacy):
        member_class, _status = split_membership_type(legacy)
        assert is_operational(member_class), (
            f"a member with membership_type={legacy!r} is on the operational "
            "side of the house whatever their status"
        )

    @pytest.mark.parametrize("legacy", ["administrative", "honorary"])
    def test_non_operational_standings_are_not(self, legacy):
        member_class, _status = split_membership_type(legacy)
        assert not is_operational(member_class)

    def test_life_members_were_the_ones_being_missed(self):
        # Named on its own because it is the case a department would notice:
        # a bylaws question put to "operational" members that never reached
        # anyone who had earned life membership.
        member_class, member_status = split_membership_type("life")
        assert is_operational(member_class)
        assert member_status == MemberStatus.LIFE
