"""Four outreach checklist steps tick themselves from the request's state.

Owner decision, 2026-11-22. Review Request, Assign Coordinator, Confirm Date
and Arrange Volunteers are read from the request rather than stored, so each
unticks when its action is undone and a request filed before the rule reads
correctly with no backfill. Pinned:

* each step's condition, including the reversals (coordinator removed,
  request postponed, a volunteer dropping out);
* Arrange Volunteers stays manual without a signup sheet to measure against;
* a stored tick on an automatic step is overridden both ways, and manual
  steps keep their stored ticks;
* a coordinator cannot toggle an automatic step, and the board, the request
  page and the public status page all read the same checklist.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.event_requests import (
    check_request_status,
    update_task_completion,
)
from app.models.event_request import EventRequestStatus
from app.schemas.event_request import TaskCompletionUpdate
from app.services.event_request_service import (
    AUTOMATIC_TASK_HINTS,
    automatic_task_states,
    effective_task_completions,
)

pytestmark = pytest.mark.unit

MANUAL_TICK = {"completed": True, "completed_by": "u1", "completed_at": "x"}


def _request(**overrides):
    row = {
        "id": "req-1",
        "organization_id": "org-1",
        "status": EventRequestStatus.IN_PROGRESS,
        "assigned_to": None,
        "staffing_shift_id": None,
        "task_completions": {},
    }
    row.update(overrides)
    return SimpleNamespace(**row)


class TestEachStep:
    def test_a_new_request_has_nothing_done(self):
        states = automatic_task_states(
            _request(status=EventRequestStatus.SUBMITTED), None
        )
        assert states == {
            "review_request": False,
            "assign_coordinator": False,
            "confirm_date": False,
        }

    def test_review_is_done_once_work_starts(self):
        for status in EventRequestStatus:
            done = automatic_task_states(_request(status=status), None)
            assert done["review_request"] is (status != EventRequestStatus.SUBMITTED)

    def test_assign_follows_the_coordinator(self):
        assert automatic_task_states(_request(assigned_to="u2"), None)[
            "assign_coordinator"
        ]
        assert not automatic_task_states(_request(assigned_to=None), None)[
            "assign_coordinator"
        ]

    @pytest.mark.parametrize(
        ("status", "done"),
        [
            (EventRequestStatus.SCHEDULED, True),
            (EventRequestStatus.COMPLETED, True),
            (EventRequestStatus.POSTPONED, False),
            (EventRequestStatus.IN_PROGRESS, False),
        ],
    )
    def test_confirm_date_follows_the_schedule(self, status, done):
        assert (
            automatic_task_states(_request(status=status), None)["confirm_date"] is done
        )

    @pytest.mark.parametrize(
        ("filled", "done"), [(0, False), (1, False), (2, True), (3, True)]
    )
    def test_volunteers_are_arranged_when_every_seat_is_filled(self, filled, done):
        states = automatic_task_states(_request(), (filled, 2))
        assert states["arrange_volunteers"] is done

    @pytest.mark.parametrize("staffing", [None, (0, 0)])
    def test_volunteers_stay_manual_without_seats_to_count(self, staffing):
        assert "arrange_volunteers" not in automatic_task_states(_request(), staffing)

    def test_every_automatic_step_has_a_hint(self):
        states = automatic_task_states(_request(), (1, 1))
        assert set(states) == set(AUTOMATIC_TASK_HINTS)


class TestTheChecklistEveryReaderShows:
    def test_a_stored_tick_on_an_undone_step_is_cleared(self):
        """A coordinator ticked Confirm Date by hand; the request was postponed."""
        req = _request(
            status=EventRequestStatus.POSTPONED,
            task_completions={"confirm_date": MANUAL_TICK, "plan_content": MANUAL_TICK},
        )
        completions = effective_task_completions(req, None)
        assert "confirm_date" not in completions
        assert completions["plan_content"] == MANUAL_TICK
        assert completions["review_request"] == {"completed": True, "automatic": True}

    def test_a_volunteer_dropping_out_unticks_arrange_volunteers(self):
        req = _request(status=EventRequestStatus.SCHEDULED)
        assert effective_task_completions(req, (2, 2))["arrange_volunteers"][
            "completed"
        ]
        assert "arrange_volunteers" not in effective_task_completions(req, (1, 2))

    def test_a_manual_volunteer_tick_stands_without_a_sheet(self):
        req = _request(task_completions={"arrange_volunteers": MANUAL_TICK})
        assert (
            effective_task_completions(req, None)["arrange_volunteers"] == MANUAL_TICK
        )

    def test_the_stored_column_is_not_mutated(self):
        stored = {"confirm_date": dict(MANUAL_TICK)}
        req = _request(task_completions=stored)
        effective_task_completions(req, None)
        assert stored == {"confirm_date": MANUAL_TICK}


def _org(**pipeline):
    return SimpleNamespace(
        id="org-1",
        timezone="America/New_York",
        settings={"events": {"request_pipeline": pipeline}},
    )


def _result(value):
    return SimpleNamespace(scalar_one_or_none=lambda: value)


def _db(*values):
    db = AsyncMock()
    db.execute.side_effect = [_result(v) for v in values]
    db.add = MagicMock()
    return db


class TestTheTickEndpoint:
    @pytest.mark.parametrize(
        "task_id", ["review_request", "assign_coordinator", "confirm_date"]
    )
    async def test_an_automatic_step_cannot_be_toggled(self, task_id):
        db = _db(_request(), _org())
        with pytest.raises(HTTPException) as exc:
            await update_task_completion(
                request_id="req-1",
                update=TaskCompletionUpdate(task_id=task_id, completed=True),
                db=db,
                current_user=SimpleNamespace(id="u1", organization_id="org-1"),
            )
        assert exc.value.status_code == 400
        assert exc.value.detail == AUTOMATIC_TASK_HINTS[task_id]
        db.commit.assert_not_called()

    async def test_arrange_volunteers_is_manual_without_a_sheet(self):
        db = _db(_request(), _org())
        result = await update_task_completion(
            request_id="req-1",
            update=TaskCompletionUpdate(task_id="arrange_volunteers", completed=True),
            db=db,
            current_user=SimpleNamespace(id="u1", organization_id="org-1"),
        )
        assert result["task_completions"]["arrange_volunteers"]["completed"] is True


class TestThePublicStatusPage:
    async def test_progress_counts_the_automatic_steps(self):
        """Before the rule a request with no stored ticks showed no progress."""
        req = _request(
            status=EventRequestStatus.SCHEDULED,
            assigned_to="u2",
            contact_name="Stanley Test",
            outreach_type="station_tour",
            date_flexibility="flexible",
            preferred_date_start=None,
            preferred_date_end=None,
            preferred_timeframe=None,
            created_at=datetime(2026, 11, 22, tzinfo=timezone.utc),
            updated_at=datetime(2026, 11, 22, tzinfo=timezone.utc),
            event_date=None,
            event_id=None,
            decline_reason=None,
        )
        db = _db(req, _org(public_progress_visible=True))
        status = await check_request_status(token="t", db=db)
        assert status.task_progress["completed"] == 3
        assert status.task_progress["total"] == 6
