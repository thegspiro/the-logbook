"""
External-recipient audit (owner decision 2026-08-09): report/notification emails
may go to any address, but every send to a non-member recipient is audit-logged so
member/compliance data leaving the department leaves a trail. DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils import external_recipients as mod
from app.utils.external_recipients import (
    audit_external_recipients,
    external_recipients,
)


def _member_rows(pairs):
    """Mock db.execute().all() returning (work_email, personal_email) rows."""
    result = MagicMock()
    result.all = MagicMock(return_value=pairs)
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db


class TestExternalRecipients:
    async def test_members_are_not_external(self):
        db = _member_rows([("chief@dept.gov", None), ("emt@dept.gov", "emt@gmail.com")])
        out = await external_recipients(db, "org1", ["chief@dept.gov", "emt@gmail.com"])
        assert out == []

    async def test_case_and_whitespace_insensitive(self):
        db = _member_rows([("Chief@Dept.gov", None)])
        out = await external_recipients(db, "org1", ["  chief@dept.GOV "])
        assert out == []

    async def test_non_members_are_flagged_and_deduped(self):
        db = _member_rows([("chief@dept.gov", None)])
        out = await external_recipients(
            db,
            "org1",
            ["chief@dept.gov", "auditor@ext.com", "AUDITOR@ext.com", ""],
        )
        # Preserves original casing of first occurrence; dedupes; drops blanks.
        assert out == ["auditor@ext.com"]

    async def test_empty_recipient_list_short_circuits(self):
        db = MagicMock()
        db.execute = AsyncMock()
        out = await external_recipients(db, "org1", [])
        assert out == []
        db.execute.assert_not_called()


class TestAuditExternalRecipients:
    async def test_audits_only_when_external_present(self):
        db = _member_rows([("chief@dept.gov", None)])
        with patch.object(mod, "log_audit_event", new=AsyncMock()) as mock_log:
            out = await audit_external_recipients(
                db,
                organization_id="org1",
                recipients=["chief@dept.gov", "auditor@ext.com"],
                context="compliance_report:annual",
                user_id="u1",
            )
        assert out == ["auditor@ext.com"]
        mock_log.assert_awaited_once()
        kwargs = mock_log.await_args.kwargs
        assert kwargs["event_type"] == "external_recipient_send"
        assert kwargs["organization_id"] == "org1"
        assert kwargs["user_id"] == "u1"
        assert kwargs["event_data"]["external_recipients"] == ["auditor@ext.com"]
        assert kwargs["event_data"]["total_recipients"] == 2

    async def test_no_audit_when_all_members(self):
        db = _member_rows([("chief@dept.gov", None)])
        with patch.object(mod, "log_audit_event", new=AsyncMock()) as mock_log:
            out = await audit_external_recipients(
                db,
                organization_id="org1",
                recipients=["chief@dept.gov"],
                context="compliance_report:annual",
            )
        assert out == []
        mock_log.assert_not_awaited()

    async def test_never_raises_on_failure(self):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=RuntimeError("db down"))
        # A classification/DB failure must not propagate and break the send.
        out = await audit_external_recipients(
            db,
            organization_id="org1",
            recipients=["auditor@ext.com"],
            context="compliance_report:annual",
        )
        assert out == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
