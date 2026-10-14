"""Restricted funds: a fundraising campaign marked restricted, and the payments
charged to it.

Owner decisions, 2026-10-13: a campaign is the fund; its completed donations
are its money in, and purchase requests, check requests and expense lines
charged to it are its money out. The requester picks the fund on the form. The
department's ``fund_overspend_mode`` is off, warn (the default; flagged, the
approval goes through) or block (an approval the fund cannot cover is
refused).

The department's Engine fund ("Replace Engine 2"):

* donations: 1000.00 completed, 200.00 refunded, 50.00 pending — received 1000;
* spent: a purchase paid at 320.00 against a 300.00 estimate, and a 100.00
  check issued — a 40.00 check voided does not count;
* committed: a 150.00 purchase approved, and a 50.00 line on an approved
  expense report;
* awaiting approval: a 400.00 check request.

So available is 1000 - 420 - 200 = 380.00. The Gear fund is restricted with
nothing raised; the General campaign is not restricted; another department
has a fund of its own.
"""

import csv
import io
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepType,
    ApproverType,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.grant import (
    CampaignType,
    Donation,
    FundraisingCampaign,
    PaymentMethod,
    PaymentStatus,
)
from app.models.user import Organization
from app.schemas.grant import CampaignCreate
from app.schemas.organization import FinanceSettingsUpdate
from app.services.finance_report_service import FinanceReportService
from app.services.finance_service import FinanceService, FundBalanceExceededError
from app.services.fundraising_service import FundraisingService
from app.services.restricted_funds import FundNotChargeableError, fund_balances
from app.utils.finance_settings import finance_settings_in
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

D = Decimal


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# ============================================
# The rule, no database
# ============================================


@pytest.mark.unit
class TestTheRule:
    def test_warn_unless_the_department_says_otherwise(self):
        assert finance_settings_in({}).fund_overspend_mode == "warn"
        assert finance_settings_in(None).fund_overspend_mode == "warn"

    @pytest.mark.parametrize("mode", ["off", "warn", "block"])
    def test_each_mode_reads_back(self, mode):
        rules = finance_settings_in({"finance": {"fund_overspend_mode": mode}})
        assert rules.fund_overspend_mode == mode

    @pytest.mark.parametrize("junk", ["strict", 1, None, True, ["block"]])
    def test_an_unreadable_mode_falls_back_to_warn(self, junk):
        rules = finance_settings_in({"finance": {"fund_overspend_mode": junk}})
        assert rules.fund_overspend_mode == "warn"

    def test_the_settings_form_takes_only_the_three_modes(self):
        assert (
            FinanceSettingsUpdate.model_validate(
                {"fund_overspend_mode": "block"}
            ).fund_overspend_mode
            == "block"
        )
        with pytest.raises(ValidationError, match="fund_overspend_mode"):
            FinanceSettingsUpdate.model_validate({"fund_overspend_mode": "strict"})

    def test_a_restricted_campaign_needs_its_purpose(self):
        base = {
            "name": "Engine",
            "campaignType": "equipment",
            "goalAmount": "1000",
            "startDate": "2026-01-01",
        }
        with pytest.raises(ValidationError, match="purpose"):
            CampaignCreate.model_validate({**base, "isRestricted": True})
        with pytest.raises(ValidationError, match="purpose"):
            CampaignCreate.model_validate(
                {**base, "isRestricted": True, "restrictionPurpose": "  "}
            )
        made = CampaignCreate.model_validate(
            {**base, "isRestricted": True, "restrictionPurpose": "Engine 2"}
        )
        assert made.is_restricted is True
        assert CampaignCreate.model_validate(base).is_restricted is False


# ============================================
# Fixtures
# ============================================


def _campaign(org_id, name, *, restricted, purpose=None, active=True):
    return FundraisingCampaign(
        organization_id=org_id,
        name=name,
        campaign_type=CampaignType.EQUIPMENT,
        goal_amount=D("5000.00"),
        start_date=date(2026, 1, 1),
        is_restricted=restricted,
        restriction_purpose=purpose,
        active=active,
    )


def _donation(org_id, campaign_id, amount, status=PaymentStatus.COMPLETED):
    return Donation(
        organization_id=org_id,
        campaign_id=campaign_id,
        amount=D(amount),
        donation_date=utc(2026, 2, 1),
        payment_method=PaymentMethod.CHECK,
        payment_status=status,
    )


