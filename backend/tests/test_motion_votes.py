"""Counting a vote and what the count says, with no database.

The suggested result follows the threshold the motion was made under; the
secretary's recorded status is separate and is never computed here.
"""

from types import SimpleNamespace

import pytest

from app.utils.minutes_snapshot import _vote_detail
from app.utils.motion_votes import (
    members_present,
    settle_roll_call,
    suggested_status,
    tally,
    vote_summary,
)

pytestmark = [pytest.mark.unit]

ROLL = [
    {"user_id": "u1", "name": "Pat Chief", "status": "present"},
    {"user_id": "u2", "name": "Lee Treasurer", "status": "late"},
    {"user_id": None, "name": "A visitor", "status": "guest"},
    {"user_id": "u3", "name": "Sam Absent", "status": "absent"},
    {"user_id": "u4", "name": "Max Early", "status": "left_early"},
]


class TestTally:
    def test_each_kind_of_vote_is_counted(self):
        votes = [
            {"vote": "yes"},
            {"vote": "yes"},
            {"vote": "no"},
            {"vote": "abstain"},
            {"vote": "recuse"},
            {"vote": "recuse"},
        ]
        assert tally(votes) == {
            "votes_for": 2,
            "votes_against": 1,
            "votes_abstain": 1,
            "votes_recused": 2,
        }

    def test_an_empty_roll_call_counts_nothing(self):
        assert tally([]) == {
            "votes_for": 0,
            "votes_against": 0,
            "votes_abstain": 0,
            "votes_recused": 0,
        }


class TestSuggestedStatus:
    def test_a_majority_of_the_votes_cast_is_the_default(self):
        assert suggested_status(None, 5, 4, 20) == "passed"
        assert suggested_status("majority_cast", 4, 5, 20) == "failed"

    def test_a_tie_fails(self):
        assert suggested_status("majority_cast", 3, 3, 10) == "failed"

    def test_abstentions_are_not_votes_cast(self):
        assert suggested_status("majority_cast", 2, 1, 30) == "passed"

    def test_a_majority_of_those_present_counts_abstentions_against(self):
        assert suggested_status("majority_present", 5, 0, 10) == "failed"
        assert suggested_status("majority_present", 6, 4, 10) == "passed"
        assert suggested_status("majority_present", 5, 0, 9) == "passed"

    def test_two_thirds_of_the_votes_cast(self):
        assert suggested_status("two_thirds", 6, 3, 20) == "passed"
        assert suggested_status("two_thirds", 5, 3, 20) == "failed"
        assert suggested_status("two_thirds", 4, 0, 20) == "passed"

    def test_two_thirds_with_no_votes_cast_does_not_pass(self):
        assert suggested_status("two_thirds", 0, 0, 20) == "failed"

    def test_no_count_means_no_suggestion(self):
        assert suggested_status("two_thirds", None, None, 20) is None

    def test_an_unknown_threshold_reads_as_the_default(self):
        assert suggested_status("nonsense", 3, 2, 10) == "passed"


class TestMembersPresent:
    def test_only_those_in_the_room_are_counted(self):
        assert members_present(ROLL) == 3

    def test_no_roll_is_nobody(self):
        assert members_present(None) == 0


class TestSettleRollCall:
    def test_the_member_id_comes_from_the_roll_not_the_request(self):
        settled = settle_roll_call(
            [{"name": "Pat Chief", "vote": "yes", "user_id": "someone-else"}], ROLL
        )
        assert settled == [{"user_id": "u1", "name": "Pat Chief", "vote": "yes"}]

    def test_someone_not_recorded_present_cannot_vote(self):
        for name in ("Sam Absent", "A visitor", "Nobody At All"):
            with pytest.raises(ValueError, match="not recorded as present"):
                settle_roll_call([{"name": name, "vote": "yes"}], ROLL)

    def test_a_member_votes_once(self):
        with pytest.raises(ValueError, match="twice"):
            settle_roll_call(
                [
                    {"name": "Pat Chief", "vote": "yes"},
                    {"name": "Pat Chief", "vote": "no"},
                ],
                ROLL,
            )

    def test_the_vote_must_be_one_of_the_four(self):
        with pytest.raises(ValueError, match="yes, no, abstain or recuse"):
            settle_roll_call([{"name": "Pat Chief", "vote": "maybe"}], ROLL)

    def test_members_who_left_early_and_arrived_late_may_vote(self):
        settled = settle_roll_call(
            [
                {"name": "Lee Treasurer", "vote": "no"},
                {"name": "Max Early", "vote": "abstain"},
            ],
            ROLL,
        )
        assert [s["user_id"] for s in settled] == ["u2", "u4"]

    def test_names_are_matched_after_trimming(self):
        assert (
            settle_roll_call([{"name": " Pat Chief ", "vote": "yes"}], ROLL)[0]["name"]
            == "Pat Chief"
        )


def _motion(**fields):
    base = dict(
        votes_for=None,
        votes_against=None,
        votes_abstain=None,
        votes_recused=None,
        threshold=None,
        roll_call=None,
    )
    base.update(fields)
    return SimpleNamespace(**base)


class TestVoteSummary:
    def test_totals_only(self):
        assert vote_summary(_motion(votes_for=7, votes_against=2)) == "Vote 7-2"

    def test_abstentions_and_recusals_are_stated(self):
        text = vote_summary(
            _motion(votes_for=7, votes_against=2, votes_abstain=1, votes_recused=1)
        )
        assert text == "Vote 7-2 (1 abstain, 1 recused)"

    def test_a_stricter_threshold_is_stated(self):
        text = vote_summary(
            _motion(votes_for=6, votes_against=3, threshold="two_thirds")
        )
        assert text == "Vote 6-3 (two-thirds of votes cast required)"

    def test_the_default_threshold_is_not_repeated_on_every_motion(self):
        assert "required" not in vote_summary(
            _motion(votes_for=3, votes_against=1, threshold="majority_cast")
        )

    def test_a_voice_vote_has_no_summary(self):
        assert vote_summary(_motion()) == ""

    def test_no_names_ever_reach_the_printed_summary(self):
        text = vote_summary(
            _motion(
                votes_for=1,
                roll_call=[{"name": "Pat Chief", "user_id": "u1", "vote": "yes"}],
            )
        )
        assert "Pat" not in text


class TestSealedDetail:
    def test_only_what_was_recorded_is_sealed(self):
        assert _vote_detail(_motion()) == {}

    def test_recorded_parts_are_sealed(self):
        roll = [{"user_id": "u1", "name": "Pat Chief", "vote": "yes"}]
        detail = _vote_detail(
            _motion(threshold="two_thirds", votes_recused=1, roll_call=roll)
        )
        assert detail == {
            "threshold": "two_thirds",
            "votes_recused": 1,
            "roll_call": roll,
        }

    def test_a_motion_without_the_new_fields_at_all_is_unchanged(self):
        assert _vote_detail(SimpleNamespace()) == {}
