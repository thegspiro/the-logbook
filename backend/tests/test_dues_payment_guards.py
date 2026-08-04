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
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.finance import DuesStatus, MemberDues
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.unit]

ORG_ID = str(uuid.uuid4())


def _dues(**overrides) -> MemberDues:
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
    return MemberDues(**values)


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


class TestPaymentDetailIsNotClobbered:
    async def test_omitted_fields_keep_their_previous_values(self):
        dues = _dues(
            amount_paid=Decimal("40.00"),
            status=DuesStatus.PARTIAL,
            payment_method="check",
            transaction_reference="CHK-1041",
            notes="First installment, collected at the March meeting",
        )
        service = _service_for(dues)

        # A second installment entered without re-typing the earlier detail —
        # exactly what the endpoint sends when the form leaves them blank.
        await service.record_dues_payment(
            dues.id,
            ORG_ID,
            amount_paid=60.0,
            payment_method=None,
            transaction_reference=None,
            notes=None,
        )

        assert dues.amount_paid == Decimal("100.00")
        assert dues.status == DuesStatus.PAID
        assert dues.payment_method == "check"
        assert dues.transaction_reference == "CHK-1041"
        assert dues.notes == "First installment, collected at the March meeting"

    async def test_supplied_fields_still_overwrite(self):
        dues = _dues(
            amount_paid=Decimal("40.00"),
            status=DuesStatus.PARTIAL,
            payment_method="check",
            transaction_reference="CHK-1041",
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

        assert dues.payment_method == "cash"
        assert dues.transaction_reference == "CASH-7"
        assert dues.notes == "Balance settled in person"
