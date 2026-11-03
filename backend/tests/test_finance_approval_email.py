"""Tests for the external-approver email helper (finance approvals).

Covers FinanceService.send_approval_request_email: it emails the approver a
token link, skips when misconfigured, and never raises into the caller. The
EmailService is mocked. DB mocked.
"""

from decimal import Decimal
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


def _service():
    svc = FinanceService(MagicMock())
    # The request lookup reads the database; these tests are about the send.
    svc.approval_subject = AsyncMock(return_value=None)
    return svc


class TestApprovalRequestEmail:
    async def test_sends_token_link_to_approver(self, monkeypatch):
        fake_email = MagicMock()
        fake_email.send_email = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            MagicMock(return_value=fake_email),
        )
        svc = _service()
        ok = await svc.send_approval_request_email(
            _record("tok-abc"), _step("approver@example.com"), "org-1"
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
        svc = _service()
        await svc.send_approval_request_email(
            _record(), _step(name="<script>x</script>"), "org-1"
        )
        _, kwargs = fake_email.send_email.call_args
        assert "<script>" not in kwargs["html_body"]
        assert "&lt;script&gt;" in kwargs["html_body"]

    async def test_skips_when_no_approver_email(self):
        svc = _service()
        assert (
            await svc.send_approval_request_email(_record(), _step(""), "org-1")
            is False
        )

    async def test_skips_when_no_token(self):
        svc = _service()
        assert (
            await svc.send_approval_request_email(_record(token=None), _step(), "org-1")
            is False
        )

    async def test_never_raises_on_email_failure(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            MagicMock(side_effect=RuntimeError("smtp down")),
        )
        svc = _service()
        assert (
            await svc.send_approval_request_email(_record(), _step(), "org-1") is False
        )


def _fake_email(monkeypatch, result=(1, 0)):
    fake_email = MagicMock()
    fake_email.send_email = AsyncMock(return_value=result)
    monkeypatch.setattr(
        "app.services.email_service.EmailService",
        MagicMock(return_value=fake_email),
    )
    return fake_email


class TestTheSendIsRecorded:
    """Owner decision 2026-11-01: the queue says whether a link went out."""

    async def test_a_delivered_send_is_recorded_as_sent(self, monkeypatch):
        _fake_email(monkeypatch, (1, 0))
        record = _record()
        await _service().send_approval_request_email(record, _step(), "org-1")
        assert record.email_status == "sent"
        assert record.email_status_at is not None

    async def test_a_refused_send_is_recorded_as_failed(self, monkeypatch):
        # Email off platform-wide answers (0, n), the same as a refusal.
        _fake_email(monkeypatch, (0, 1))
        record = _record()
        assert (
            await _service().send_approval_request_email(record, _step(), "org-1")
            is False
        )
        assert record.email_status == "failed"
        assert record.email_status_at is not None

    async def test_a_send_that_raises_is_recorded_as_failed(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            MagicMock(side_effect=RuntimeError("smtp down")),
        )
        record = _record()
        await _service().send_approval_request_email(record, _step(), "org-1")
        assert record.email_status == "failed"

    async def test_a_step_with_no_address_is_recorded_as_failed(self):
        record = _record()
        await _service().send_approval_request_email(record, _step(""), "org-1")
        assert record.email_status == "failed"


class TestTheEmailNamesTheRequest:
    """Owner decision 2026-11-01: title, amount and requester, escaped."""

    async def test_title_amount_and_requester_are_in_the_body(self, monkeypatch):
        fake = _fake_email(monkeypatch)
        svc = _service()
        svc.approval_subject = AsyncMock(
            return_value={
                "title": "Hose & nozzles <x>",
                "amount": Decimal("1250.5"),
                "requester_name": "Jamie <b>Rivera</b>",
            }
        )
        await svc.send_approval_request_email(_record(), _step(), "org-1")
        body = fake.send_email.call_args.kwargs["html_body"]
        assert "Hose &amp; nozzles &lt;x&gt;" in body
        assert "$1,250.50" in body
        assert "Jamie &lt;b&gt;Rivera&lt;/b&gt;" in body
        assert "<x>" not in body
        assert "<b>Rivera" not in body

    async def test_the_subject_line_names_nothing(self, monkeypatch):
        # The subject shows in a preview pane and a lock screen; the details
        # are in the body only.
        fake = _fake_email(monkeypatch)
        svc = _service()
        svc.approval_subject = AsyncMock(
            return_value={
                "title": "Secret thing",
                "amount": Decimal("5"),
                "requester_name": "Pat",
            }
        )
        await svc.send_approval_request_email(_record(), _step(), "org-1")
        assert "Secret thing" not in fake.send_email.call_args.kwargs["subject"]
