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

    @pytest.mark.parametrize("blank", [None, "", "   "])
    def test_a_blank_value_takes_the_column_default(self, blank):
        # Nothing recorded means the column default ("active"), which is a
        # regular operational member.
        assert split_membership_type(blank) == (DEFAULT_CLASS, DEFAULT_STATUS)

    def test_an_unrecognised_value_is_left_unclassified(self):
        # Not the same as blank, and the difference matters — see
        # TestCustomTiersAreNotPromoted. The column is a free string that also
        # holds membership tier ids, so unrecognised values genuinely occur;
        # they must not raise on a login path, and must not be guessed at.
        assert split_membership_type("not_a_membership_type") == (None, None)

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


class TestCustomTiersAreNotPromoted:
    """``membership_type`` also stores org-configurable membership **tier ids**.

    ``POST /member-status/{id}/tier`` validates the id against
    ``organization.settings["membership_tiers"]`` and writes it straight into
    this column, and the shipped defaults already include ``senior``. So the
    column's contents are not limited to the seven legacy values, and never
    were.

    Defaulting an unrecognised value to a regular operational member would
    enrol every one of those tiers in categories they were never in: a Senior
    Member satisfied neither an "operational" ballot restriction (which meant
    ``== "active"``) nor a "regular" one (``in (active, life)``). Promoting
    them silently widens the electorate of any ballot restricted to either.
    """

    @pytest.mark.parametrize(
        "tier_id", ["senior", "associate", "cadet", "social", "exempt"]
    )
    def test_an_unknown_tier_resolves_to_no_class_and_no_status(self, tier_id):
        assert split_membership_type(tier_id) == (None, None)

    @pytest.mark.parametrize("tier_id", ["senior", "associate", "cadet"])
    def test_an_unknown_tier_is_not_operational(self, tier_id):
        member_class, _status = split_membership_type(tier_id)
        assert not is_operational(member_class), (
            f"tier {tier_id!r} would be enrolled in the operational body it "
            "was never part of"
        )

    def test_senior_is_a_shipped_default_tier(self):
        """Named explicitly because it is not hypothetical.

        If the default tier list stops containing 'senior' this assertion
        should be revisited rather than deleted — the point is that real,
        shipped configuration puts non-legacy values in this column.
        """
        from app.schemas.organization import MembershipTierSettings

        tier_ids = {tier.id for tier in MembershipTierSettings().tiers}
        assert "senior" in tier_ids
        assert split_membership_type("senior") == (None, None)

    def test_an_empty_value_still_takes_the_default(self):
        # Different case: nothing recorded means the column default ("active"),
        # which is a regular operational member. Only *unrecognised* values are
        # left unclassified.
        assert split_membership_type(None) == (DEFAULT_CLASS, DEFAULT_STATUS)
        assert split_membership_type("") == (DEFAULT_CLASS, DEFAULT_STATUS)

    def test_is_operational_does_not_default_an_unset_class(self):
        # The guard one layer down: defaulting here would reintroduce the
        # widening the split above exists to prevent.
        assert is_operational(None) is False
        assert is_operational("") is False


class TestApplyingACustomTierKeepsTheClass:
    """The split refuses to guess a class for an unrecognised tier — and the
    flush reconciler used to write that refusal into the row, erasing the
    class the member already had.

    Nothing downstream could then answer "does this member ride?" A rule that
    read the silence as *no* dropped every senior firefighter off the
    schedule; one that read it as *yes* handed an open-to-all shift's every
    seat to whatever tier a department had configured, including one meant for
    members who do not ride. Refusing to guess is not the same as forgetting.
    """

    @staticmethod
    def _reconciled(**changes):
        """Run the flush listener over an existing member, then *change* them.

        The standing is installed with ``set_committed_value`` — as loaded from
        the database, carrying no history — because the listener branches on
        which side of the pair the caller wrote. Passing it to the constructor
        instead records every field as freshly set, which is a different case:
        the class wins and derives the legacy value, rather than the tier
        change this covers.
        """
        from sqlalchemy.orm.attributes import set_committed_value

        from app.models.user import User, _reconcile_membership

        member = User(
            organization_id="org-1",
            username="pat",
            email="pat@fd.test",
            password_hash="x",
        )
        set_committed_value(member, "membership_type", "active")
        set_committed_value(member, "member_class", MemberClass.OPERATIONAL)
        set_committed_value(member, "member_status", MemberStatus.REGULAR)
        for field, value in changes.items():
            setattr(member, field, value)
        _reconcile_membership(None, None, member)
        return member

    def test_a_senior_firefighter_stays_operational(self):
        member = self._reconciled(membership_type="senior")

        assert member.member_class == MemberClass.OPERATIONAL
        assert member.member_status == MemberStatus.REGULAR
        assert member.membership_type == "senior"

    def test_a_recognised_value_still_overwrites(self):
        """Preserving is only for the case the split cannot answer."""
        member = self._reconciled(membership_type="administrative")

        assert member.member_class == MemberClass.ADMINISTRATIVE

    def test_a_row_that_never_had_a_class_still_has_none(self):
        """No invention: a legacy row carrying a custom tier and no class has
        nothing to preserve, and guessing one is the widening the split
        refuses to make. Callers treat it as not established."""
        from app.models.user import User, _reconcile_membership

        member = User(
            organization_id="org-1",
            username="pat",
            email="pat@fd.test",
            password_hash="x",
        )
        member.membership_type = "support-tier"
        _reconcile_membership(None, None, member)

        assert member.member_class is None
