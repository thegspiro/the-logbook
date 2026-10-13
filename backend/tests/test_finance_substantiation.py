"""The accountable-plan substantiation deadline for expense reports.

Owner decision, 2026-10-12: a department sets ``finance.substantiation_mode``
(``off`` by default, ``warn`` or ``block``) and ``substantiation_days`` (1-60,
60 by default, the IRS safe harbor). A line submitted more than that many days
after it was incurred is late:

* ``off`` checks nothing — the behaviour before this change;
* ``block`` refuses the submission and names the late lines;
* ``warn`` lets it through, marks the lines, and makes every approval of the
  report acknowledge them — through a chain step, a manual decision or an
  emailed token. A chain that would complete with nobody acknowledging (one
  with no approval step left) leaves the report for a manual decision.

Lines are graded once, at submission: changing the rule afterwards does not
re-grade a submitted report.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.document import Document
from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    BudgetCategory,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYearStatus,
)
from app.models.user import Organization
from app.schemas.organization import FinanceSettingsUpdate
from app.services.expense_substantiation import incurred_day, late_items
from app.services.finance_report_service import FinanceReportService
from app.services.finance_service import (
    FinanceService,
    LateSubstantiationNotAcknowledgedError,
)
from app.utils.finance_settings import finance_settings_in
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

ER = ApprovalEntityType.EXPENSE_REPORT
TZ = "America/New_York"


class _Line:
    def __init__(self, description: str, incurred: date):
        self.description = description
        self.date_incurred = datetime(incurred.year, incurred.month, incurred.day)


# ============================================
# The rule, no database
# ============================================


@pytest.mark.unit
class TestReadingTheRule:
    def test_off_and_sixty_days_by_default(self):
        rules = finance_settings_in({})
        assert (rules.substantiation_mode, rules.substantiation_days) == ("off", 60)

    def test_a_department_can_be_stricter(self):
        rules = finance_settings_in(
            {"finance": {"substantiation_mode": "block", "substantiation_days": 30}}
        )
        assert (rules.substantiation_mode, rules.substantiation_days) == ("block", 30)

    @pytest.mark.parametrize("mode", ["WARN", "on", None, 1, ["warn"]])
    def test_an_unknown_mode_reads_as_off(self, mode):
        rules = finance_settings_in({"finance": {"substantiation_mode": mode}})
        assert rules.substantiation_mode == "off"

    @pytest.mark.parametrize("days", [0, 61, 365, True, "30", 30.5, None])
    def test_days_outside_one_to_sixty_read_as_sixty(self, days):
        rules = finance_settings_in({"finance": {"substantiation_days": days}})
        assert rules.substantiation_days == 60

    @pytest.mark.parametrize("days", [0, 61])
    def test_the_settings_update_refuses_days_outside_the_safe_harbor(self, days):
        with pytest.raises(ValidationError, match="substantiation_days"):
            FinanceSettingsUpdate.model_validate({"substantiation_days": days})

    def test_the_settings_update_refuses_an_unknown_mode(self):
        with pytest.raises(ValidationError, match="substantiation_mode"):
            FinanceSettingsUpdate.model_validate({"substantiation_mode": "strict"})


@pytest.mark.unit
class TestWhichLinesAreLate:
    def test_the_sixtieth_day_is_on_time_and_the_sixty_first_is_late(self):
        submitted = date(2026, 5, 31)
        day_60 = _Line("on time", submitted - timedelta(days=60))
        day_61 = _Line("late", submitted - timedelta(days=61))

        assert late_items([day_60, day_61], submitted, 60) == [day_61]

    def test_the_incurred_day_is_the_date_written_not_shifted_by_timezone(self):
        # Stored at midnight; in New York that instant is the evening before.
        assert incurred_day(datetime(2026, 3, 1, tzinfo=timezone.utc)) == date(
            2026, 3, 1
        )


# ============================================
# Fixtures
# ============================================


def _today() -> date:
    return datetime.now(ZoneInfo(TZ)).date()


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session, "subst")
    await db_session.execute(
        Organization.__table__.update()
        .where(Organization.id == org_id)
        .values(timezone=TZ)
    )
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    officer_pos = await _position(
        db_session,
        org_id,
        "Officer",
        ["finance.request", "finance.view", "finance.approve", "finance.manage"],
    )
    alice = await _user(db_session, org_id, "alice", [member_pos])
    chief = await _user(db_session, org_id, "chief", [officer_pos])
    captain = await _user(db_session, org_id, "captain", [officer_pos])
    # Wide enough to hold every incurred date these tests use.
    year = _year(org_id, "FY", FiscalYearStatus.ACTIVE, chief.id, _today().year)
    year.start_date = datetime(_today().year - 1, 1, 1, tzinfo=timezone.utc)
    year.end_date = datetime(_today().year + 1, 12, 31, tzinfo=timezone.utc)
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    receipt = Document(organization_id=org_id, name="Receipt", file_name="r.pdf")
    db_session.add_all([year, gear, receipt])
    await db_session.flush()
    line = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=gear.id,
        amount_budgeted=Decimal("5000.00"),
        created_by=chief.id,
    )
    db_session.add(line)
    await db_session.flush()
    return {
        "org_id": org_id,
        "fy_id": year.id,
        "budget_id": line.id,
        "receipt_id": receipt.id,
        "alice": alice,
        "chief": chief,
        "captain": captain,
    }


async def _rule(db, dept, mode: str, days: int | None = None):
    org = await db.get(Organization, dept["org_id"])
    finance = {"substantiation_mode": mode}
    if days is not None:
        finance["substantiation_days"] = days
    org.settings = {**(org.settings or {}), "finance": finance}
    await db.flush()


async def _report(db, dept, *days_ago: int) -> ExpenseReport:
    """A draft with one line per entry, each incurred that many days ago."""
    return await FinanceService(db).create_expense_report(
        org_id=dept["org_id"],
        submitted_by=dept["alice"].id,
        fiscal_year_id=dept["fy_id"],
        title="Training trip",
        line_items=[
            {
                "description": f"Expense {n}",
                "amount": 25.00,
                "budget_id": dept["budget_id"],
                "date_incurred": datetime.combine(
                    _today() - timedelta(days=ago), datetime.min.time()
                ),
                "expense_type": "travel",
                "receipt_document_id": dept["receipt_id"],
            }
            for n, ago in enumerate(days_ago, start=1)
        ],
    )


async def _submit(db, dept, er_id):
    async with _client(db, dept["alice"]) as client:
        return await client.post(f"/finance/expense-reports/{er_id}/submit")


async def _fresh(db, er_id) -> ExpenseReport:
    return (
        await db.execute(
            select(ExpenseReport)
            .where(ExpenseReport.id == er_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _late_flags(db, er_id) -> list[bool]:
    result = await db.execute(
        select(ExpenseLineItem.substantiated_late)
        .where(ExpenseLineItem.expense_report_id == er_id)
        .order_by(ExpenseLineItem.description)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def _chain(db, dept, *steps):
    await FinanceService(db).create_approval_chain(
        org_id=dept["org_id"],
        created_by=dept["chief"].id,
        name="Expense review",
        applies_to=ER,
        min_amount=0,
        is_default=True,
        steps=[
            {"step_order": n, "name": f"Step {n}", **step}
            for n, step in enumerate(steps, start=1)
        ],
    )


OFFICER_STEP = {
    "step_type": ApprovalStepType.APPROVAL,
    "approver_type": ApproverType.PERMISSION,
    "approver_value": "finance.approve",
}


async def _pending_record(db, er_id) -> ApprovalStepRecord:
    return (
        await db.execute(
            select(ApprovalStepRecord)
            .where(
                ApprovalStepRecord.entity_id == er_id,
                ApprovalStepRecord.status == ApprovalStepStatus.PENDING,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


# ============================================
# Submission
# ============================================


@pytest.mark.integration
class TestSubmission:
    async def test_off_checks_nothing(self, db_session, dept):
        er = await _report(db_session, dept, 200)

        resp = await _submit(db_session, dept, er.id)

        assert resp.status_code == 200, resp.text
        assert await _late_flags(db_session, er.id) == [False]
        assert (await _fresh(db_session, er.id)).submitted_at is not None

    async def test_block_refuses_a_late_line_and_names_it(self, db_session, dept):
        await _rule(db_session, dept, "block", 30)
        er = await _report(db_session, dept, 10, 45)

        resp = await _submit(db_session, dept, er.id)

        assert resp.status_code == 400
        assert "within 30 days" in resp.json()["detail"]
        assert '"Expense 2"' in resp.json()["detail"]
        assert '"Expense 1"' not in resp.json()["detail"]
        assert (await _fresh(db_session, er.id)).status == ExpenseReportStatus.DRAFT

    async def test_block_lets_an_on_time_report_through(self, db_session, dept):
        await _rule(db_session, dept, "block")

        resp = await _submit(db_session, dept, (await _report(db_session, dept, 59)).id)

        assert resp.status_code == 200, resp.text

    async def test_warn_submits_and_marks_the_late_lines(self, db_session, dept):
        await _rule(db_session, dept, "warn")
        er = await _report(db_session, dept, 5, 90)

        resp = await _submit(db_session, dept, er.id)

        assert resp.status_code == 200, resp.text
        assert await _late_flags(db_session, er.id) == [False, True]
        assert resp.json()["lateLineCount"] == 1


# ============================================
# Approval under "warn"
# ============================================


@pytest.mark.integration
class TestApprovingUnderWarn:
    async def test_a_manual_approval_must_acknowledge(self, db_session, dept):
        await _rule(db_session, dept, "warn")
        er = await _report(db_session, dept, 90)
        await _submit(db_session, dept, er.id)
        url = f"/finance/approvals/manual/{ER.value}/{er.id}/approve"

        async with _client(db_session, dept["chief"]) as client:
            refused = await client.post(url, json={})
            unrouted = (await client.get("/finance/approvals/unrouted")).json()
            accepted = await client.post(
                url, json={"acknowledgeLateSubstantiation": True}
            )

        assert refused.status_code == 400
        assert "substantiation deadline" in refused.json()["detail"]
        [row] = [r for r in unrouted if r["entityId"] == er.id]
        assert row["lateLineCount"] == 1
        assert row["awaitingLateAcknowledgement"] is True
        assert accepted.status_code == 204, accepted.text
        er = await _fresh(db_session, er.id)
        assert er.status == ExpenseReportStatus.APPROVED
        assert er.late_acknowledged_by == dept["chief"].id
        assert er.late_acknowledged_at is not None

    async def test_a_chain_step_must_acknowledge(self, db_session, dept):
        await _rule(db_session, dept, "warn")
        await _chain(db_session, dept, OFFICER_STEP)
        er = await _report(db_session, dept, 90)
        await _submit(db_session, dept, er.id)
        record = await _pending_record(db_session, er.id)

        async with _client(db_session, dept["chief"]) as client:
            pending = (await client.get("/finance/approvals/pending")).json()
            refused = await client.post(
                f"/finance/approvals/{record.id}/approve", json={}
            )
            accepted = await client.post(
                f"/finance/approvals/{record.id}/approve",
                json={"acknowledgeLateSubstantiation": True},
            )

        [row] = [p for p in pending if p["entityId"] == er.id]
        assert row["lateLineCount"] == 1
        assert refused.status_code == 400
        assert accepted.status_code == 200, accepted.text
        assert (await _fresh(db_session, er.id)).status == ExpenseReportStatus.APPROVED

    async def test_an_on_time_report_needs_no_acknowledgement(self, db_session, dept):
        await _rule(db_session, dept, "warn")
        er = await _report(db_session, dept, 3)
        await _submit(db_session, dept, er.id)

        async with _client(db_session, dept["chief"]) as client:
            resp = await client.post(
                f"/finance/approvals/manual/{ER.value}/{er.id}/approve", json={}
            )

        assert resp.status_code == 204, resp.text

    async def test_a_chain_with_no_approver_holds_it_for_a_manual_decision(
        self, db_session, dept
    ):
        await _rule(db_session, dept, "warn")
        await _chain(
            db_session,
            dept,
            {
                "step_type": ApprovalStepType.NOTIFICATION,
                "approver_type": ApproverType.PERMISSION,
                "approver_value": "finance.approve",
            },
        )
        er = await _report(db_session, dept, 90)
        await _submit(db_session, dept, er.id)

        held_status = (await _fresh(db_session, er.id)).status
        async with _client(db_session, dept["chief"]) as client:
            detail = (await client.get(f"/finance/expense-reports/{er.id}")).json()
            accepted = await client.post(
                f"/finance/approvals/manual/{ER.value}/{er.id}/approve",
                json={"acknowledgeLateSubstantiation": True},
            )

        assert held_status == ExpenseReportStatus.PENDING_APPROVAL
        assert detail["awaitingLateAcknowledgement"] is True
        assert detail["awaitingSecondApproval"] is False
        assert accepted.status_code == 204, accepted.text
        assert (await _fresh(db_session, er.id)).status == ExpenseReportStatus.APPROVED

    async def test_an_emailed_approval_must_acknowledge(self, db_session, dept):
        await _rule(db_session, dept, "warn")
        await _chain(
            db_session,
            dept,
            {
                "step_type": ApprovalStepType.APPROVAL,
                "approver_type": ApproverType.EMAIL,
                "approver_value": "cpa@example.com",
            },
        )
        er = await _report(db_session, dept, 90)
        await _submit(db_session, dept, er.id)
        token = (await _pending_record(db_session, er.id)).approval_token
        service = FinanceService(db_session)

        with pytest.raises(LateSubstantiationNotAcknowledgedError):
            await service.approve_by_token(token)
        await service.approve_by_token(token, acknowledge_late=True)

        er = await _fresh(db_session, er.id)
        assert er.status == ExpenseReportStatus.APPROVED
        assert er.late_acknowledged_by is None
        assert er.late_acknowledged_at is not None

    async def test_turning_the_rule_off_later_does_not_regrade_it(
        self, db_session, dept
    ):
        await _rule(db_session, dept, "warn")
        er = await _report(db_session, dept, 90)
        await _submit(db_session, dept, er.id)
        await _rule(db_session, dept, "off")

        async with _client(db_session, dept["chief"]) as client:
            resp = await client.post(
                f"/finance/approvals/manual/{ER.value}/{er.id}/approve", json={}
            )

        assert resp.status_code == 400


# ============================================
# Reading the rule, and the report
# ============================================


@pytest.mark.integration
class TestReadingItBack:
    async def test_a_member_reads_the_rule_for_the_form(self, db_session, dept):
        await _rule(db_session, dept, "warn", 45)

        async with _client(db_session, dept["alice"]) as client:
            resp = await client.get("/finance/settings")

        assert resp.status_code == 200, resp.text
        assert resp.json()["substantiationMode"] == "warn"
        assert resp.json()["substantiationDays"] == 45

    async def test_paid_late_lines_are_listed_for_payroll(self, db_session, dept):
        await _rule(db_session, dept, "warn")
        er = await _report(db_session, dept, 4, 90)
        await _submit(db_session, dept, er.id)
        service = FinanceService(db_session)
        await service.manual_approve(
            ER, er.id, dept["chief"].id, org_id=dept["org_id"], acknowledge_late=True
        )
        await service.mark_expense_paid(er.id, dept["org_id"], "check")

        report = await FinanceReportService(db_session).late_substantiation(
            dept["org_id"], _today() - timedelta(days=1), _today() + timedelta(days=1)
        )
        async with _client(db_session, dept["chief"]) as client:
            csv_resp = await client.get(
                "/finance/reports/late-substantiation",
                params={
                    "start": str(_today() - timedelta(days=1)),
                    "end": str(_today() + timedelta(days=1)),
                    "format": "csv",
                },
            )

        [row] = report["rows"]
        assert row["description"] == "Expense 2"
        assert row["incurred_on"] == _today() - timedelta(days=90)
        assert row["days_to_submit"] == 90
        assert row["member_name"] == "alice Test"
        assert row["acknowledged_by_name"] == "chief Test"
        assert report["total"] == Decimal("25.00")
        assert csv_resp.status_code == 200, csv_resp.text
        assert csv_resp.text.splitlines()[0].startswith("Paid,Report,Member")
        assert csv_resp.text.splitlines()[-1].endswith("Total,25.00")

    async def test_a_member_cannot_run_the_report(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as client:
            resp = await client.get(
                "/finance/reports/late-substantiation",
                params={"start": "2026-01-01", "end": "2026-01-31"},
            )

        assert resp.status_code == 403
