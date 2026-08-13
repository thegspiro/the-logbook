"""
FIN-4 / storefront SoD (owner decision 2026-08-09): the person who disburses
money must not be the same person the record is about. A finance requester can't
mark their own PR/expense paid or issue their own check or waive their own dues;
a storefront manager can't settle/waive/refund their own order. The out-of-band
reconciliation path (actor_id=None) is exempt. DB mocked; no MySQL.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.storefront import StoreOrderStatus, StorePaymentStatus
from app.services.finance_service import FinanceService
from app.services.storefront_service import StorefrontService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class TestFinanceDisbursementSoD:
    async def test_requester_cannot_mark_own_pr_paid(self):
        svc = FinanceService(MagicMock())
        svc.get_purchase_request = AsyncMock(
            return_value=SimpleNamespace(requested_by="u1")
        )
        with pytest.raises(ValueError, match="cannot mark paid your own"):
            await svc.mark_pr_paid("pr1", "org1", None, acted_by="u1")

    async def test_requester_cannot_mark_own_expense_paid(self):
        svc = FinanceService(MagicMock())
        svc.get_expense_report = AsyncMock(
            return_value=SimpleNamespace(requested_by="u1")
        )
        with pytest.raises(ValueError, match="cannot mark paid your own"):
            await svc.mark_expense_paid("er1", "org1", None, acted_by="u1")

    async def test_requester_cannot_issue_own_check(self):
        svc = FinanceService(MagicMock())
        svc.get_check_request = AsyncMock(
            return_value=SimpleNamespace(requested_by="u1")
        )
        with pytest.raises(ValueError, match="cannot issue check your own"):
            await svc.issue_check("cr1", "org1", "1001", acted_by="u1")

    async def test_member_cannot_waive_own_dues(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(SimpleNamespace(user_id="u1")))
        svc = FinanceService(db)
        with pytest.raises(ValueError, match="cannot waive your own"):
            await svc.waive_dues("d1", "org1", waived_by="u1", reason="x")

    async def test_a_different_approver_is_allowed_through_the_guard(self):
        # acted_by != requester -> the guard passes (the ValueError here, if any,
        # is a later precondition, not the SoD block).
        svc = FinanceService(MagicMock())
        svc.get_purchase_request = AsyncMock(
            return_value=SimpleNamespace(
                requested_by="u1", status="draft", budget_id=None
            )
        )
        # Passes the SoD guard (u2 != u1) and stops at the later status
        # precondition, proving the guard did not block a legitimate approver.
        with pytest.raises(ValueError, match="cannot be marked as paid in this status"):
            await svc.mark_pr_paid("pr1", "org1", None, acted_by="u2")


class TestStorefrontDisbursementSoD:
    @staticmethod
    def _svc(order):
        svc = StorefrontService(MagicMock())
        svc.get_order = AsyncMock(return_value=order)
        svc.record_payment = AsyncMock(return_value=order)
        return svc

    def _order(self):
        return SimpleNamespace(
            id="o1",
            user_id="u1",
            status=StoreOrderStatus.AWAITING_PAYMENT,
            # _is_settled short-circuits on PAID/WAIVED before looking at the
            # balance, so the stub must carry the reconciliation state a real
            # StoreOrder always has.
            payment_status=StorePaymentStatus.UNPAID,
            total=Decimal("45.00"),
            amount_paid=Decimal("0.00"),
            payment_method=None,
        )

    async def test_manager_cannot_mark_own_order_paid(self):
        svc = self._svc(self._order())
        with pytest.raises(ValueError, match="cannot mark paid your own order"):
            await svc.mark_order_paid("o1", "org1", actor_id="u1")

    async def test_manager_cannot_waive_own_order(self):
        svc = self._svc(self._order())
        with pytest.raises(ValueError, match="cannot waive your own order"):
            await svc.waive_order_payment("o1", "org1", actor_id="u1")

    async def test_manager_cannot_refund_own_order(self):
        order = self._order()
        order.amount_paid = Decimal("45.00")
        svc = self._svc(order)
        with pytest.raises(ValueError, match="cannot refund your own order"):
            await svc.refund_order("o1", "org1", actor_id="u1")

    async def test_reconciliation_actor_none_is_exempt(self):
        svc = self._svc(self._order())
        # actor_id=None (the webhook/auto-apply path) must not be blocked.
        await svc.mark_order_paid("o1", "org1", actor_id=None)
        svc.record_payment.assert_awaited()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