@pytest.fixture
async def funds(db_session):
    org_id = await _org(db_session, "funds")
    other_org = await _org(db_session, "elsewhere")
    treasurer_pos = await _position(
        db_session,
        org_id,
        "Treasurer",
        ["finance.view", "finance.manage", "finance.approve"],
    )
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    foreign_pos = await _position(
        db_session, other_org, "Treasurer", ["finance.view", "finance.manage"]
    )
    treasurer = await _user(db_session, org_id, "treasurer", [treasurer_pos])
    member = await _user(db_session, org_id, "member", [member_pos])
    outsider = await _user(db_session, other_org, "outsider", [foreign_pos])

    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer.id, 2026)
    engine = _campaign(org_id, "Engine fund", restricted=True, purpose="Replace E2")
    gear = _campaign(org_id, "Gear fund", restricted=True, purpose="Turnout gear")
    general = _campaign(org_id, "General", restricted=False)
    closed = _campaign(
        org_id, "Old roof fund", restricted=True, purpose="Roof", active=False
    )
    theirs = _campaign(other_org, "Their fund", restricted=True, purpose="Boat")
    db_session.add_all([year, engine, gear, general, closed, theirs])
    await db_session.flush()

    db_session.add_all(
        [
            _donation(org_id, engine.id, "1000.00"),
            _donation(org_id, engine.id, "200.00", PaymentStatus.REFUNDED),
            _donation(org_id, engine.id, "50.00", PaymentStatus.PENDING),
            _donation(org_id, general.id, "75.00"),
        ]
    )

    common = {"organization_id": org_id, "fiscal_year_id": year.id}
    paid = PurchaseRequest(
        **common,
        request_number="PR-2026-0001",
        requested_by=member.id,
        title="Hose",
        estimated_amount=D("300.00"),
        actual_amount=D("320.00"),
        status=PurchaseRequestStatus.PAID,
        paid_at=utc(2026, 3, 1),
        fund_campaign_id=engine.id,
    )
    approved = PurchaseRequest(
        **common,
        request_number="PR-2026-0002",
        requested_by=member.id,
        title="Nozzles",
        estimated_amount=D("150.00"),
        status=PurchaseRequestStatus.APPROVED,
        fund_campaign_id=engine.id,
    )
    issued = CheckRequest(
        **common,
        request_number="CR-2026-0001",
        requested_by=member.id,
        payee_name="Pump shop",
        amount=D("100.00"),
        status=CheckRequestStatus.ISSUED,
        check_date=utc(2026, 3, 2),
        fund_campaign_id=engine.id,
    )
    voided = CheckRequest(
        **common,
        request_number="CR-2026-0002",
        requested_by=member.id,
        payee_name="Wrong payee",
        amount=D("40.00"),
        status=CheckRequestStatus.VOIDED,
        check_date=utc(2026, 3, 2),
        voided_at=utc(2026, 3, 3),
        fund_campaign_id=engine.id,
    )
    waiting = CheckRequest(
        **common,
        request_number="CR-2026-0003",
        requested_by=member.id,
        payee_name="Ladder co",
        amount=D("400.00"),
        status=CheckRequestStatus.PENDING_APPROVAL,
        fund_campaign_id=engine.id,
    )
    report = ExpenseReport(
        **common,
        report_number="ER-2026-0001",
        submitted_by=member.id,
        title="Parts run",
        total_amount=D("60.00"),
        status=ExpenseReportStatus.APPROVED,
    )
    db_session.add_all([paid, approved, issued, voided, waiting, report])
    await db_session.flush()
    db_session.add_all(
        [
            ExpenseLineItem(
                expense_report_id=report.id,
                description="Gaskets",
                amount=D("50.00"),
                date_incurred=utc(2026, 3, 1),
                fund_campaign_id=engine.id,
            ),
            ExpenseLineItem(
                expense_report_id=report.id,
                description="Coffee",
                amount=D("10.00"),
                date_incurred=utc(2026, 3, 1),
            ),
        ]
    )
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "year": year.id,
        "treasurer": treasurer,
        "member": member,
        "outsider": outsider,
        "engine": engine.id,
        "gear": gear.id,
        "general": general.id,
        "closed": closed.id,
        "theirs": theirs.id,
        "approved_pr": approved.id,
        "waiting_cr": waiting.id,
    }


