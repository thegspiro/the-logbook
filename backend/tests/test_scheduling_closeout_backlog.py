"""The close-out backlog as a list, not just a count.

`test_admin_hub_scheduling.py::TestCloseoutBacklog` pins which shifts are in
this population; both it and `SchedulingService.get_closeout_backlog` now read
`closeout_backlog_halves`, so that file holds the membership rule for the queue
as well. What is only true of the list is here: its order, and its total.

Order is the part that had no way to be right on the client. A shift with no
recorded end was over a cushion after it began, so ordering by `start_time`
interleaves it with shifts that were over hours before it was — and "oldest
first" then stops meaning anything across a page boundary, which is precisely
where the officer with a real backlog reads it.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.training import Shift, ShiftStatus
from app.models.user import Organization
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.integration

NOW = datetime.now(timezone.utc)


async def _org(db_session, *, settings: dict | None = None) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Close-out Test Department",
        slug=f"closeout-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={
            "modules": {"scheduling": True, "_user_configured": True},
            **(settings or {}),
        },
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _shift(
    db_session,
    org,
    *,
    start: datetime,
    end: datetime | None,
    finalized: bool = False,
    status: ShiftStatus = ShiftStatus.SCHEDULED,
) -> Shift:
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=start.date(),
        start_time=start,
        end_time=end,
        is_finalized=finalized,
        status=status,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


async def _backlog(db_session, org, **kwargs):
    return await SchedulingService(db_session).get_closeout_backlog(
        org.id, now=NOW, **kwargs
    )


class TestPopulation:
    async def test_lists_a_shift_that_ended_and_was_never_finalized(self, db_session):
        org = await _org(db_session)
        shift = await _shift(
            db_session,
            org,
            start=NOW - timedelta(days=1, hours=12),
            end=NOW - timedelta(days=1),
        )

        shifts, total = await _backlog(db_session, org)

        assert [s.id for s in shifts] == [shift.id]
        assert total == 1

    async def test_lists_an_open_ended_shift_past_the_cushion(self, db_session):
        org = await _org(db_session)
        shift = await _shift(db_session, org, start=NOW - timedelta(days=3), end=None)

        shifts, total = await _backlog(db_session, org)

        assert [s.id for s in shifts] == [shift.id]
        assert total == 1

    async def test_leaves_an_open_ended_shift_alone_inside_the_cushion(
        self, db_session
    ):
        org = await _org(db_session)
        await _shift(db_session, org, start=NOW - timedelta(hours=2), end=None)

        shifts, total = await _backlog(db_session, org)

        assert shifts == []
        assert total == 0

    @pytest.mark.parametrize(
        "kwargs",
        [
            pytest.param({"finalized": True}, id="finalized"),
            pytest.param({"status": ShiftStatus.CANCELLED}, id="cancelled"),
        ],
    )
    async def test_ignores_a_shift_with_nothing_left_to_record(
        self, db_session, kwargs
    ):
        org = await _org(db_session)
        await _shift(
            db_session,
            org,
            start=NOW - timedelta(days=1, hours=12),
            end=NOW - timedelta(days=1),
            **kwargs,
        )

        shifts, total = await _backlog(db_session, org)

        assert shifts == []
        assert total == 0

    async def test_ignores_a_shift_that_has_not_ended_yet(self, db_session):
        org = await _org(db_session)
        await _shift(
            db_session,
            org,
            start=NOW + timedelta(hours=1),
            end=NOW + timedelta(hours=13),
        )

        shifts, total = await _backlog(db_session, org)

        assert shifts == []
        assert total == 0

    async def test_ignores_another_departments_shift(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        await _shift(
            db_session,
            other,
            start=NOW - timedelta(days=1, hours=12),
            end=NOW - timedelta(days=1),
        )

        shifts, total = await _backlog(db_session, org)

        assert shifts == []
        assert total == 0

    async def test_the_cushion_follows_the_departments_checkin_window(self, db_session):
        org = await _org(
            db_session,
            settings={
                "shift_reports": {
                    "checklist_timing": {"checkin_closes_hours_after": 48}
                }
            },
        )
        # Past the built-in twelve-hour floor, inside the department's forty-eight.
        await _shift(db_session, org, start=NOW - timedelta(hours=20), end=None)

        shifts, total = await _backlog(db_session, org)

        assert shifts == []
        assert total == 0


class TestOrder:
    async def test_orders_by_when_the_shift_was_over_not_when_it_started(
        self, db_session
    ):
        """The claim the client could not make, and the reason for the `case`.

        The open-ended shift starts first and is over last: on the default
        twelve-hour cushion it ended eight hours ago, while the fixed-end shift
        that started five hours after it ended fourteen hours ago. Ordering by
        `start_time` puts them the other way round, so this fails against that
        revert rather than merely passing with it.
        """
        org = await _org(db_session)
        open_ended = await _shift(
            db_session, org, start=NOW - timedelta(hours=20), end=None
        )
        fixed = await _shift(
            db_session,
            org,
            start=NOW - timedelta(hours=15),
            end=NOW - timedelta(hours=14),
        )

        shifts, _ = await _backlog(db_session, org)

        assert [s.id for s in shifts] == [fixed.id, open_ended.id]


class TestPaging:
    async def test_a_short_page_still_reports_the_whole_backlog(self, db_session):
        """`total` is the count, not the length of the page.

        The queue's "showing the oldest N of M" line stands on this, and it is
        the line that stops a truncated first page reading as an empty backlog.
        """
        org = await _org(db_session)
        for hours in (30, 28, 26):
            await _shift(
                db_session,
                org,
                start=NOW - timedelta(hours=hours + 1),
                end=NOW - timedelta(hours=hours),
            )

        first, total = await _backlog(db_session, org, limit=2)
        second, _ = await _backlog(db_session, org, skip=2, limit=2)

        assert total == 3
        assert len(first) == 2
        assert len(second) == 1
        assert len({s.id for s in first} & {s.id for s in second}) == 0
