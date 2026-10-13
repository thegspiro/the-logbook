"""
Tests for scripts/report_recurring_series_drift.py (W18-3).

The owner chose a report-only script: officers fix affected series by hand, so
the report must find the two pre-W18 signatures — an occurrence an hour or a
day off its pattern, and a series collapsed onto one start — must not flood
the officer with ordinary hand edits, and must write nothing.
"""

import importlib.util
import pathlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.models.event import Event, EventType, RecurrencePattern

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "report_recurring_series_drift.py"
)
_spec = importlib.util.spec_from_file_location("_series_drift", _SCRIPT)
drift = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(drift)

UTC = timezone.utc
NOW = datetime(2026, 10, 1, tzinfo=UTC)


def _occ(event_id, start, **kw):
    return drift.Occurrence(event_id=event_id, start=start, **kw)


def _weekly(first, count):
    return [first + timedelta(weeks=i) for i in range(count)]


@pytest.mark.unit
class TestClassify:
    def test_an_hour_either_way_is_the_daylight_saving_signature(self):
        assert drift.classify(timedelta(hours=1)) == "hour"
        assert drift.classify(timedelta(hours=-1)) == "hour"

    def test_a_day_including_a_clock_change_is_the_weekday_signature(self):
        assert drift.classify(timedelta(days=1)) == "day"
        assert drift.classify(timedelta(hours=23)) == "day"
        assert drift.classify(timedelta(hours=25)) == "day"

    def test_anything_else_is_an_edit(self):
        assert drift.classify(timedelta(minutes=30)) == "other"
        assert drift.classify(timedelta(days=3)) == "other"


@pytest.mark.unit
class TestAnalyseSeries:
    def test_a_correct_series_has_nothing_to_report(self):
        expected = _weekly(datetime(2026, 10, 7, 23, 0, tzinfo=UTC), 4)
        occurrences = [_occ(f"e{i}", s) for i, s in enumerate(expected)]
        findings, collapsed, unoccupied = drift.analyse_series(
            occurrences, expected, NOW, False, False
        )
        assert (findings, collapsed, unoccupied) == ([], {}, [])

    def test_an_hour_off_occurrence_is_reported_with_its_expected_start(self):
        expected = _weekly(datetime(2026, 10, 21, 23, 0, tzinfo=UTC), 3)
        stored = [expected[0], expected[1] + timedelta(hours=1), expected[2]]
        occurrences = [_occ(f"e{i}", s, rsvp_count=i) for i, s in enumerate(stored)]
        findings, collapsed, _ = drift.analyse_series(
            occurrences, expected, NOW, False, False
        )
        assert collapsed == {}
        assert len(findings) == 1
        assert findings[0].kind == "hour"
        assert findings[0].occurrence.event_id == "e1"
        assert findings[0].expected == expected[1]
        assert findings[0].occurrence.rsvp_count == 1

    def test_a_hand_edit_is_not_reported_unless_asked(self):
        expected = _weekly(datetime(2026, 10, 7, 23, 0, tzinfo=UTC), 2)
        stored = [expected[0], expected[1] - timedelta(minutes=30)]
        occurrences = [_occ(f"e{i}", s) for i, s in enumerate(stored)]
        assert drift.analyse_series(occurrences, expected, NOW, False, False)[0] == []
        findings = drift.analyse_series(occurrences, expected, NOW, False, True)[0]
        assert [f.kind for f in findings] == ["other"]

    def test_a_collapsed_series_lists_the_dates_it_lost(self):
        expected = _weekly(datetime(2026, 10, 7, 23, 0, tzinfo=UTC), 4)
        anchor = expected[1]
        stored = [expected[0], anchor, anchor, anchor]
        occurrences = [_occ(f"e{i}", s, rsvp_count=2) for i, s in enumerate(stored)]
        findings, collapsed, unoccupied = drift.analyse_series(
            occurrences, expected, NOW, False, False
        )
        assert list(collapsed) == [anchor]
        assert {o.event_id for o in collapsed[anchor]} == {"e1", "e2", "e3"}
        assert unoccupied == expected[2:]
        # The collapsed occurrences are not also listed as off-pattern.
        assert findings == []

    def test_past_occurrences_are_left_out_by_default(self):
        expected = _weekly(datetime(2026, 9, 2, 23, 0, tzinfo=UTC), 2)
        stored = [expected[0] + timedelta(hours=1), expected[1]]
        occurrences = [_occ(f"e{i}", s) for i, s in enumerate(stored)]
        assert drift.analyse_series(occurrences, expected, NOW, False, False)[0] == []
        findings = drift.analyse_series(occurrences, expected, NOW, True, False)[0]
        assert [f.occurrence.event_id for f in findings] == ["e0"]