async def _mode(db, org_id, mode):
    org = await db.get(Organization, org_id)
    org.settings = {**(org.settings or {}), "finance": {"fund_overspend_mode": mode}}
    await db.flush()


async def _pending_check(db, funds, amount, fund_id) -> str:
    cr = CheckRequest(
        organization_id=funds["org_id"],
        fiscal_year_id=funds["year"],
        request_number=f"CR-2026-9{amount.replace('.', '')[:3]}",
        requested_by=funds["member"].id,
        payee_name="Vendor",
        amount=D(amount),
        status=CheckRequestStatus.PENDING_APPROVAL,
        fund_campaign_id=fund_id,
    )
    db.add(cr)
    await db.flush()
    return cr.id


# ============================================
# The balance
# ============================================


@pytest.mark.integration
class TestTheBalance:
    async def test_received_less_spent_and_committed(self, db_session, funds):
        engine = (await fund_balances(db_session, funds["org_id"]))[funds["engine"]]

        assert engine.received == D("1000.00")
        assert engine.spent == D("420.00")
        assert engine.committed == D("200.00")
        assert engine.awaiting_approval == D("400.00")
        assert engine.available == D("380.00")

    async def test_only_restricted_funds_of_the_department(self, db_session, funds):
        balances = await fund_balances(db_session, funds["org_id"])

        assert set(balances) == {funds["engine"], funds["gear"], funds["closed"]}

    async def test_the_report_and_its_totals(self, db_session, funds):
        report = await FinanceReportService(db_session).fund_balances(funds["org_id"])

        assert [f["name"] for f in report["funds"]] == [
            "Engine fund",
            "Gear fund",
            "Old roof fund",
        ]
        assert report["funds"][2]["active"] is False
        assert report["received"] == D("1000.00")
        assert report["available"] == D("380.00")

    async def test_as_csv(self, db_session, funds):
        async with _client(db_session, funds["treasurer"]) as client:
            resp = await client.get(
                "/finance/reports/fund-balances", params={"format": "csv"}
            )

        assert resp.status_code == 200, resp.text
        rows = list(csv.reader(io.StringIO(resp.text)))
        assert rows[0] == [
            "Fund",
            "Purpose",
            "Received",
            "Spent",
            "Committed",
            "Available",
            "Awaiting approval",
        ]
        assert rows[1] == [
            "Engine fund",
            "Replace E2",
            "1000.00",
            "420.00",
            "200.00",
            "380.00",
            "400.00",
        ]
        assert rows[-1][0] == "Total"

    async def test_another_department_sees_only_its_own(self, db_session, funds):
        async with _client(db_session, funds["outsider"]) as client:
            resp = await client.get("/finance/reports/fund-balances")

        assert resp.status_code == 200
        assert [f["name"] for f in resp.json()["funds"]] == ["Their fund"]

    async def test_a_member_cannot_read_the_report(self, db_session, funds):
        async with _client(db_session, funds["member"]) as client:
            resp = await client.get("/finance/reports/fund-balances")

        assert resp.status_code == 403


# ============================================
# Charging a fund
# ============================================


