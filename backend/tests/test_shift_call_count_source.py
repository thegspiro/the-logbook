"""Which number a shift's call count reports, list and detail alike.

Both endpoints counted ``ShiftCall`` rows unconditionally. A count-only
department never writes one — its calls are ``OrgCallResponse`` rows, and
finalize snapshots ``shift.call_count`` from them — so every such shift read
"0 calls recorded" and the shift-report form pre-filled 0.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints import scheduling as scheduling_endpoints
from app.models.call_tracking import CallTrackingMode
from app.models.training import Shift, ShiftAttendance
from app.models.user import Organization, User, UserStatus
from app.services.call_tracking_service import CallTrackingService

# Marked per test below: the helper tests are mocked, the endpoint test needs
# the database (pitfall #30b).
pytestmark = pytest.mark.asyncio

ORG = "11111111-1111-1111-1111-111111111111"


def _db(rows):
    db = MagicMock()
    result = MagicMock()
    result.all.return_value = rows
    db.execute = AsyncMock(return_value=result)
    return db


def _mode(monkeypatch, mode):
    monkeypatch.setattr(
        CallTrackingService,
        "get_settings",
        AsyncMock(return_value={"mode": mode, "call_types": []}),
    )


def _shift(sid, *, finalized=False, call_count=None):
    return SimpleNamespace(id=sid, is_finalized=finalized, call_count=call_count)


def _queried_table(db) -> str:
    statement = db.execute.await_args.args[0]
    return str(statement)


@pytest.mark.unit
async def test_a_finalized_shift_reports_its_snapshot(monkeypatch):
    _mode(monkeypatch, CallTrackingMode.COUNT_ONLY)
    db = _db([])

    counts = await scheduling_endpoints._shift_call_counts(
        db, ORG, [_shift("s1", finalized=True, call_count=7)]
    )

    assert counts == {"s1": 7}
    db.execute.assert_not_awaited()


@pytest.mark.unit
async def test_an_open_count_only_shift_counts_its_call_responses(monkeypatch):
    _mode(monkeypatch, CallTrackingMode.COUNT_ONLY)
    db = _db([("s1", 3)])

    counts = await scheduling_endpoints._shift_call_counts(db, ORG, [_shift("s1")])

    assert counts == {"s1": 3}
    assert "org_call_responses" in _queried_table(db)


@pytest.mark.unit
async def test_an_open_detailed_shift_counts_its_shift_calls(monkeypatch):
    _mode(monkeypatch, CallTrackingMode.DETAILED)
    db = _db([("s1", 2)])

    counts = await scheduling_endpoints._shift_call_counts(db, ORG, [_shift("s1")])

    assert counts == {"s1": 2}
    assert "shift_calls" in _queried_table(db)


@pytest.mark.unit
async def test_a_mixed_batch_queries_only_the_open_shifts(monkeypatch):
    _mode(monkeypatch, CallTrackingMode.COUNT_ONLY)
    db = _db([("open", 1)])

    counts = await scheduling_endpoints._shift_call_counts(
        db,
        ORG,
        [_shift("done", finalized=True, call_count=4), _shift("open")],
    )

    assert counts == {"done": 4, "open": 1}


@pytest.mark.integration
class TestTheDetailEndpointOnAFinalizedCountOnlyShift:
    """The detail response reads the counts finalize stored."""

    async def test_shift_and_member_counts_are_the_snapshots(
        self, db_session, monkeypatch
    ):
        org = Organization(
            name="Count Only VFD",
            slug=f"count-only-{uuid.uuid4().hex[:12]}",
            settings={"scheduling": {"call_tracking": {"mode": "count_only"}}},
        )
        db_session.add(org)
        await db_session.flush()
        member = User(
            organization_id=org.id,
            username=f"ff-{org.id[:8]}",
            email=f"ff-{org.id[:8]}@example.test",
            first_name="Pat",
            last_name="Doe",
            status=UserStatus.ACTIVE,
        )
        db_session.add(member)
        await db_session.flush()
        end = datetime.now(timezone.utc) - timedelta(hours=1)
        shift = Shift(
            organization_id=org.id,
            shift_date=end.date(),
            start_time=end - timedelta(hours=12),
            end_time=end,
            is_finalized=True,
            finalized_at=end,
            call_count=5,
        )
        db_session.add(shift)
        await db_session.flush()
        # Arrived late: finalize credited four of the apparatus's five calls.
        db_session.add(
            ShiftAttendance(
                shift_id=shift.id,
                user_id=member.id,
                checked_in_at=end - timedelta(hours=10),
                checked_out_at=end,
                duration_minutes=600,
                call_count=4,
            )
        )
        await db_session.flush()

        monkeypatch.setattr(
            scheduling_endpoints, "user_has_permission", lambda *_a, **_k: True
        )
        caller = SimpleNamespace(id=str(member.id), organization_id=str(org.id))

        detail = await scheduling_endpoints.get_shift(
            shift_id=shift.id, db=db_session, current_user=caller
        )

        assert detail["call_count"] == 5
        assert [a["call_count"] for a in detail["attendees"]] == [4]