async def _org(db, tz="America/New_York"):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, :name, 'fire_department', :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"Series Drift {org_id[:8]}",
            "slug": f"sd-{org_id[:8]}",
            "tz": tz,
        },
    )
    return org_id


def _event(org_id, start, parent=None, **kw):
    return Event(
        organization_id=org_id,
        title=kw.pop("title", "Weekly drill"),
        event_type=EventType.TRAINING,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        is_recurring=True,
        recurrence_pattern=RecurrencePattern.WEEKLY,
        recurrence_parent_id=parent.id if parent else None,
        **kw,
    )


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_finds_a_dst_shifted_series_and_writes_nothing(self, db_session):
        org_id = await _org(db_session)
        # 7 PM Eastern every Wednesday across the November clock change: 23:00
        # UTC before it, 00:00 UTC (next day) after. The old generator kept
        # 23:00 UTC, i.e. 6 PM after the change.
        parent = _event(
            org_id,
            datetime(2026, 10, 21, 23, 0, tzinfo=UTC),
            recurrence_end_date=datetime(2026, 11, 12, tzinfo=UTC),
        )
        db_session.add(parent)
        await db_session.flush()
        stale = []
        for start in (
            datetime(2026, 10, 28, 23, 0, tzinfo=UTC),
            datetime(2026, 11, 4, 23, 0, tzinfo=UTC),
            datetime(2026, 11, 11, 23, 0, tzinfo=UTC),
        ):
            child = _event(org_id, start, parent=parent)
            db_session.add(child)
            stale.append(child)
        await db_session.flush()

        reports = await drift.build_reports(db_session, org_id, now=NOW)

        assert len(reports) == 1
        report = reports[0]
        assert report.parent_id == parent.id
        assert [f.occurrence.event_id for f in report.findings] == [
            stale[1].id,
            stale[2].id,
        ]
        assert {f.kind for f in report.findings} == {"hour"}
        assert report.findings[0].expected == datetime(2026, 11, 5, 0, 0, tzinfo=UTC)
        # Nothing was moved.
        await db_session.refresh(stale[1])
        assert drift._utc(stale[1].start_datetime) == datetime(
            2026, 11, 4, 23, 0, tzinfo=UTC
        )

    async def test_a_correct_series_is_not_reported(self, db_session):
        org_id = await _org(db_session)
        parent = _event(
            org_id,
            datetime(2026, 10, 21, 23, 0, tzinfo=UTC),
            recurrence_end_date=datetime(2026, 11, 12, tzinfo=UTC),
        )
        db_session.add(parent)
        await db_session.flush()
        for start in (
            datetime(2026, 10, 28, 23, 0, tzinfo=UTC),
            datetime(2026, 11, 5, 0, 0, tzinfo=UTC),
            datetime(2026, 11, 12, 0, 0, tzinfo=UTC),
        ):
            db_session.add(_event(org_id, start, parent=parent))
        await db_session.flush()

        assert await drift.build_reports(db_session, org_id, now=NOW) == []

    async def test_another_departments_series_is_not_read(self, db_session):
        mine = await _org(db_session)
        other = await _org(db_session)
        parent = _event(
            other,
            datetime(2026, 10, 21, 23, 0, tzinfo=UTC),
            recurrence_end_date=datetime(2026, 11, 12, tzinfo=UTC),
        )
        db_session.add(parent)
        await db_session.flush()
        anchor = datetime(2026, 10, 28, 23, 0, tzinfo=UTC)
        for _ in range(3):
            db_session.add(_event(other, anchor, parent=parent))
        await db_session.flush()

        assert await drift.build_reports(db_session, mine, now=NOW) == []
        collapsed = await drift.build_reports(db_session, other, now=NOW)
        assert len(collapsed) == 1
        assert collapsed[0].collapsed


@pytest.mark.unit
def test_the_printed_report_names_the_series_and_says_nothing_changed(capsys):
    from zoneinfo import ZoneInfo

    expected = _weekly(datetime(2026, 10, 7, 23, 0, tzinfo=UTC), 3)
    anchor = expected[0]
    occurrence = _occ("e9", expected[1] + timedelta(hours=1), rsvp_count=4)
    report = drift.SeriesReport(
        parent_id="p1",
        title="Weekly drill",
        organization="Station 1",
        pattern="weekly",
        findings=[drift.Finding("hour", occurrence, expected[1], timedelta(hours=1))],
        collapsed={anchor: [_occ("e1", anchor), _occ("e2", anchor)]},
        unoccupied=[expected[2]],
    )
    drift.print_reports([report], lambda _name: ZoneInfo("America/New_York"))
    out = capsys.readouterr().out
    assert "Station 1 / Weekly drill" in out
    assert "COLLAPSED: 2 occurrences" in out
    assert "1 hour off" in out
    assert "RSVPs=4" in out
    assert "Nothing was changed." in out