@pytest.mark.integration
class TestCharging:
    async def test_a_member_sees_the_active_funds_and_what_they_have_left(
        self, db_session, funds
    ):
        async with _client(db_session, funds["member"]) as client:
            resp = await client.get("/finance/funds")

        assert resp.status_code == 200, resp.text
        assert resp.json() == [
            {
                "campaignId": funds["engine"],
                "name": "Engine fund",
                "purpose": "Replace E2",
                "available": "380.00",
            },
            {
                "campaignId": funds["gear"],
                "name": "Gear fund",
                "purpose": "Turnout gear",
                "available": "0.00",
            },
        ]

    async def test_the_requester_charges_one_on_the_form(self, db_session, funds):
        async with _client(db_session, funds["member"]) as client:
            resp = await client.post(
                "/finance/purchase-requests",
                json={
                    "fiscalYearId": funds["year"],
                    "title": "Pike poles",
                    "estimatedAmount": "90.00",
                    "fundCampaignId": funds["engine"],
                },
            )

        assert resp.status_code in (200, 201), resp.text
        assert resp.json()["fundCampaignId"] == funds["engine"]

    @pytest.mark.parametrize("which", ["general", "closed", "theirs"])
    async def test_only_an_active_restricted_fund_of_the_department(
        self, db_session, funds, which
    ):
        with pytest.raises(FundNotChargeableError):
            await FinanceService(db_session).create_check_request(
                org_id=funds["org_id"],
                requested_by=funds["member"].id,
                fiscal_year_id=funds["year"],
                payee_name="Vendor",
                amount=D("10.00"),
                fund_campaign_id=funds[which],
            )

    async def test_an_expense_line_is_checked_too(self, db_session, funds):
        async with _client(db_session, funds["member"]) as client:
            resp = await client.post(
                "/finance/expense-reports",
                json={
                    "fiscalYearId": funds["year"],
                    "title": "Trip",
                    "lineItems": [
                        {
                            "description": "Fuel",
                            "amount": "20.00",
                            "dateIncurred": "2026-03-01T00:00:00Z",
                            "fundCampaignId": funds["theirs"],
                        }
                    ],
                },
            )

        assert resp.status_code == 400
        assert "restricted funds" in resp.json()["detail"]

    async def test_the_detail_names_the_fund_and_the_shortfall(self, db_session, funds):
        async with _client(db_session, funds["treasurer"]) as client:
            check = (
                await client.get(f"/finance/check-requests/{funds['waiting_cr']}")
            ).json()
            committed = (
                await client.get(f"/finance/purchase-requests/{funds['approved_pr']}")
            ).json()

        assert check["fundName"] == "Engine fund"
        # 400 against the 380 the others leave.
        assert check["fundShortfall"] == "20.00"
        # Approved: its charge is already counted, nothing to decide.
        assert committed["fundName"] == "Engine fund"
        assert committed["fundShortfall"] is None

    async def test_a_chain_step_waiting_on_it_is_flagged(self, db_session, funds):
        service = FinanceService(db_session)
        chain = await service.create_approval_chain(
            org_id=funds["org_id"],
            created_by=funds["treasurer"].id,
            name="Checks",
            applies_to=ApprovalEntityType.CHECK_REQUEST,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Treasurer",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                }
            ],
        )
        await service.create_approval_records(
            chain,
            ApprovalEntityType.CHECK_REQUEST,
            funds["waiting_cr"],
            400.00,
            funds["member"].id,
        )

        pending = await service.get_pending_approvals(
            funds["treasurer"], funds["org_id"]
        )

        assert [(a["entity_id"], a["fund_shortfall"]) for a in pending] == [
            (funds["waiting_cr"], D("20.00"))
        ]
        assert "charges_fund" not in pending[0]

    async def test_the_approvals_list_flags_it(self, db_session, funds):
        async with _client(db_session, funds["treasurer"]) as client:
            resp = await client.get("/finance/approvals/unrouted")

        assert resp.status_code == 200, resp.text
        rows = {r["entityId"]: r for r in resp.json()}
        assert rows[funds["waiting_cr"]]["fundShortfall"] == "20.00"


# ============================================
# Overspending
# ============================================


