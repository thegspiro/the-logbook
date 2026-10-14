"""Focused tests for the bounded, streaming finance export path."""

import csv
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.models.finance import CheckRequest, ExportLog, PurchaseRequest
from app.schemas.finance import ExportRequest
from app.services.finance_service import FinanceService


def test_export_request_rejects_oversized_or_reversed_ranges():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(ValidationError, match="maximum date span of 366 days"):
        ExportRequest(
            date_range_start=start, date_range_end=start + timedelta(days=367)
        )
    with pytest.raises(ValidationError, match="on or after"):
        ExportRequest(date_range_start=start, date_range_end=start - timedelta(days=1))


def test_export_request_normalizes_mixed_naive_and_aware_datetimes():
    """A naive datetime compared against an aware one raises a bare Python
    TypeError, not a pydantic ValidationError -- that reaches the client as
    an unhandled 500 instead of a 422. Naive input must be treated as UTC
    (this project's wire convention) before the range/span checks run."""
    req = ExportRequest(
        date_range_start="2026-01-01T00:00:00",
        date_range_end="2026-02-01T00:00:00Z",
    )
    assert req.date_range_start.tzinfo is not None
    assert req.date_range_end.tzinfo is not None
    assert req.date_range_start == datetime(2026, 1, 1, tzinfo=timezone.utc)


class _Result:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return iter(self._values)

    def all(self):
        return self._values


class _OrgResult:
    """The organization lookup the stream makes to resolve its timezone."""

    def __init__(self, tz="America/New_York"):
        self._org = SimpleNamespace(timezone=tz)

    def scalar_one_or_none(self):
        return self._org


def _db(counts, results, tz="America/New_York"):
    """``counts`` answer the export's count queries in order: purchases,
    checks, expense lines, voids, dues payments."""
    db = Mock()
    db.scalar = AsyncMock(side_effect=counts)
    db.execute = AsyncMock(side_effect=[_OrgResult(tz)] + [_Result(r) for r in results])
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.add = Mock()
    return db


async def _consume(stream):
    return "".join([chunk async for chunk in stream])


def _service(db, accounts=None):
    """A service whose account resolution and export bookkeeping are stubbed.

    Resolution, the in-progress guard and the stamping have their own
    database-backed tests; these sequence ``execute`` side effects for the
    stream alone. ``service.log`` is the export's log row.
    """
    service = FinanceService(db)
    service._resolve_export_accounts = AsyncMock(
        return_value={"b": ("Supplies", "Checking")} if accounts is None else accounts
    )
    service.log = ExportLog(id="log", status="pending", record_count=0)
    service._begin_export = AsyncMock(return_value=service.log)
    service._stamp_exported = AsyncMock()
    return service


@pytest.mark.asyncio
async def test_stream_is_batched_stable_safe_and_logged_successfully():
    paid = datetime(2026, 2, 1, tzinfo=timezone.utc)
    first = PurchaseRequest(
        id="a",
        paid_at=paid,
        request_number="PR-1",
        budget_id="b",
        vendor="=cmd",
        title='one, "quoted"',
        actual_amount=Decimal("1.00"),
        estimated_amount=Decimal("1.00"),
    )
    second = PurchaseRequest(
        id="b",
        paid_at=paid,
        request_number="PR-2",
        budget_id="b",
        vendor="normal",
        title="two",
        actual_amount=Decimal("2.00"),
        estimated_amount=Decimal("2.00"),
    )
    check = CheckRequest(
        id="c",
        check_date=paid,
        request_number="CR-1",
        budget_id="b",
        check_number=None,
        payee_name="payee",
        memo="memo",
        purpose=None,
        amount=Decimal("3.00"),
    )
    # PR batches, terminating PR batch, check batch, terminating check batch.
    db = _db([2, 1, 0, 0, 0], [[first], [second], [check]])
    service = _service(db)
    stream = await service.generate_export("org", "user", paid, paid, batch_size=1)
    content = await _consume(stream)

    rows = list(csv.reader(io.StringIO(content)))
    assert rows[0] == [
        "Journal No",
        "Journal Date",
        "Memo",
        "Account Name",
        "Debits",
        "Credits",
        "Description",
    ]
    # Two balancing lines per transaction, sharing its Journal No.
    assert [row[0] for row in rows[1:]] == [
        "PR-1",
        "PR-1",
        "PR-2",
        "PR-2",
        "CR-1",
        "CR-1",
    ]
    assert rows[1][3:6] == ["Supplies", "1.00", ""]
    assert rows[2][3:6] == ["Checking", "", "1.00"]
    assert rows[1][6] == "'=cmd"
    assert rows[1][2] == 'one, "quoted"'
    log = service.log
    assert (log.status, log.record_count, log.error_message) == ("successful", 3, None)
    # The timezone lookup, then one batch per purchase and one for the check:
    # each type stops at its own count rather than asking for an empty batch.
    assert db.execute.await_count == 4
    # Stamped only after the whole file, with what it carried.
    service._stamp_exported.assert_awaited_once()
    kwargs = service._stamp_exported.await_args.kwargs
    assert kwargs["purchases"] == ["a", "b"]
    assert kwargs["checks"] == {("Supplies", "Checking"): ["c"]}
    assert (kwargs["reports"], kwargs["voids"]) == (set(), [])


