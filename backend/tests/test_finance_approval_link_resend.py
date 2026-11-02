"""Emailed approval links: send status, expiry, re-send, and what the approver sees.

Owner decisions 2026-11-01 (KNOWN_LIMITATIONS "Finance — Emailed Approvals
Cannot Be Re-Sent, and Show the Approver Nothing to Decide On"):

- the approvals queue says whether an emailed link was sent, failed to send,
  or has expired, instead of always reading "waiting on <address>";
- an approvals admin can re-send: a fresh link, the old one dead, the send
  recorded and audit-logged, and a repeated re-send a no-op;
- the emailed page shows the request's title, amount and requester.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.finance import ApprovalStepStatus, ApprovalStepType, ApproverType
from app.services.finance_service import FinanceService, approval_email_delivery
from tests.test_finance_approver_enforcement import (
    _approval,
    _client,
    _make_member,
    _make_org,
    _pending_pr,
)

APPROVER = "cpa@example.com"


# ============================================
# The queue's reading of a link (pure)
# ============================================


@pytest.mark.unit
class TestTheDeliveryReading:
    NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)

    def _read(self, **overrides):
        args = {
            "step_type": ApprovalStepType.APPROVAL,
            "approver_type": ApproverType.EMAIL,
            "has_link": True,
            "expires_at": self.NOW + timedelta(days=3),
            "email_status": "sent",
            "now": self.NOW,
        }
        args.update(overrides)
        return approval_email_delivery(**args)

    def test_a_delivered_live_link_reads_sent(self):
        assert self._read() == "sent"

    def test_a_failed_send_reads_failed(self):
        assert self._read(email_status="failed") == "failed"

    def test_a_failed_send_outranks_expiry(self):
        assert (
            self._read(email_status="failed", expires_at=self.NOW - timedelta(days=1))
            == "failed"
        )

    def test_a_link_past_its_expiry_reads_expired(self):
        assert self._read(expires_at=self.NOW - timedelta(seconds=1)) == "expired"

    def test_a_naive_expiry_is_read_as_utc(self):
        naive = (self.NOW - timedelta(minutes=1)).replace(tzinfo=None)
        assert self._read(expires_at=naive) == "expired"

    def test_a_link_from_before_tracking_reads_unknown(self):
        assert self._read(email_status=None) == "unknown"

    def test_an_email_step_without_a_link_reads_not_sent(self):
        assert self._read(has_link=False, email_status=None) == "not_sent"

    def test_any_other_step_has_no_reading(self):
        assert self._read(approver_type=ApproverType.POSITION) is None
        assert self._read(step_type=ApprovalStepType.NOTIFICATION) is None


# ============================================
# Database-backed
# ============================================


def _email(monkeypatch, result=(1, 0)):
    fake = MagicMock()
    fake.send_email = AsyncMock(return_value=result)
    monkeypatch.setattr(
        "app.services.email_service.EmailService", MagicMock(return_value=fake)
    )
    return fake


async def _setup(db_session, monkeypatch, result=(1, 0)):
    fake = _email(monkeypatch, result)
    org_id = await _make_org(db_session)
    requester = await _make_member(
        db_session, org_id, "finance.manage", first_name="Jamie"
    )
    officer = await _make_member(db_session, org_id, "finance.view", "finance.approve")
    admin = await _make_member(
        db_session,
        org_id,
        "finance.view",
        "finance.approve",
        "finance.configure_approvals",
    )
    service = FinanceService(db_session)
    pr, _chain, records = await _pending_pr(
        service,
        org_id,
        requester.id,
        [_approval(approver_type="email", value=APPROVER, name="CPA review")],
        title="Hose & nozzles",
    )
    await db_session.flush()
    return {
        "fake": fake,
        "org_id": org_id,
        "officer": officer,
        "admin": admin,
        "service": service,
        "pr": pr,
        "record": records[0],
    }


async def _queue_row(db_session, caller, record_id):
    async with _client(db_session, caller) as client:
        response = await client.get("/finance/approvals/pending")
    assert response.status_code == 200, response.text
    (row,) = [r for r in response.json() if r["stepRecordId"] == record_id]
    return row


async def _resend(db_session, caller, record_id, version):
    async with _client(db_session, caller) as client:
        return await client.post(
            f"/finance/approvals/{record_id}/resend-email",
            json={"linkVersion": version},
        )


@pytest.mark.integration
class TestTheSendStatusIsRecordedAndShown:
    async def test_a_failed_send_is_recorded_and_shown(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch, result=(0, 1))
        record = s["record"]
        assert record.approval_token
        assert record.email_status == "failed"

        row = await _queue_row(db_session, s["admin"], record.id)
        assert row["emailDelivery"] == "failed"
        assert row["emailStatusAt"] is not None
        assert row["emailLinkVersion"] == 1
        assert row["canResendEmail"] is True
        # The link is a bearer token for someone else's approval.
        assert record.approval_token not in str(row)

    async def test_a_delivered_send_reads_sent(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch)
        row = await _queue_row(db_session, s["admin"], s["record"].id)
        assert row["emailDelivery"] == "sent"
        s["fake"].send_email.assert_awaited_once()

    async def test_an_expired_link_reads_expired(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch)
        s["record"].token_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await db_session.flush()
        row = await _queue_row(db_session, s["admin"], s["record"].id)
        assert row["emailDelivery"] == "expired"


@pytest.mark.integration
class TestResend:
    async def test_resend_mints_a_new_link_and_kills_the_old_one(
        self, db_session, monkeypatch
    ):
        s = await _setup(db_session, monkeypatch, result=(0, 1))
        record = s["record"]
        old_token = record.approval_token
        s["fake"].send_email.return_value = (1, 0)

        response = await _resend(db_session, s["admin"], record.id, 1)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["resent"] is True
        assert body["emailDelivery"] == "sent"
        assert body["emailLinkVersion"] == 2
        assert old_token not in response.text

        assert record.approval_token
        assert record.approval_token != old_token
        assert record.email_status == "sent"
        assert record.token_expires_at > datetime.now(timezone.utc) + timedelta(days=6)
        sent_body = s["fake"].send_email.call_args.kwargs["html_body"]
        assert record.approval_token in sent_body
        assert old_token not in sent_body

        with pytest.raises(ValueError, match="Invalid approval token"):
            await s["service"].approve_by_token(old_token)
        assert record.status == ApprovalStepStatus.PENDING

        log = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type == "finance.approval_link_resent",
                        AuditLog.user_id == s["admin"].id,
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert log.event_data["step_record_id"] == record.id
        assert record.approval_token not in str(log.event_data)

    async def test_a_repeated_resend_is_a_no_op(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch)
        record = s["record"]
        assert s["fake"].send_email.await_count == 1

        first = await _resend(db_session, s["admin"], record.id, 1)
        assert first.status_code == 200, first.text
        token_after_first = record.approval_token

        second = await _resend(db_session, s["admin"], record.id, 1)
        assert second.status_code == 200, second.text
        assert second.json()["resent"] is False
        assert second.json()["emailLinkVersion"] == 2
        assert record.approval_token == token_after_first
        assert s["fake"].send_email.await_count == 2

    async def test_a_failed_resend_is_recorded(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch)
        s["fake"].send_email.return_value = (0, 1)
        response = await _resend(db_session, s["admin"], s["record"].id, 1)
        assert response.status_code == 200, response.text
        assert response.json()["emailDelivery"] == "failed"
        assert s["record"].email_status == "failed"

    async def test_a_named_approver_without_the_admin_permission_is_refused(
        self, db_session, monkeypatch
    ):
        s = await _setup(db_session, monkeypatch)
        old_token = s["record"].approval_token
        response = await _resend(db_session, s["officer"], s["record"].id, 1)
        assert response.status_code == 403
        assert s["record"].approval_token == old_token

    async def test_another_organizations_admin_gets_404(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch)
        other_org = await _make_org(db_session)
        outsider = await _make_member(
            db_session,
            other_org,
            "finance.view",
            "finance.approve",
            "finance.configure_approvals",
        )
        old_token = s["record"].approval_token
        response = await _resend(db_session, outsider, s["record"].id, 1)
        assert response.status_code == 404
        assert s["record"].approval_token == old_token
        assert s["fake"].send_email.await_count == 1

    async def test_a_step_that_emails_nobody_cannot_be_resent(
        self, db_session, monkeypatch
    ):
        _email(monkeypatch)
        org_id = await _make_org(db_session)
        requester = await _make_member(db_session, org_id, "finance.manage")
        admin = await _make_member(
            db_session,
            org_id,
            "finance.approve",
            "finance.configure_approvals",
            slug="treasurer",
        )
        _pr, _chain, records = await _pending_pr(
            FinanceService(db_session),
            org_id,
            requester.id,
            [_approval(approver_type="position", value="treasurer")],
        )
        response = await _resend(db_session, admin, records[0].id, 0)
        assert response.status_code == 409
        assert records[0].approval_token is None


# ============================================
# The emailed approval page
# ============================================


def _public_client(db_session, monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.public import finance_approvals
    from app.core.database import get_db

    monkeypatch.setattr(
        finance_approvals, "public_rate_limit", AsyncMock(return_value=(False, None))
    )
    app = FastAPI()
    app.include_router(finance_approvals.router)
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.integration
class TestTheApproverSeesWhatTheyAreDeciding:
    async def test_the_page_shows_title_amount_and_requester(
        self, db_session, monkeypatch
    ):
        s = await _setup(db_session, monkeypatch)
        token = s["record"].approval_token
        async with _public_client(db_session, monkeypatch) as client:
            response = await client.get(f"/public/v1/finance/approvals/{token}")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["actionable"] is True
        assert body["title"] == "Hose & nozzles"
        assert Decimal(body["amount"]) == Decimal("1000.00")
        assert body["requester_name"] == "Jamie Member"
        # The description stays behind the login.
        assert "description" not in body

    async def test_an_expired_link_describes_nothing(self, db_session, monkeypatch):
        s = await _setup(db_session, monkeypatch)
        s["record"].token_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await db_session.flush()
        async with _public_client(db_session, monkeypatch) as client:
            response = await client.get(
                f"/public/v1/finance/approvals/{s['record'].approval_token}"
            )
        body = response.json()
        assert body["expired"] is True
        assert body["title"] is None
        assert body["amount"] is None
        assert body["requester_name"] is None

    async def test_the_email_carries_title_amount_and_requester(
        self, db_session, monkeypatch
    ):
        s = await _setup(db_session, monkeypatch)
        html_body = s["fake"].send_email.call_args.kwargs["html_body"]
        assert "Hose &amp; nozzles" in html_body
        assert "$1,000.00" in html_body
        assert "Jamie Member" in html_body
