"""History phase 5's pure rules, with no database: the days "Today in history"
matches, an apparatus's service span, how a fleet truck's disposal reads, and
the timeline entry's wire shape."""

from datetime import date
from types import SimpleNamespace

import pytest

from app.models.history import ApparatusDisposition, DatePrecision, PublicationLevel
from app.schemas.history import EventCreate, HeldTitleWrite, TimelineEntry
from app.services.history_apparatus_service import fleet_disposition, service_span
from app.services.history_timeline_service import today_days

pytestmark = pytest.mark.unit


class TestTodayDays:
    def test_an_ordinary_day_is_itself(self):
        assert today_days(date(2026, 3, 4)) == [(3, 4)]

    def test_the_28th_of_february_takes_the_29th_in_a_short_year(self):
        assert today_days(date(2027, 2, 28)) == [(2, 28), (2, 29)]

    def test_but_not_in_a_leap_year_which_has_its_own_29th(self):
        assert today_days(date(2028, 2, 28)) == [(2, 28)]
        assert today_days(date(2028, 2, 29)) == [(2, 29)]


def _truck(**values):
    defaults = {
        "in_service_date": None,
        "in_service_circa": False,
        "out_of_service_date": None,
        "out_of_service_circa": False,
        "disposition": ApparatusDisposition.UNKNOWN,
    }
    return SimpleNamespace(**{**defaults, **values})


class TestServiceSpan:
    def test_both_ends(self):
        truck = _truck(
            in_service_date=date(1924, 1, 1), out_of_service_date=date(1968, 1, 1)
        )
        assert service_span(truck) == "1924–1968"

    def test_still_running(self):
        truck = _truck(
            in_service_date=date(1998, 1, 1),
            disposition=ApparatusDisposition.IN_SERVICE,
        )
        assert service_span(truck) == "1998–present"

    def test_circa_and_open_ended(self):
        truck = _truck(in_service_date=date(1911, 1, 1), in_service_circa=True)
        assert service_span(truck) == "c. 1911–"

    def test_no_dates_is_none(self):
        assert service_span(_truck()) is None


def _fleet(**values):
    defaults = {"is_archived": True, "disposal_method": None, "sold_date": None}
    return SimpleNamespace(**{**defaults, **values})


class TestFleetDisposition:
    @pytest.mark.parametrize(
        ("method", "expected"),
        [
            ("Sold at auction", ApparatusDisposition.SOLD),
            ("Traded in", ApparatusDisposition.TRADED),
            ("Scrapped", ApparatusDisposition.SCRAPPED),
            ("Donated to the county museum", ApparatusDisposition.MUSEUM),
            ("Preserved by the association", ApparatusDisposition.PRESERVED),
            ("Donated", ApparatusDisposition.UNKNOWN),
        ],
    )
    def test_the_disposal_method_is_read_not_guessed(self, method, expected):
        assert fleet_disposition(_fleet(disposal_method=method)) == expected

    def test_a_sale_date_alone_reads_as_sold(self):
        assert (
            fleet_disposition(_fleet(sold_date=date(2010, 1, 1)))
            == ApparatusDisposition.SOLD
        )

    def test_a_truck_not_archived_is_in_service(self):
        assert (
            fleet_disposition(_fleet(is_archived=False, disposal_method="Sold"))
            == ApparatusDisposition.IN_SERVICE
        )


class TestWireShapes:
    def test_a_timeline_entry_carries_its_date(self):
        entry = TimelineEntry(
            key="event:e1",
            kind="event",
            date=date(1911, 3, 4),
            precision=DatePrecision.DAY,
            circa=False,
            end_date=None,
            end_precision=None,
            end_circa=False,
            label="Mill fire",
            detail=None,
            record_type="event",
            record_id="e1",
            event_type_id=None,
            event_type_name=None,
            publication_level=PublicationLevel.MEMBERS,
        )
        assert entry.model_dump(mode="json")["date"] == "1911-03-04"

    def test_an_event_needs_a_start_date(self):
        with pytest.raises(ValueError, match="start_date"):
            EventCreate(title="Undated")

    def test_a_held_title_cannot_end_before_it_began(self):
        with pytest.raises(ValueError, match="cannot end before"):
            HeldTitleWrite(
                title_id="t1",
                held_from_date=date(1980, 1, 1),
                held_to_date=date(1975, 1, 1),
            )