@pytest.mark.asyncio
async def test_payment_dates_are_the_departments_calendar_day():
    """03:00 UTC on Feb 1 is 10 PM on Jan 31 in New York: an evening payment
    must book on the day the department made it."""
    paid = datetime(2026, 2, 1, 3, 0, tzinfo=timezone.utc)
    purchase = PurchaseRequest(
        id="a",
        paid_at=paid,
        request_number="PR-1",
        vendor="v",
        title="t",
        actual_amount=Decimal("1.00"),
        estimated_amount=Decimal("1.00"),
    )
    purchase.budget_id = "b"
    db = _db([1, 0, 0, 0, 0], [[purchase]])
    stream = await _service(db).generate_export("org", "user", paid, paid)
    rows = list(csv.reader(io.StringIO(await _consume(stream))))

    assert rows[1][1] == rows[2][1] == "01/31/2026"


@pytest.mark.asyncio
async def test_row_limit_is_checked_before_log_or_stream_creation():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # 500 transactions are 1,000 rows and the header: one too many for
    # QuickBooks Online's importer.
    db = _db([500, 0, 0, 0, 0], [])
    with pytest.raises(ValueError, match="fewer than 1,000 rows"):
        await FinanceService(db).generate_export("org", "user", now, now)
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_generator_failure_marks_log_failed_and_cleans_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db = _db([1, 0, 0, 0, 0], [])
    db.execute.side_effect = RuntimeError("database disappeared")
    service = _service(db)
    stream = await service.generate_export("org", "user", now, now)
    assert "Journal No" in await anext(stream)
    with pytest.raises(RuntimeError, match="database disappeared"):
        await anext(stream)

    log = service.log
    assert (log.status, log.record_count) == ("failed", 0)
    assert log.error_message == "Export stream interrupted before completion"
    db.rollback.assert_awaited_once()
    db.commit.assert_awaited_once()  # the terminal failure state
    service._stamp_exported.assert_not_awaited()


@pytest.mark.asyncio
async def test_client_closing_stream_does_not_create_success_log():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db = _db([1, 0, 0, 0, 0], [])
    service = _service(db)
    stream = await service.generate_export("org", "user", now, now)
    await anext(stream)  # response header was sent, then the client disconnected
    await stream.aclose()

    log = service.log
    assert (log.status, log.record_count) == ("failed", 0)
    db.rollback.assert_awaited_once()
    service._stamp_exported.assert_not_awaited()


@pytest.mark.asyncio
async def test_unresolved_accounts_refuse_before_log_or_stream_creation():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db = _db([1, 0, 0, 0, 0], [])
    service = FinanceService(db)
    service._resolve_export_accounts = AsyncMock(
        side_effect=ValueError("Set QuickBooks accounts before exporting")
    )
    with pytest.raises(ValueError, match="Set QuickBooks accounts"):
        await service.generate_export("org", "user", now, now)
    db.add.assert_not_called()
    db.commit.assert_not_called()
