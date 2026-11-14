"""The ``events.attended_by_type`` data source: the same events as
``events.attended_count``, counted by type and named as the community
engagement report names them."""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.models.event import Event, EventRSVP, EventType
from app.services.evaluation_data_service import (
    EvaluationDataService,
    compute_coverage,
)
from tests.test_shift_evaluations import _member, _org

pytestmark = [pytest.mark.integration]

KEY = "events.attended_by_type"


async def _event(db, org_id, kind, on, *, cancelled=False):
    start = datetime(on.year, on.month, on.day, 19, tzinfo=timezone.utc)
    event = Event(
        organization_id=org_id,
        title=f"{kind.value} {on}",
        event_type=kind,
        start_datetime=start,
        end_datetime=start + timedelta(hours=2),
        is_cancelled=cancelled,
    )
    db.add(event)
    await db.flush()
    return event


async def _check_in(db, org_id, event, member, checked_in=True):
    db.add(
        EventRSVP(
            organization_id=org_id,
            event_id=event.id,
            user_id=member.id,
            checked_in=checked_in,
        )
    )
    await db.flush()


async def _figures(db, org_id, member, leaves=()):
    coverage = compute_coverage(
        date(2026, 1, 1), date(2026, 12, 31), [(date(2020, 1, 1), None)], leaves
    )
    assert coverage is not None
    return await EvaluationDataService(db).compute(
        org_id,
        member,
        coverage,
        [KEY, "events.attended_count"],
        ZoneInfo("UTC"),
    )


async def test_counts_by_type_add_up_to_the_events_attended(db_session):
    org_id = await _org(db_session)
    member = await _member(db_session, org_id, "Terry")
    attended = [
        (EventType.TRAINING, date(2026, 2, 3)),
        (EventType.TRAINING, date(2026, 3, 3)),
        (EventType.BUSINESS_MEETING, date(2026, 2, 10)),
        (EventType.PUBLIC_EDUCATION, date(2026, 5, 1)),
    ]
    for kind, on in attended:
        await _check_in(
            db_session, org_id, await _event(db_session, org_id, kind, on), member
        )
    # Not counted: an RSVP without a check-in, a cancelled event, an event
    # outside the period, and one held during a leave.
    await _check_in(
        db_session,
        org_id,
        await _event(db_session, org_id, EventType.SOCIAL, date(2026, 4, 1)),
        member,
        checked_in=False,
    )
    await _check_in(
        db_session,
        org_id,
        await _event(
            db_session, org_id, EventType.SOCIAL, date(2026, 4, 2), cancelled=True
        ),
        member,
    )
    await _check_in(
        db_session,
        org_id,
        await _event(db_session, org_id, EventType.CEREMONY, date(2025, 12, 1)),
        member,
    )
    await _check_in(
        db_session,
        org_id,
        await _event(db_session, org_id, EventType.FUNDRAISER, date(2026, 9, 15)),
        member,
    )
    leave = SimpleNamespace(start_date=date(2026, 9, 1), end_date=date(2026, 9, 30))

    figures = await _figures(db_session, org_id, member, [leave])

    assert [line["label"] for line in figures[KEY]["value"]] == [
        "Business Meeting: 1 event",
        "Public Education: 1 event",
        "Training: 2 events",
    ]
    assert sum(line["attended"] for line in figures[KEY]["value"]) == (
        figures["events.attended_count"]["value"]
    )


async def test_nothing_attended_lists_nothing(db_session):
    org_id = await _org(db_session)
    member = await _member(db_session, org_id, "Casey")

    figures = await _figures(db_session, org_id, member)

    assert figures[KEY] == {"available": True, "value": []}
    assert figures["events.attended_count"]["value"] == 0
