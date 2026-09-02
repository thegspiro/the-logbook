"""
Read-permission gates (owner decision 2026-08-09):

- RPT-3: PII-bearing reports (member roster, pipeline overview) require the read
  permission for the underlying record type, not just reports.view.
- FIN-5: a plain finance.view holder sees only their own reimbursement (expense
  report) submissions; finance managers see the whole org queue.

DB mocked where needed; no MySQL.
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import reports as reports_ep
from app.api.v1.endpoints import users as users_ep
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


class TestReportPiiGateTrainingAndAdminHours:
    """RPT-29 addendum: training_summary/training_progress/annual_training/
    certification_expiration/compliance_status all return per-member name +
    training/compliance detail sourced from TrainingRecord/TrainingRequirement,
    whose org-wide access is gated behind training.manage at its source
    (training.py's /records, /compliance-matrix). admin_hours returns
    per-member name + hours + status from AdminHoursEntry, gated behind
    admin_hours.manage at its source. A plain reports.view holder must not
    reach any of the six through the reports API."""

    _TRAINING_REPORT_TYPES = (
        "training_summary",
        "training_progress",
        "annual_training",
        "certification_expiration",
        "compliance_status",
    )

    def test_pii_map_covers_training_reports_and_admin_hours(self):
        for report_type in self._TRAINING_REPORT_TYPES:
            assert (
                reports_ep.PII_REPORT_PERMISSIONS[report_type] == "training.manage"
            ), report_type
        assert reports_ep.PII_REPORT_PERMISSIONS["admin_hours"] == "admin_hours.manage"

    def test_blocks_training_reports_without_training_manage(self):
        user = SimpleNamespace()
        for report_type in self._TRAINING_REPORT_TYPES:
            with patch.object(reports_ep, "user_has_permission", return_value=False):
                with pytest.raises(HTTPException) as exc:
                    reports_ep._enforce_report_pii_permission(user, report_type)
            assert exc.value.status_code == 403
            assert "training.manage" in exc.value.detail

    def test_allows_training_reports_with_training_manage(self):
        user = SimpleNamespace()
        for report_type in self._TRAINING_REPORT_TYPES:
            with patch.object(reports_ep, "user_has_permission", return_value=True):
                reports_ep._enforce_report_pii_permission(user, report_type)

    def test_blocks_admin_hours_without_admin_hours_manage(self):
        user = SimpleNamespace()
        with patch.object(reports_ep, "user_has_permission", return_value=False):
            with pytest.raises(HTTPException) as exc:
                reports_ep._enforce_report_pii_permission(user, "admin_hours")
        assert exc.value.status_code == 403
        assert "admin_hours.manage" in exc.value.detail

    def test_allows_admin_hours_with_admin_hours_manage(self):
        user = SimpleNamespace()
        with patch.object(reports_ep, "user_has_permission", return_value=True):
            reports_ep._enforce_report_pii_permission(user, "admin_hours")


class TestMemberDirectoryGate:
    """Owner decision 2026-08-13: the member directory is member-facing.

    `members.view` ("View member list") is the baseline grant on every default
    position, and `GET /users` is the directory endpoint — the roster the
    member guide tells every member to use. RPT-3 already made members.view
    the roster-read permission for reports; this keeps the live endpoint on
    the same rule. Contact info stays governed by the org visibility setting.
    """

    def test_member_directory_accepts_members_view(self):
        dep = inspect.signature(users_ep.list_users).parameters["current_user"].default
        assert "members.view" in dep.dependency.required_permissions


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
        await svc.list_expense_reports(
            "org1", PaginationParams(skip=7, limit=13), None, restrict_to_user="u1"
        )
        statement = captured["stmt"]
        where_sql = str(statement.whereclause)
        assert "organization_id" in where_sql
        assert "submitted_by" in where_sql
        assert statement._offset_clause.value == 7
        assert statement._limit_clause.value == 13
        assert "created_at DESC" in str(statement)
        assert "expense_reports.id" in str(statement)

    async def test_list_unscoped_for_managers(self):
        svc, captured = self._capture_service()
        await svc.list_expense_reports(
            "org1", PaginationParams(skip=0, limit=10), None, restrict_to_user=None
        )
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
