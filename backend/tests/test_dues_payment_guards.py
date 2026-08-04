"""
Dues payment guards (FIN-6).

``record_dues_payment`` mutated a shared aggregate with no ledger behind it, so
two of its behaviours destroyed information that could not be reconstructed:

  * recording a payment against a WAIVED record recomputed status to
    PAID/PARTIAL while leaving waived_by / waived_at / waive_reason populated,
    and the dues summary derives ``total_waived`` from ``status == WAIVED`` — so
    the waived amount silently moved into collections;

  * payment_method / transaction_reference / notes were each assigned from
    ``kwargs.get(...)``. The endpoint passes ``**data.model_dump()``, which
    materializes every optional field as None when omitted, so a second partial
    payment that did not resend ``notes`` blanked the first payment's.

These are unit tests: the guards are pure logic over an already-loaded row, so
they run without a database and stay in CI's unit job.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.finance import DuesPayment, DuesStatus, MemberDues
from app.services.finance_service import FinanceService, _apply_payment_totals

pytestmark = [pytest.mark.unit]

ORG_ID = str(uuid.uuid4())
BASE_TIME = datetime(2026, 3, 1, 19, 30, tzinfo=timezone.utc)


def _dues(payments: list[DuesPayment] | None = None, **overrides) -> MemberDues:
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "dues_schedule_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "amount_due": Decimal("100.00"),
        "amount_paid": Decimal("0.00"),
        "status": DuesStatus.PENDING,
        "due_date": None,
    }
    values.update(overrides)
    dues = MemberDues(**values)
    for payment in payments or []:
        dues.payments.append(payment)
    return dues


def _payment(amount: str, *, minutes_ago: int = 0, **overrides) -> DuesPayment:
    values = {
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "amount": Decimal(amount),
        "received_at": BASE_TIME - timedelta(minutes=minutes_ago),
    }
    values.update(overrides)
    return DuesPayment(**values)


def _service_for(dues: MemberDues) -> FinanceService:
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=dues)
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return FinanceService(db)


class TestWaivedAndExemptAreProtected:
    async def test_payment_against_a_waived_record_is_refused(self):
        dues = _dues(
            status=DuesStatus.WAIVED,
            waived_by=str(uuid.uuid4()),
            waive_reason="Hardship — approved by the board",
        )
        service = _service_for(dues)

        with pytest.raises(ValueError, match="not owing"):
            await service.record_dues_payment(dues.id, ORG_ID, amount_paid=100.0)

    async def test_a_refused_payment_leaves_the_waiver_intact(self):
        dues = _dues(
            status=DuesStatus.WAIVED,
            waived_by=str(uuid.uuid4()),
            waive_reason="Hardship — approved by the board",
        )
        service = _service_for(dues)

        with pytest.raises(ValueError, match="not owing"):
            await service.record_dues_payment(dues.id, ORG_ID, amount_paid=100.0)

        # The row must be untouched — the old behaviour left a contradictory
        # record: status PAID with a waive reason still attached.
        assert dues.status == DuesStatus.WAIVED
        assert dues.waive_reason == "Hardship — approved by the board"
        assert dues.amount_paid == Decimal("0.00")

    async def test_payment_against_an_exempt_record_is_refused(self):
        dues = _dues(status=DuesStatus.EXEMPT)
        service = _service_for(dues)

        with pytest.raises(ValueError, match="not owing"):
            await service.record_dues_payment(dues.id, ORG_ID, amount_paid=100.0)

    @pytest.mark.parametrize(
        "status", [DuesStatus.PENDING, DuesStatus.PARTIAL, DuesStatus.OVERDUE]
    )
    async def test_owing_records_still_accept_payment(self, status):
        dues = _dues(status=status)
        service = _service_for(dues)

        await service.record_dues_payment(dues.id, ORG_ID, amount_paid=100.0)

        assert dues.status == DuesStatus.PAID
        assert dues.amount_paid == Decimal("100.00")


class TestEarlierPaymentsSurvive:
    """The ledger is what makes earlier payments recoverable at all.

    Previously a second instalment overwrote the first payment's method,
    reference and notes on the single dues row, with nothing else holding them.
    """

    async def test_a_second_instalment_does_not_erase_the_first(self):
        first = _payment(
            "40.00",
            minutes_ago=60,
            payment_method="check",
            transaction_reference="CHK-1041",
            notes="First installment, collected at the March meeting",
        )
        dues = _dues(
            [first],
            amount_paid=Decimal("40.00"),
            status=DuesStatus.PARTIAL,
        )
        service = _service_for(dues)

        await service.record_dues_payment(
            dues.id,
            ORG_ID,
            amount_paid=60.0,
            payment_method="cash",
            transaction_reference="CASH-7",
            notes="Balance settled in person",
        )

        assert len(dues.payments) == 2
        assert first.notes == "First installment, collected at the March meeting"
        assert first.transaction_reference == "CHK-1041"
        assert first.amount == Decimal("40.00")

    async def test_summary_columns_project_the_newest_payment(self):
        dues = _dues(
            [_payment("40.00", minutes_ago=60, payment_method="check")],
            amount_paid=Decimal("40.00"),
            status=DuesStatus.PARTIAL,
        )
        service = _service_for(dues)

        await service.record_dues_payment(
            dues.id,
            ORG_ID,
            amount_paid=60.0,
            payment_method="cash",
            transaction_reference="CASH-7",
        )

        assert dues.payment_method == "cash"
        assert dues.transaction_reference == "CASH-7"
        assert dues.amount_paid == Decimal("100.00")
        assert dues.status == DuesStatus.PAID


class TestIdempotency:
    async def test_resubmitting_the_same_reference_does_not_double_credit(self):
        dues = _dues(
            [_payment("100.00", minutes_ago=5, transaction_reference="CHK-1041")],
            amount_paid=Decimal("100.00"),
            status=DuesStatus.PAID,
        )
        service = _service_for(dues)

        await service.record_dues_payment(
            dues.id, ORG_ID, amount_paid=100.0, transaction_reference="CHK-1041"
        )

        assert len(dues.payments) == 1
        assert dues.amount_paid == Decimal("100.00")

    async def test_a_distinct_reference_is_recorded_normally(self):
        dues = _dues(
            [_payment("40.00", minutes_ago=60, transaction_reference="CHK-1041")],
            amount_paid=Decimal("40.00"),
            status=DuesStatus.PARTIAL,
        )
        service = _service_for(dues)

        await service.record_dues_payment(
            dues.id, ORG_ID, amount_paid=60.0, transaction_reference="CHK-1042"
        )

        assert len(dues.payments) == 2
        assert dues.amount_paid == Decimal("100.00")

    async def test_unreferenced_payments_are_never_deduplicated(self):
        # Cash at a meeting has nothing to identify it, so two identical
        # amounts are two payments — collapsing them would lose money.
        dues = _dues([_payment("20.00", minutes_ago=60, payment_method="cash")])
        service = _service_for(dues)

        await service.record_dues_payment(
            dues.id, ORG_ID, amount_paid=20.0, payment_method="cash"
        )

        assert len(dues.payments) == 2
        assert dues.amount_paid == Decimal("40.00")


class TestUnwaive:
    """The way back out of WAIVED, which payments deliberately no longer are."""

    async def test_reversing_a_waiver_restores_what_the_ledger_says(self):
        dues = _dues(
            [_payment("40.00", minutes_ago=60, payment_method="check")],
            status=DuesStatus.WAIVED,
            waived_by=str(uuid.uuid4()),
            waive_reason="Hardship — approved by the board",
        )
        service = _service_for(dues)

        result, prior_reason = await service.unwaive_dues(
            dues.id, ORG_ID, reason="Member paid after all"
        )

        assert prior_reason == "Hardship — approved by the board"
        # 40 of 100 was already on the ledger, so it lands on PARTIAL — not
        # PENDING, and not the PAID the old code would have produced.
        assert result.status == DuesStatus.PARTIAL
        assert result.amount_paid == Decimal("40.00")
        assert result.waived_by is None
        assert result.waive_reason is None

    async def test_an_unpaid_record_returns_to_pending(self):
        dues = _dues(
            status=DuesStatus.WAIVED,
            waive_reason="Hardship",
            amount_paid=Decimal("0.00"),
        )
        service = _service_for(dues)

        result, _ = await service.unwaive_dues(
            dues.id, ORG_ID, reason="Entered in error"
        )

        assert result.status == DuesStatus.PENDING
        assert result.amount_paid == Decimal("0.00")

    async def test_reversing_a_record_that_is_not_waived_is_refused(self):
        dues = _dues(status=DuesStatus.PARTIAL, amount_paid=Decimal("40.00"))
        service = _service_for(dues)

        with pytest.raises(ValueError, match="not waived"):
            await service.unwaive_dues(dues.id, ORG_ID, reason="Mistake")

    async def test_payment_is_accepted_again_after_reversal(self):
        # The whole point: waived by mistake, member paid, treasurer needs to
        # record it. Before the reversal endpoint this was a dead end.
        dues = _dues(status=DuesStatus.WAIVED, waive_reason="Hardship")
        service = _service_for(dues)

        await service.unwaive_dues(dues.id, ORG_ID, reason="Member paid after all")
        await service.record_dues_payment(
            dues.id, ORG_ID, amount_paid=100.0, transaction_reference="CHK-2001"
        )

        assert dues.status == DuesStatus.PAID
        assert dues.amount_paid == Decimal("100.00")
        assert len(dues.payments) == 1


class TestTotalsAreDerived:
    """`_apply_payment_totals` recomputes rather than accumulates."""

    def test_total_is_the_sum_of_the_ledger(self):
        dues = _dues(
            [
                _payment("25.00", minutes_ago=90),
                _payment("30.00", minutes_ago=60),
                _payment("45.00", minutes_ago=30),
            ],
            amount_paid=Decimal("999.00"),  # a corrupted aggregate...
        )

        _apply_payment_totals(dues)

        assert dues.amount_paid == Decimal("100.00")  # ...is corrected, not added to
        assert dues.status == DuesStatus.PAID

    def test_ordering_follows_received_at_not_insertion(self):
        dues = _dues(
            [
                _payment("10.00", minutes_ago=5, payment_method="cash"),
                _payment("10.00", minutes_ago=90, payment_method="check"),
            ]
        )

        _apply_payment_totals(dues)

        # The newest payment by receipt time is the cash one, despite the
        # check having been appended second.
        assert dues.payment_method == "cash"
        assert dues.paid_date == BASE_TIME - timedelta(minutes=5)

    def test_an_empty_ledger_returns_the_record_to_pending(self):
        dues = _dues(amount_paid=Decimal("50.00"), status=DuesStatus.PARTIAL)

        _apply_payment_totals(dues)

        assert dues.amount_paid == Decimal("0.00")
        assert dues.status == DuesStatus.PENDING
        assert dues.paid_date is None

    def test_partial_when_the_ledger_falls_short(self):
        dues = _dues([_payment("60.00")], amount_due=Decimal("100.00"))

        _apply_payment_totals(dues)

        assert dues.status == DuesStatus.PARTIAL
