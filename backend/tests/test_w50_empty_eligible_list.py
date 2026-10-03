"""
W50-41 — ``eligible_voters: []`` must not mean "nobody may vote".

The stored list is read two ways. ``check_voter_eligibility`` tests
``is not None``, so an empty list bars every member from the in-app ballot;
the ballot mailer, token voting and the eligible-voter count test truthiness,
so the same empty list sends a ballot to everyone. A form that clears the
voter picker sends ``[]`` and the election lands in both states at once.

The create and update schemas now settle ``[]`` to ``None`` — the one value
every reader agrees means "all members" — before anything is stored.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.schemas.election import ElectionCreate, ElectionUpdate

pytestmark = [pytest.mark.unit]


def _create_payload(**overrides):
    now = datetime.now(timezone.utc)
    payload = {
        "title": "Chief",
        "positions": ["Chief"],
        "start_date": now + timedelta(days=1),
        "end_date": now + timedelta(days=2),
    }
    payload.update(overrides)
    return payload


class TestCreateNormalisesEmptyRoster:
    def test_empty_list_becomes_none(self):
        election = ElectionCreate(**_create_payload(eligible_voters=[]))
        assert election.eligible_voters is None

    def test_absent_stays_none(self):
        election = ElectionCreate(**_create_payload())
        assert election.eligible_voters is None

    def test_populated_list_is_kept(self):
        voter = uuid.uuid4()
        election = ElectionCreate(**_create_payload(eligible_voters=[voter]))
        assert election.eligible_voters == [voter]


class TestUpdateNormalisesEmptyRoster:
    def test_empty_list_becomes_none(self):
        assert ElectionUpdate(eligible_voters=[]).eligible_voters is None

    def test_cleared_roster_still_reaches_the_update(self):
        # Update payloads are dumped with exclude_unset: the key must survive
        # as an explicit None so the PATCH clears the stored restriction
        # rather than silently leaving the old list in place.
        dumped = ElectionUpdate(eligible_voters=[]).model_dump(exclude_unset=True)
        assert dumped == {"eligible_voters": None}

    def test_untouched_roster_is_not_in_the_update(self):
        assert ElectionUpdate(title="Renamed").model_dump(exclude_unset=True) == {
            "title": "Renamed"
        }

    def test_populated_list_is_kept(self):
        voter = uuid.uuid4()
        assert ElectionUpdate(eligible_voters=[voter]).eligible_voters == [voter]
