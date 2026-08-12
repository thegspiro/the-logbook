"""Runoff rounds are named after the race, not after the previous round.

A runoff's title was built from the title of the election it follows. That
election may itself be a runoff, so a three-round chain accumulated a clause
per round — "Fire Chief Election - Runoff Round 1 - Runoff Round 2" — and a
department that went four rounds got a title too long to read in a list. Every
round should read as a round of the same race.
"""

from types import SimpleNamespace

from app.services.election_service import _runoff_base_title


def _election(title: str, runoff_round: int = 0):
    return SimpleNamespace(title=title, runoff_round=runoff_round)


class TestRunoffBaseTitle:
    def test_plain_title_is_unchanged(self):
        assert _runoff_base_title(_election("Fire Chief Election")) == (
            "Fire Chief Election"
        )

    def test_strips_a_runoff_suffix(self):
        assert (
            _runoff_base_title(_election("Fire Chief Election - Runoff Round 1", 1))
            == "Fire Chief Election"
        )

    def test_strips_only_the_trailing_suffix(self):
        """A race legitimately called "Runoff Round 1 Rules" keeps its name —
        the pattern is anchored to the end of the string."""
        assert (
            _runoff_base_title(_election("Runoff Round 1 Rules Vote"))
            == "Runoff Round 1 Rules Vote"
        )

    def test_a_chain_of_rounds_does_not_compound(self):
        """Walk three rounds the way _check_and_create_runoff does, and check
        the titles stay one clause long."""
        title = "Fire Chief Election"
        seen = [title]
        for round_number in range(3):
            election = _election(seen[-1], round_number)
            seen.append(
                f"{_runoff_base_title(election)} - Runoff Round {round_number + 1}"
            )

        assert seen == [
            "Fire Chief Election",
            "Fire Chief Election - Runoff Round 1",
            "Fire Chief Election - Runoff Round 2",
            "Fire Chief Election - Runoff Round 3",
        ]

    def test_tolerates_spacing_and_case_variants(self):
        for variant in (
            "Fire Chief Election - runoff round 2",
            "Fire Chief Election  -  Runoff Round  2  ",
            "Fire Chief Election-Runoff Round 2",
        ):
            assert _runoff_base_title(_election(variant, 2)) == "Fire Chief Election"

    def test_empty_title_does_not_raise(self):
        assert _runoff_base_title(SimpleNamespace(title=None, runoff_round=0)) == ""
