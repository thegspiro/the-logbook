"""One canonical stored shape for a requester's preference fields.

``outreach_type``, ``date_flexibility``, ``venue_preference`` and
``preferred_time_of_day`` are plain strings on the model, and the two intake
paths filled them differently: the JSON endpoint stored whatever passed
Pydantic (which validated none of them), and the forms path mapped whatever a
department had typed into its own form's ``<select>`` options straight through.
Every reader — the coordinator's board, the type filter, the public status page,
the acknowledgement email's subject — is written against a fixed vocabulary, so
anything else rendered as a raw slug.

CLAUDE.md pitfall #20: the shape is settled on the write, by one authority both
paths call, not converted by each reader.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.event_request import EventRequestCreate
from app.services.event_request_service import normalize_request_preferences


def _org(**settings):
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        settings={"events": settings},
    )


def _settle(org=None, **fields):
    payload = {
        "outreach_type": "station_tour",
        "date_flexibility": "flexible",
        "venue_preference": "their_location",
        "preferred_time_of_day": "flexible",
        "preferred_date_start": None,
    }
    payload.update(fields)
    return normalize_request_preferences(org, payload)


class TestOutreachType:
    def test_a_configured_type_survives(self):
        assert _settle()["outreach_type"] == "station_tour"

    def test_a_departments_own_type_survives(self):
        org = _org(
            outreach_event_types=[{"value": "smoke_trailer", "label": "Smoke Trailer"}]
        )
        assert _settle(org, outreach_type="smoke_trailer")["outreach_type"] == (
            "smoke_trailer"
        )

    def test_a_type_the_department_does_not_offer_falls_back_to_other(self):
        """The requester's own words survive in `description`."""
        assert _settle(outreach_type="pancake_breakfast")["outreach_type"] == "other"

    def test_an_overlong_type_cannot_reach_the_column(self):
        """`outreach_type` is String(100); a longer value is a DataError."""
        settled = _settle(outreach_type="x" * 400)
        assert len(settled["outreach_type"]) <= 100


class TestPreferenceVocabularies:
    @pytest.mark.parametrize(
        ("field", "bad", "expected"),
        [
            ("date_flexibility", "whenever", "flexible"),
            ("venue_preference", "the park", "their_location"),
            ("preferred_time_of_day", "teatime", "flexible"),
        ],
    )
    def test_an_off_list_value_falls_back_to_the_documented_default(
        self, field, bad, expected
    ):
        assert _settle(**{field: bad})[field] == expected

    def test_casing_and_whitespace_do_not_make_a_new_value(self):
        assert _settle(venue_preference="  Our_Station ")["venue_preference"] == (
            "our_station"
        )

    def test_none_is_settled_rather_than_stored(self):
        assert _settle(preferred_time_of_day=None)["preferred_time_of_day"] == (
            "flexible"
        )


class TestSpecificDatesWithoutADate:
    """The lead-time gate only measures a request that names a date.

    Claiming ``specific_dates`` and omitting the date therefore walked straight
    past the department's stated minimum notice. Downgrading rather than
    refusing keeps the enquiry: somebody who picked the option and then left the
    picker alone is asking the department to suggest a date.
    """

    def test_specific_dates_with_no_date_becomes_a_general_timeframe(self):
        settled = _settle(date_flexibility="specific_dates", preferred_date_start=None)
        assert settled["date_flexibility"] == "general_timeframe"

    def test_specific_dates_with_a_date_is_left_alone(self):
        settled = _settle(
            date_flexibility="specific_dates",
            preferred_date_start=datetime.now(timezone.utc) + timedelta(days=30),
        )
        assert settled["date_flexibility"] == "specific_dates"


class TestIntakeSchema:
    def _payload(self, **overrides):
        data = {
            "contact_name": "Dana Reyes",
            "contact_email": "dana@example.org",
            "outreach_type": "station_tour",
            "description": "Station tour for a scout troop of about twenty.",
        }
        data.update(overrides)
        return data

    def test_an_overlong_outreach_type_is_refused_at_the_boundary(self):
        with pytest.raises(ValidationError):
            EventRequestCreate(**self._payload(outreach_type="x" * 200))

    def test_an_empty_outreach_type_is_refused(self):
        with pytest.raises(ValidationError):
            EventRequestCreate(**self._payload(outreach_type=""))

    def test_a_reversed_date_window_is_refused(self):
        start = datetime.now(timezone.utc) + timedelta(days=40)
        with pytest.raises(ValidationError) as exc:
            EventRequestCreate(
                **self._payload(
                    preferred_date_start=start,
                    preferred_date_end=start - timedelta(days=10),
                )
            )
        assert "preferred_date_end" in str(exc.value)

    def test_an_ordered_window_is_accepted(self):
        start = datetime.now(timezone.utc) + timedelta(days=40)
        data = EventRequestCreate(
            **self._payload(
                preferred_date_start=start,
                preferred_date_end=start + timedelta(days=10),
            )
        )
        assert data.preferred_date_end > data.preferred_date_start

    def test_a_single_sided_window_is_accepted(self):
        """A requester naming only an earliest date is not a reversed window."""
        start = datetime.now(timezone.utc) + timedelta(days=40)
        assert (
            EventRequestCreate(
                **self._payload(preferred_date_start=start)
            ).preferred_date_end
            is None
        )