@pytest.mark.integration
class TestOverspending:
    async def test_warn_lets_the_approval_through(self, db_session, funds):
        await FinanceService(db_session).manual_approve(
            ApprovalEntityType.CHECK_REQUEST,
            funds["waiting_cr"],
            funds["treasurer"].id,
            org_id=funds["org_id"],
        )

        engine = (await fund_balances(db_session, funds["org_id"]))[funds["engine"]]
        assert engine.available == D("-20.00")

    async def test_off_lets_it_through(self, db_session, funds):
        await _mode(db_session, funds["org_id"], "off")
        await FinanceService(db_session).manual_approve(
            ApprovalEntityType.CHECK_REQUEST,
            funds["waiting_cr"],
            funds["treasurer"].id,
            org_id=funds["org_id"],
        )

    async def test_block_refuses_it_over_http(self, db_session, funds):
        await _mode(db_session, funds["org_id"], "block")
        async with _client(db_session, funds["treasurer"]) as client:
            resp = await client.post(
                f"/finance/approvals/manual/check_request/{funds['waiting_cr']}"
                "/approve",
                json={},
            )

        assert resp.status_code == 409, resp.text
        assert "$20.00 more than its restricted fund has left" in resp.json()["detail"]

    async def test_block_lets_a_charge_that_fits_through(self, db_session, funds):
        await _mode(db_session, funds["org_id"], "block")
        cr_id = await _pending_check(db_session, funds, "380.00", funds["engine"])

        await FinanceService(db_session).manual_approve(
            ApprovalEntityType.CHECK_REQUEST,
            cr_id,
            funds["treasurer"].id,
            org_id=funds["org_id"],
        )

        engine = (await fund_balances(db_session, funds["org_id"]))[funds["engine"]]
        assert engine.available == D("0.00")

    async def test_block_ignores_a_payment_charging_no_fund(self, db_session, funds):
        await _mode(db_session, funds["org_id"], "block")
        cr_id = await _pending_check(db_session, funds, "999.00", None)

        await FinanceService(db_session).manual_approve(
            ApprovalEntityType.CHECK_REQUEST,
            cr_id,
            funds["treasurer"].id,
            org_id=funds["org_id"],
        )

    async def test_block_adds_up_an_expense_reports_lines(self, db_session, funds):
        await _mode(db_session, funds["org_id"], "block")
        report = ExpenseReport(
            organization_id=funds["org_id"],
            fiscal_year_id=funds["year"],
            report_number="ER-2026-0002",
            submitted_by=funds["member"].id,
            title="Two lines",
            total_amount=D("400.00"),
            status=ExpenseReportStatus.PENDING_APPROVAL,
        )
        db_session.add(report)
        await db_session.flush()
        # Each line fits on its own; together they are 20.00 over.
        for amount in ("200.00", "200.00"):
            db_session.add(
                ExpenseLineItem(
                    expense_report_id=report.id,
                    description="Part",
                    amount=D(amount),
                    date_incurred=utc(2026, 3, 1),
                    fund_campaign_id=funds["engine"],
                )
            )
        await db_session.flush()

        with pytest.raises(FundBalanceExceededError):
            await FinanceService(db_session).manual_approve(
                ApprovalEntityType.EXPENSE_REPORT,
                report.id,
                funds["treasurer"].id,
                org_id=funds["org_id"],
            )

    async def test_block_refuses_paying_more_than_the_fund_has(self, db_session, funds):
        await _mode(db_session, funds["org_id"], "block")
        service = FinanceService(db_session)

        # Its own 150 estimate is released: 380 + 150 = 530 is what it may use.
        with pytest.raises(FundBalanceExceededError):
            await service.mark_pr_paid(
                funds["approved_pr"],
                funds["org_id"],
                D("530.01"),
                acted_by=funds["treasurer"].id,
            )
        pr = await service.mark_pr_paid(
            funds["approved_pr"],
            funds["org_id"],
            D("530.00"),
            acted_by=funds["treasurer"].id,
        )
        assert pr.status == PurchaseRequestStatus.PAID


# ============================================
# The campaign
# ============================================


@pytest.mark.integration
class TestTheCampaign:
    async def test_a_charged_fund_cannot_be_unrestricted(self, db_session, funds):
        with pytest.raises(ValueError, match="cannot be made unrestricted"):
            await FundraisingService(db_session).update_campaign(
                funds["engine"], funds["org_id"], {"is_restricted": False}
            )

    async def test_an_uncharged_fund_can_be(self, db_session, funds):
        campaign = await FundraisingService(db_session).update_campaign(
            funds["gear"], funds["org_id"], {"is_restricted": False}
        )

        assert campaign is not None
        assert campaign.is_restricted is False

    async def test_restricting_one_needs_a_purpose(self, db_session, funds):
        service = FundraisingService(db_session)
        with pytest.raises(ValueError, match="purpose"):
            await service.update_campaign(
                funds["general"], funds["org_id"], {"is_restricted": True}
            )
        campaign = await service.update_campaign(
            funds["general"],
            funds["org_id"],
            {"is_restricted": True, "restriction_purpose": "Community CPR"},
        )
        assert campaign is not None
        assert campaign.is_restricted is True
