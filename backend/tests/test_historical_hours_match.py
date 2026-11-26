"""Pairing roster sign-ups with hours entries: the pure rules.

Agreed with the department (2026-11-21): the roster and the hours file share
no id, so a sign-up is the hours entry of the same member whose time it
overlaps most, by at least 30 minutes; one entry pairs with one sign-up, the
larger overlap winning; an event's title is written as a position only when it
is a crew seat.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services.historical_hours_match import (
    MIN_OVERLAP,
    HoursEntry,
    SignUp,
    crew_seat_for,
    match,
)

pytestmark = pytest.mark.unit

DAY = datetime(2016, 5, 2, tzinfo=timezone.utc)


def _at(hour: float) -> datetime:
    return DAY + timedelta(hours=hour)


def _signup(key, user, start, end):
    return SignUp(key, user, _at(start), _at(end))


def _entry(att_id, user, start, end, shift="shift-1"):
    return HoursEntry(att_id, shift, user, _at(start), _at(end))


class TestPairing:
    def test_a_sign_up_pairs_with_its_members_overlapping_entry(self):
        result = match(
            [_signup("s1", "alice", 12, 22)],
            [_entry("a1", "alice", 12.5, 22), _entry("b1", "bob", 12, 22)],
        )

        assert {k: e.attendance_id for k, e in result.matched.items()} == {"s1": "a1"}
        assert result.unmatched_signups == []
        assert [e.attendance_id for e in result.unmatched_hours] == ["b1"]

    def test_the_largest_overlap_wins_among_a_members_entries(self):
        result = match(
            [_signup("s1", "alice", 12, 22)],
            [_entry("short", "alice", 21, 23), _entry("long", "alice", 11, 20)],
        )

        assert result.matched["s1"].attendance_id == "long"

    def test_an_overlap_under_the_minimum_does_not_pair(self):
        minutes = MIN_OVERLAP.total_seconds() / 3600
        result = match(
            [_signup("s1", "alice", 12, 22)],
            [_entry("a1", "alice", 22 - minutes + 1 / 60, 30)],
        )

        assert result.matched == {}
        assert result.unmatched_signups == ["s1"]

    def test_exactly_the_minimum_pairs(self):
        minutes = MIN_OVERLAP.total_seconds() / 3600
        result = match(
            [_signup("s1", "alice", 12, 22)],
            [_entry("a1", "alice", 22 - minutes, 30)],
        )

        assert result.matched["s1"].attendance_id == "a1"

    def test_one_entry_goes_to_the_sign_up_it_overlaps_more(self):
        # Two of Alice's sign-ups touch one twelve-hour entry; the one sharing
        # more of it takes it whatever order the roster lists them in.
        signups = [_signup("small", "alice", 7, 9), _signup("big", "alice", 8, 20)]
        entries = [_entry("a1", "alice", 8, 20)]

        for ordered in (signups, list(reversed(signups))):
            result = match(ordered, entries)
            assert result.matched["big"].attendance_id == "a1"
            assert result.unmatched_signups == ["small"]

    def test_an_overnight_pairs_across_midnight(self):
        result = match(
            [_signup("night", "alice", 23, 35)],
            [_entry("a1", "alice", 23.25, 34.5)],
        )

        assert result.matched["night"].attendance_id == "a1"

    def test_equal_overlaps_pair_the_same_way_every_time(self):
        signups = [_signup("s2", "alice", 8, 12), _signup("s1", "alice", 8, 12)]
        entries = [_entry("a1", "alice", 8, 12)]

        assert match(signups, entries).matched["s1"].attendance_id == "a1"
        assert match(list(reversed(signups)), entries).unmatched_signups == ["s2"]

    def test_nothing_to_pair_is_empty(self):
        result = match([], [])

        assert (result.matched, result.unmatched_signups, result.unmatched_hours) == (
            {},
            [],
            [],
        )


class TestAReviewersPairs:
    """A reviewer may pair a seat with an hours entry by hand (owner
    decisions, 2026-11-26): the pin wins whatever the overlap, but only for
    the seat's own member, and only while both sides still exist."""

    def test_a_pin_pairs_what_no_overlap_would(self):
        result = match(
            [_signup("s1", "alice", 19, 31)],
            [_entry("a1", "alice", 4, 8)],
            pinned={"s1": "a1"},
        )

        assert result.matched["s1"].attendance_id == "a1"
        assert result.pinned == {"s1"}
        assert result.unmatched_hours == []

    def test_a_pin_takes_the_entry_before_a_larger_overlap_can(self):
        result = match(
            [_signup("s1", "alice", 12, 22), _signup("s2", "alice", 12, 22)],
            [_entry("a1", "alice", 12, 22)],
            pinned={"s2": "a1"},
        )

        assert result.matched["s2"].attendance_id == "a1"
        assert result.unmatched_signups == ["s1"]

    def test_a_pin_on_another_members_hours_pairs_nothing(self):
        result = match(
            [_signup("s1", "alice", 12, 22)],
            [_entry("b1", "bob", 12, 22)],
            pinned={"s1": "b1"},
        )

        assert result.matched == {}
        assert result.pinned == set()

    def test_a_pin_naming_an_entry_that_is_gone_falls_back_to_overlap(self):
        result = match(
            [_signup("s1", "alice", 12, 22)],
            [_entry("a2", "alice", 12, 22)],
            pinned={"s1": "deleted"},
        )

        assert result.matched["s1"].attendance_id == "a2"
        assert result.pinned == set()


class TestCrewSeatForAnEventTitle:
    @pytest.mark.parametrize(
        ("title", "seat"),
        [
            ("Driver", "driver"),
            (" EMT ", "ems"),
            ("officer", "officer"),
        ],
    )
    def test_a_built_in_seat_is_its_value(self, title, seat):
        assert crew_seat_for(title, []) == seat

    def test_a_department_seat_comes_back_in_the_departments_spelling(self):
        assert crew_seat_for("pump operator", ["Pump Operator"]) == "Pump Operator"

    @pytest.mark.parametrize("title", ["Educator", "Party Staff", "", "   "])
    def test_a_role_that_is_not_a_seat_is_none(self, title):
        assert crew_seat_for(title, ["Pump Operator"]) is None
