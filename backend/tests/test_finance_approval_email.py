"""Tests for the external-approver email helper (finance approvals).

Covers FinanceService.send_approval_request_email: it emails the approver a
token link, skips when misconfigured, and never raises into the caller. The
EmailService is mocked. DB mocked.
"""

from unittest.mock import AsyncMock, MagicMock

from app.services.finance_service import FinanceService


def _step(email="approver@example.com", name="CFO Approval"):
    step = MagicMock()
    step.approver_value = email
    step.name = name
    return step


def _record(token="tok-123456789012345678901234"):
    record = MagicMock()
    record.approval_token = token
    return record


class TestApprovalRequestEmail:
    async def test_sends_token_link_to_approver(self, monkeypatch):
        fake_email = MagicMock()
        fake_email.send_email = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            MagicMock(return_value=fake_email),
        )
        svc = FinanceService(MagicMock())
        ok = await svc.send_approval_request_email(
            _record("tok-abc"), _step("approver@example.com")
        )
        assert ok is True
        fake_email.send_email.assert_awaited_once()
        _, kwargs = fake_email.send_email.call_args
        assert kwargs["to_emails"] == ["approver@example.com"]
        assert "tok-abc" in kwargs["html_body"]
        assert "finance/approvals/tok-abc" in kwargs["html_body"]

    async def test_escapes_step_name(self, monkeypatch):
        fake_email = MagicMock()
        fake_email.send_email = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            MagicMock(return_value=fake_email),
        )
        svc = FinanceService(MagicMock())
        await svc.send_approval_request_email(
            _record(), _step(name="<script>x</script>")
        )
        _, kwargs = fake_email.send_email.call_args
        assert "<script>" not in kwargs["html_body"]
        assert "&lt;script&gt;" in kwargs["html_body"]

    async def test_skips_when_no_approver_email(self):
        svc = FinanceService(MagicMock())
        assert await svc.send_approval_request_email(_record(), _step("")) is False

    async def test_skips_when_no_token(self):
        svc = FinanceService(MagicMock())
        assert await svc.send_approval_request_email(_record(token=None), _step()) is False

    async def test_never_raises_on_email_failure(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            MagicMock(side_effect=RuntimeError("smtp down")),
        )
        svc = FinanceService(MagicMock())
        assert await svc.send_approval_request_email(_record(), _step()) is False
