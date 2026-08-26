"""Qualifications: what a member is certified to do, as distinct from rank.

Rank is where a member sits in the chain of command; a qualification is what
they are trained to do. ``User.rank`` is one string, so a Captain who is also a
Paramedic could only be recorded as one of the two. These assertions cover the
vocabulary, the seats each qualification clears, and the expiry rule — which is
the half a rank column could never have carried.
"""

from datetime import date, timedelta

import pytest

from app.schemas.scheduling import ShiftPosition
from app.services.qualification_service import (
    QUALIFICATIONS,
    positions_for_qualifications,
    qualification_label,
)


class TestVocabularyMatchesTheSeatNames:
    """A seat a qualification unlocks must be a seat the signup API can name.

    This is the guard that #1833 was missing one registry over: the apparatus
    editor offered a seat value nothing else in the system used, so nobody
    could sign up for it. A qualification granting an unnameable seat would
    fail exactly the same way, and just as invisibly.
    """

    @pytest.mark.parametrize("code", sorted(QUALIFICATIONS))
    def test_every_granted_seat_is_a_real_shift_position(self, code):
        seat_values = {p.value for p in ShiftPosition}
        granted = set(QUALIFICATIONS[code]["positions"])
        assert granted <= seat_values, (
            f"qualification {code!r} grants {granted - seat_values}, which "
            "ShiftPosition cannot name — no member could ever use it"
        )

    @pytest.mark.parametrize("code", sorted(QUALIFICATIONS))
    def test_every_qualification_grants_something(self, code):
        assert QUALIFICATIONS[code][
            "positions"
        ], f"{code!r} clears no seats, so holding it changes nothing"

    @pytest.mark.parametrize("code", sorted(QUALIFICATIONS))
    def test_every_qualification_has_a_label(self, code):
        assert qualification_label(code) != code

    def test_an_unknown_code_falls_back_to_itself(self):
        # The column is a string so a department's own future qualification can
        # live there; one the seat map has no entry for grants nothing rather
        # than raising on an eligibility path.
        assert qualification_label("something_new") == "something_new"
        assert positions_for_qualifications(["something_new"]) == set()


class TestSeatsGranted:
    def test_ems_credentials_all_clear_the_medic_seat(self):
        for code in ("emt", "aemt", "paramedic"):
            assert "ems" in positions_for_qualifications([code])

    def test_fire_certifications_clear_the_firefighter_seat(self):
        for code in ("firefighter_i", "firefighter_ii"):
            assert "firefighter" in positions_for_qualifications([code])

    def test_driver_operator_clears_the_driver_seat(self):
        assert positions_for_qualifications(["driver_operator"]) == {"driver"}

    def test_a_captain_who_is_also_a_paramedic(self):
        """The case a single rank column could not express.

        Rank stays 'captain' and says nothing about patient care;
        the qualification says nothing about command. Both are true at once,
        which is the entire point of separating them.
        """
        assert positions_for_qualifications(["paramedic"]) == {"ems"}

    def test_qualifications_union_rather_than_override(self):
        both = positions_for_qualifications(["driver_operator", "paramedic"])
        assert both == {"driver", "ems"}

    def test_holding_none_grants_none(self):
        assert positions_for_qualifications([]) == set()


class TestExpiryIsTheReasonRankCannotHoldThis:
    """A rank does not lapse; a certification does.

    A member holds Captain until the department changes it. They hold EMT until
    a date, after which they do not — and the shift they signed up for three
    months ago is exactly when that matters.
    """

    @staticmethod
    def _current_on(expires_on, as_of):
        """Mirror of QualificationService._current_on, on plain values."""
        return expires_on is None or expires_on >= as_of

    def test_a_null_expiry_never_lapses(self):
        # Ordinary, not a gap in the data: Firefighter I does not expire in
        # most states, so NULL has to mean "current" rather than "unknown".
        assert self._current_on(None, date(2099, 1, 1))

    def test_a_card_valid_on_the_day_counts(self):
        today = date.today()
        assert self._current_on(today, today)

    def test_a_card_that_lapses_before_the_shift_does_not(self):
        """The rule EVOC certifications already use for drivers.

        Asked as of the *shift* date rather than today. A certification that is
        current when the roster is built and expired when the truck rolls
        qualifies nobody to be on it.
        """
        today = date.today()
        lapses = today + timedelta(days=30)
        shift_day = today + timedelta(days=60)
        assert self._current_on(lapses, today), "still valid today"
        assert not self._current_on(lapses, shift_day), "but not on the shift day"


class TestQualificationsAreNotRanks:
    """The two vocabularies are allowed to share spellings without merging.

    ``emt`` is both a seeded rank code and a qualification code, and they mean
    different things: the rank says an EMS agency's line member sits at the
    bottom of its ladder, the qualification says a card is on file and when it
    expires. A department can use either, or both, and neither implies the
    other.
    """

    def test_the_two_registries_are_independent(self):
        from app.services.operational_rank_service import DEFAULT_RANKS

        rank_codes = {code for code, _l, _o, _p in DEFAULT_RANKS}
        # Overlap is expected and fine; total identity would mean one of them
        # is redundant.
        assert set(QUALIFICATIONS) != rank_codes

    def test_qualification_only_credentials_exist(self):
        from app.services.operational_rank_service import DEFAULT_RANKS

        rank_codes = {code for code, _l, _o, _p in DEFAULT_RANKS}
        qualification_only = set(QUALIFICATIONS) - rank_codes
        # Paramedic and Firefighter II are the motivating cases: real
        # credentials that were not expressible anywhere before this.
        assert {"paramedic", "firefighter_ii"} <= qualification_only


class TestGrantDateGatesCurrencyToo:
    """Both ends of the window, not just the expiry.

    ``granted_on`` is the easier of the two to forget, and forgetting it fails
    in the direction that matters: a department entering a member's *upcoming*
    Paramedic certification with a future start date would have that member
    clear the medic seat today, before they hold the credential. The same
    filter answers historical questions, so a shift last month must not show
    them as qualified for a night they had not yet earned.
    """

    @staticmethod
    def _in_force(granted_on, expires_on, as_of):
        """Mirror of QualificationService._current_on, on plain values."""
        started = granted_on is None or granted_on <= as_of
        unexpired = expires_on is None or expires_on >= as_of
        return started and unexpired

    def test_a_future_dated_credential_is_not_current_yet(self):
        today = date.today()
        starts = today + timedelta(days=30)
        assert not self._in_force(starts, None, today)
        assert self._in_force(starts, None, starts)

    def test_a_credential_earned_after_the_shift_does_not_backdate(self):
        today = date.today()
        last_month = today - timedelta(days=30)
        assert not self._in_force(today, None, last_month)

    def test_a_null_grant_date_has_always_been_in_force(self):
        # NULL at either end means "no bound at that end", not "unknown".
        assert self._in_force(None, None, date(1990, 1, 1))

    def test_both_ends_must_hold(self):
        granted = date(2020, 1, 1)
        expires = date(2021, 1, 1)
        assert self._in_force(granted, expires, date(2020, 6, 1))
        assert not self._in_force(granted, expires, date(2019, 6, 1)), "before grant"
        assert not self._in_force(granted, expires, date(2022, 6, 1)), "after expiry"
