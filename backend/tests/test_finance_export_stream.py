"""Focused tests for the bounded, streaming finance export path."""

import csv
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import ValidationError

from app.models.finance import CheckRequest, PurchaseRequest
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


def _db(counts, results):
    db = Mock()
    db.scalar = AsyncMock(side_effect=counts)
    db.execute = AsyncMock(side_effect=[_Result(r) for r in results])
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.add = Mock()
    return db


async def _consume(stream):
    return "".join([chunk async for chunk in stream])


@pytest.mark.asyncio
async def test_stream_is_batched_stable_safe_and_logged_successfully():
    paid = datetime(2026, 2, 1, tzinfo=timezone.utc)
    first = PurchaseRequest(
        id="a",
        paid_at=paid,
        request_number="PR-1",
        vendor="=cmd",
        title='one, "quoted"',
        actual_amount=Decimal("1.00"),
        estimated_amount=Decimal("1.00"),
    )
    second = PurchaseRequest(
        id="b",
        paid_at=paid,
        request_number="PR-2",
        vendor="normal",
        title="two",
        actual_amount=Decimal("2.00"),
        estimated_amount=Decimal("2.00"),
    )
    check = CheckRequest(
        id="c",
        check_date=paid,
        request_number="CR-1",
        check_number=None,
        payee_name="payee",
        memo="memo",
        purpose=None,
        amount=Decimal("3.00"),
    )
    # PR batches, terminating PR batch, check batch, terminating check batch.
    db = _db([2, 1, 0], [[first], [second], [], [check], []])
    stream = await FinanceService(db).generate_export(
        "org", "user", paid, paid, batch_size=1
    )
    content = await _consume(stream)

    rows = list(csv.reader(io.StringIO(content)))
    assert [row[2] for row in rows[1:]] == ["PR-1", "PR-2", "CR-1"]
    assert rows[1][3] == "'=cmd"
    assert rows[1][4] == 'one, "quoted"'
    log = db.add.call_args.args[0]
    assert (log.status, log.record_count, log.error_message) == ("successful", 3, None)
    assert db.execute.await_count == 5


@pytest.mark.asyncio
async def test_row_limit_is_checked_before_log_or_stream_creation():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db = _db([10_001, 0, 0], [])
    with pytest.raises(ValueError, match="at most 10000 rows"):
        await FinanceService(db).generate_export("org", "user", now, now)
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_generator_failure_marks_log_failed_and_cleans_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db = _db([1, 0, 0], [])
    db.execute.side_effect = RuntimeError("database disappeared")
    stream = await FinanceService(db).generate_export("org", "user", now, now)
    assert "Date" in await anext(stream)
    with pytest.raises(RuntimeError, match="database disappeared"):
        await anext(stream)

    log = db.add.call_args.args[0]
    assert (log.status, log.record_count) == ("failed", 0)
    assert log.error_message == "Export stream interrupted before completion"
    db.rollback.assert_awaited_once()
    assert db.commit.await_count == 2  # pending, then terminal failure state


@pytest.mark.asyncio
async def test_client_closing_stream_does_not_create_success_log():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    db = _db([1, 0, 0], [])
    stream = await FinanceService(db).generate_export("org", "user", now, now)
    await anext(stream)  # response header was sent, then the client disconnected
    await stream.aclose()

    log = db.add.call_args.args[0]
    assert (log.status, log.record_count) == ("failed", 0)
    db.rollback.assert_awaited_once()
