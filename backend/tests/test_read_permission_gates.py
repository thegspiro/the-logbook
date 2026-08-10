"""
Read-permission gates (owner decision 2026-08-09):

- RPT-3: PII-bearing reports (member roster, pipeline overview) require the read
  permission for the underlying record type, not just reports.view.
- FIN-5: a plain finance.view holder sees only their own reimbursement (expense
  report) submissions; finance managers see the whole org queue.

DB mocked where needed; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import reports as reports_ep
from app.services.finance_service import FinanceService


class TestReportPiiGate:
    def test_pii_map_covers_roster_and_pipeline(self):
        assert reports_ep.PII_REPORT_PERMISSIONS["member_roster"] == "members.view"
        assert (
            reports_ep.PII_REPORT_PERMISSIONS["pipeline_overview"]
            == "prospective_members.view"
        )

    def test_blocks_roster_without_members_view(self):
        user = SimpleNamespace()
        with patch.object(reports_ep, "user_has_permission", return_value=False):
            with pytest.raises(HTTPException) as exc:
                reports_ep._enforce_report_pii_permission(user, "member_roster")
        assert exc.value.status_code == 403
        assert "members.view" in exc.value.detail

    def test_allows_roster_with_members_view(self):
        user = SimpleNamespace()
        with patch.object(reports_ep, "user_has_permission", return_value=True):
            # Must not raise.
            reports_ep._enforce_report_pii_permission(user, "member_roster")

    def test_non_pii_report_is_never_gated(self):
        user = SimpleNamespace()
        # Even if the user has no extra permission, an aggregate report passes.
        with patch.object(reports_ep, "user_has_permission", return_value=False):
            reports_ep._enforce_report_pii_permission(user, "call_volume")


class TestExpenseReportScoping:
    @staticmethod
    def _capture_service():
        """FinanceService whose db.execute records the statement it was given."""
        captured = {}

        async def _execute(stmt):
            captured["stmt"] = stmt
            result = MagicMock()
            result.scalars.return_value.unique.return_value.all.return_value = []
            result.scalar_one_or_none.return_value = None
            return result

        db = MagicMock()
        db.execute = AsyncMock(side_effect=_execute)
        return FinanceService(db), captured

    async def test_list_scopes_to_user_when_restricted(self):
        svc, captured = self._capture_service()
        await svc.list_expense_reports("org1", None, restrict_to_user="u1")
        assert "submitted_by" in str(captured["stmt"].whereclause)

    async def test_list_unscoped_for_managers(self):
        svc, captured = self._capture_service()
        await svc.list_expense_reports("org1", None, restrict_to_user=None)
        assert "submitted_by" not in str(captured["stmt"].whereclause)

    async def test_get_scopes_to_user_when_restricted(self):
        svc, captured = self._capture_service()
        await svc.get_expense_report("er1", "org1", restrict_to_user="u1")
        assert "submitted_by" in str(captured["stmt"].whereclause)

    async def test_get_unscoped_for_managers(self):
        svc, captured = self._capture_service()
        await svc.get_expense_report("er1", "org1")
        assert "submitted_by" not in str(captured["stmt"].whereclause)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
