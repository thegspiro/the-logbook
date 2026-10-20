"""Cash advances under the accountable plan.

Owner decisions, 2026-10-14: an advance is a check request marked as cash
advanced to the requesting member; the member accounts for it with expense
reports linked to it and hands back the rest. An advance still outstanding 120
days after its check is overdue, and the member cannot submit another until it
is settled. In QuickBooks an advance is owed on an advances (asset) account:
the check debits it, the reports and returns that settle it credit it.

The department is make_books' (Training and Fuel lines, one paid transaction of
each type in March 2026), plus a member, Alice, with a $300 advance issued in
March.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.document import Document
from app.models.finance import (
    AdvanceReturn,
    Budget,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
)
from app.models.user import Organization
from app.services.cash_advances import (
    AdvanceNotSettleableError,
    OverdueAdvanceError,
    advance_balances,
)
from app.services.finance_report_service import FinanceReportService
from app.services.finance_service import FinanceService
from app.services.separation_of_duties import SeparationOfDutiesError
from tests.test_finance_quickbooks_export import (
    PAID,
    RANGE,
    _client_with,
    _export,
    _logs,
    _user,
    make_books,
)

pytestmark = [pytest.mark.integration]


async def _advance(db, books, member_id, amount="300.00", issued=PAID, number=None):
    advance = CheckRequest(
        organization_id=books["org_id"],
        request_number=number or f"CK-ADV-{amount.split('.')[0]}-{issued.day}",
        requested_by=member_id,
        fiscal_year_id=books["fy_id"],
        is_advance=True,
        payee_name="Alice Member",
        amount=Decimal(amount),
        purpose="State fire conference",
        check_number="2001",
        status=CheckRequestStatus.ISSUED,
        check_date=issued,
    )
    db.add(advance)
    await db.flush()
    return advance


@pytest.fixture
async def dept(db_session):
    books = await make_books(db_session)
    lines = (
        await db_session.execute(
            select(Budget).where(Budget.organization_id == books["org_id"])
        )
    ).scalars()
    budgets = {b.category_id: b for b in lines}
    books["training_line"] = budgets[books["training"].id]
    books["fy_id"] = books["training_line"].fiscal_year_id
    books["member_id"] = await _user(db_session, books["org_id"])
    receipt = Document(
        organization_id=books["org_id"], name="Receipt", file_name="r.pdf"
    )
    db_session.add(receipt)
    await db_session.flush()
    books["receipt_id"] = receipt.id
    books["advance"] = await _advance(db_session, books, books["member_id"])
    return books


async def _report(db, dept, amounts, advance_id=None, member_id=None):
    service = FinanceService(db)
    er = await service.create_expense_report(
        dept["org_id"],
        member_id or dept["member_id"],
        line_items=[
            {
                "description": f"Line {n}",
                "amount": Decimal(amount),
                "date_incurred": datetime.now(timezone.utc),
                "expense_type": "travel",
                "budget_id": dept["training_line"].id,
                "receipt_document_id": dept["receipt_id"],
            }
            for n, amount in enumerate(amounts, start=1)
        ],
        fiscal_year_id=dept["fy_id"],
        title="Conference",
        advance_id=advance_id,
    )
    return er


async def _submitted(db, dept, amounts, advance_id):
    er = await _report(db, dept, amounts, advance_id=advance_id)
    return await FinanceService(db).submit_expense_report(er.id, dept["org_id"])


async def _balance(db, dept, advance_id=None):
    advance_id = advance_id or dept["advance"].id
    return (await advance_balances(db, dept["org_id"], advance_ids=[advance_id]))[
        advance_id
    ]


async def _accounts(db, dept, advances="Employee Advances", cash="Operating Checking"):
    await FinanceService(db).set_advance_accounts(dept["org_id"], advances, cash)


class TestAnAdvanceIsNotAnExpense:
    async def test_an_advance_refuses_a_budget_line_or_fund(self, db_session, dept):
        service = FinanceService(db_session)
        with pytest.raises(ValueError, match="not charged to a budget line"):
            await service.create_check_request(
                dept["org_id"],
                dept["member_id"],
                fiscal_year_id=dept["fy_id"],
                is_advance=True,
                budget_id=dept["training_line"].id,
                payee_name="Alice Member",
                amount=Decimal("100.00"),
            )

    async def test_an_advance_cannot_be_given_a_budget_line_later(
        self, db_session, dept
    ):
        service = FinanceService(db_session)
        draft = await service.create_check_request(
            dept["org_id"],
            dept["member_id"],
            fiscal_year_id=dept["fy_id"],
            is_advance=True,
            payee_name="Alice Member",
            amount=Decimal("100.00"),
        )
        assert draft.is_advance is True

        with pytest.raises(ValueError, match="not charged to a budget line"):
            await service.update_check_request(
                draft.id, dept["org_id"], budget_id=dept["training_line"].id
            )


class TestAccountingForIt:
    async def test_a_submitted_report_covers_what_the_advance_has_left(
        self, db_session, dept
    ):
        er = await _submitted(db_session, dept, ["120.00", "80.00"], dept["advance"].id)

        assert er.advance_applied == Decimal("200.00")
        balance = await _balance(db_session, dept)
        assert (balance.accounted, balance.returned, balance.outstanding) == (
            Decimal("200.00"),
            Decimal("0.00"),
            Decimal("100.00"),
        )

    async def test_a_report_for_more_than_is_left_is_covered_only_up_to_it(
        self, db_session, dept
    ):
        await _submitted(db_session, dept, ["250.00"], dept["advance"].id)
        second = await _submitted(db_session, dept, ["90.00"], dept["advance"].id)

        # $50 from the advance; the other $40 is reimbursed as usual.
        assert second.advance_applied == Decimal("50.00")
        assert (await _balance(db_session, dept)).outstanding == Decimal("0.00")

    async def test_a_report_against_a_settled_advance_is_refused(
        self, db_session, dept
    ):
        await _submitted(db_session, dept, ["300.00"], dept["advance"].id)
        er = await _report(db_session, dept, ["10.00"], advance_id=dept["advance"].id)

        with pytest.raises(ValueError, match="already fully accounted for"):
            await FinanceService(db_session).submit_expense_report(
                er.id, dept["org_id"]
            )

    async def test_a_denied_report_no_longer_counts(self, db_session, dept):
        er = await _submitted(db_session, dept, ["200.00"], dept["advance"].id)
        er.status = ExpenseReportStatus.DENIED
        await db_session.flush()

        assert (await _balance(db_session, dept)).outstanding == Decimal("300.00")

    async def test_only_the_members_own_advance(self, db_session, dept):
        someone_else = await _user(db_session, dept["org_id"])

        with pytest.raises(AdvanceNotSettleableError):
            await _report(
                db_session,
                dept,
                ["10.00"],
                advance_id=dept["advance"].id,
                member_id=someone_else,
            )

    async def test_the_advance_is_fixed_once_the_report_is_submitted(
        self, db_session, dept
    ):
        er = await _submitted(db_session, dept, ["20.00"], dept["advance"].id)
        # A report in "submitted" is still editable; its advance is not.
        er.status = ExpenseReportStatus.SUBMITTED
        await db_session.flush()

        with pytest.raises(ValueError, match="only be changed while it is a draft"):
            await FinanceService(db_session).update_expense_report(
                er.id, dept["org_id"], advance_id=None
            )


class TestReturns:
    async def test_cash_returned_settles_the_rest(self, db_session, dept):
        service = FinanceService(db_session)
        await _submitted(db_session, dept, ["260.00"], dept["advance"].id)

        entry = await service.record_advance_return(
            dept["org_id"],
            dept["advance"].id,
            dept["user_id"],
            Decimal("40.00"),
            payment_method="cash",
        )

        assert entry.amount == Decimal("40.00")
        assert (await _balance(db_session, dept)).outstanding == Decimal("0.00")

    async def test_more_than_is_outstanding_is_refused(self, db_session, dept):
        with pytest.raises(ValueError, match="Only 300.00 of this advance"):
            await FinanceService(db_session).record_advance_return(
                dept["org_id"], dept["advance"].id, dept["user_id"], Decimal("300.01")
            )

    async def test_the_member_who_owes_it_does_not_record_it(self, db_session, dept):
        with pytest.raises(SeparationOfDutiesError):
            await FinanceService(db_session).record_advance_return(
                dept["org_id"], dept["advance"].id, dept["member_id"], Decimal("10")
            )

    async def test_a_return_cannot_be_dated_in_the_future(self, db_session, dept):
        with pytest.raises(ValueError, match="future"):
            await FinanceService(db_session).record_advance_return(
                dept["org_id"],
                dept["advance"].id,
                dept["user_id"],
                Decimal("10"),
                returned_at=datetime.now(timezone.utc) + timedelta(days=2),
            )

    async def test_recorded_after_the_advances_year_is_locked(self, db_session, dept):
        from app.models.finance import FiscalYear

        year = await db_session.get(FiscalYear, dept["fy_id"])
        year.is_locked = True
        await db_session.flush()

        entry = await FinanceService(db_session).record_advance_return(
            dept["org_id"], dept["advance"].id, dept["user_id"], Decimal("10")
        )

        assert entry.amount == Decimal("10.00")

    async def test_removed_until_exported(self, db_session, dept):
        service = FinanceService(db_session)
        entry = await service.record_advance_return(
            dept["org_id"], dept["advance"].id, dept["user_id"], Decimal("10")
        )
        await service.delete_advance_return(
            dept["org_id"], dept["advance"].id, entry.id
        )
        assert (await _balance(db_session, dept)).returned == Decimal("0.00")

        exported = await service.record_advance_return(
            dept["org_id"], dept["advance"].id, dept["user_id"], Decimal("10")
        )
        exported.qb_exported_at = datetime.now(timezone.utc)
        await db_session.flush()
        with pytest.raises(ValueError, match="exported to QuickBooks"):
            await service.delete_advance_return(
                dept["org_id"], dept["advance"].id, exported.id
            )


class TestOverdue:
    async def _draft_advance(self, db_session, dept):
        return await FinanceService(db_session).create_check_request(
            dept["org_id"],
            dept["member_id"],
            fiscal_year_id=dept["fy_id"],
            is_advance=True,
            payee_name="Alice Member",
            amount=Decimal("100.00"),
        )

    async def test_an_old_unsettled_advance_blocks_another(self, db_session, dept):
        # The fixture's advance was issued in March: more than 120 days ago.
        assert (await _balance(db_session, dept)).overdue is True
        draft = await self._draft_advance(db_session, dept)

        with pytest.raises(OverdueAdvanceError, match=dept["advance"].request_number):
            await FinanceService(db_session).submit_check_request(
                draft.id, dept["org_id"]
            )

    async def test_an_ordinary_check_request_is_not_blocked(self, db_session, dept):
        service = FinanceService(db_session)
        check = await service.create_check_request(
            dept["org_id"],
            dept["member_id"],
            fiscal_year_id=dept["fy_id"],
            payee_name="Hotel",
            amount=Decimal("100.00"),
        )

        submitted = await service.submit_check_request(check.id, dept["org_id"])

        assert submitted.status == CheckRequestStatus.PENDING_APPROVAL

    async def test_settling_the_old_one_lifts_the_block(self, db_session, dept):
        service = FinanceService(db_session)
        await service.record_advance_return(
            dept["org_id"], dept["advance"].id, dept["user_id"], Decimal("300.00")
        )
        draft = await self._draft_advance(db_session, dept)

        submitted = await service.submit_check_request(draft.id, dept["org_id"])

        assert submitted.status == CheckRequestStatus.PENDING_APPROVAL

    async def test_a_recent_advance_is_not_overdue(self, db_session, dept):
        recent = await _advance(
            db_session,
            dept,
            dept["member_id"],
            issued=datetime.now(timezone.utc) - timedelta(days=119),
            number="CK-RECENT",
        )

        assert (await _balance(db_session, dept, recent.id)).overdue is False


class TestVoiding:
    async def test_an_advance_with_a_report_cannot_be_voided(self, db_session, dept):
        await _submitted(db_session, dept, ["20.00"], dept["advance"].id)

        with pytest.raises(ValueError, match="cannot be voided"):
            await FinanceService(db_session).void_check(
                dept["advance"].id, dept["org_id"]
            )

    async def test_an_untouched_advance_can(self, db_session, dept):
        voided = await FinanceService(db_session).void_check(
            dept["advance"].id, dept["org_id"]
        )

        assert voided.status == CheckRequestStatus.VOIDED


async def _paid_settling_report(db, dept, applied="50.00"):
    report = ExpenseReport(
        organization_id=dept["org_id"],
        report_number="ER-ADV-0001",
        submitted_by=dept["member_id"],
        fiscal_year_id=dept["fy_id"],
        title="Conference expenses",
        total_amount=Decimal("70.00"),
        status=ExpenseReportStatus.PAID,
        paid_at=PAID,
        advance_id=dept["advance"].id,
        advance_applied=Decimal(applied),
    )
    db.add(report)
    await db.flush()
    db.add_all(
        [
            ExpenseLineItem(
                expense_report_id=report.id,
                budget_id=dept["training_line"].id,
                description=description,
                amount=Decimal(amount),
                date_incurred=PAID,
            )
            for description, amount in (("Hotel", "40.00"), ("Meals", "30.00"))
        ]
    )
    await db.flush()
    return report


def _credits(rows, account):
    return sum((Decimal(r[5]) for r in rows if r[3] == account and r[5]), Decimal(0))


def _debits(rows, account=None):
    return sum(
        (Decimal(r[4]) for r in rows if r[4] and (account is None or r[3] == account)),
        Decimal(0),
    )


class TestQuickBooks:
    async def test_the_advance_is_owed_on_the_advances_account(self, db_session, dept):
        await _accounts(db_session, dept)

        rows = await _export(db_session, dept)

        number = dept["advance"].request_number
        assert [r for r in rows if r[0] == number] == [
            [
                number,
                "03/10/2026",
                "State fire conference",
                "Employee Advances",
                "300.00",
                "",
                "Alice Member (check 2001)",
            ],
            [
                number,
                "03/10/2026",
                "State fire conference",
                "Operating Checking",
                "",
                "300.00",
                "Alice Member (check 2001)",
            ],
        ]

    async def test_a_settling_report_is_paid_from_the_advance_first(
        self, db_session, dept
    ):
        await _accounts(db_session, dept)
        await _paid_settling_report(db_session, dept)

        rows = [r for r in await _export(db_session, dept) if r[0] == "ER-ADV-0001"]

        # Both lines hit Training; $50 of the $70 clears the advance and the
        # rest is reimbursed from the bank. One line is split, so five rows.
        assert len(rows) == 5
        assert _debits(rows, "Training Expense") == Decimal("70.00")
        assert _credits(rows, "Employee Advances") == Decimal("50.00")
        assert _credits(rows, "Operating Checking") == Decimal("20.00")

    async def test_a_return_goes_back_to_the_bank(self, db_session, dept):
        await _accounts(db_session, dept)
        entry = AdvanceReturn(
            organization_id=dept["org_id"],
            advance_id=dept["advance"].id,
            amount=Decimal("25.00"),
            returned_at=PAID + timedelta(days=5),
            payment_method="cash",
            recorded_by=dept["user_id"],
        )
        db_session.add(entry)
        await db_session.flush()

        rows = await _export(db_session, dept)

        number = f"ADVR-{entry.id[:8]}"
        assert [r for r in rows if r[0] == number] == [
            [
                number,
                "03/15/2026",
                f"Advance returned: {dept['advance'].request_number}",
                "Operating Checking",
                "25.00",
                "",
                "Alice Member (cash)",
            ],
            [
                number,
                "03/15/2026",
                f"Advance returned: {dept['advance'].request_number}",
                "Employee Advances",
                "",
                "25.00",
                "Alice Member (cash)",
            ],
        ]
        await db_session.refresh(entry)
        assert entry.qb_exported_at is not None
        assert [r for r in await _export(db_session, dept) if r[0] == number] == []

    async def test_every_entry_balances(self, db_session, dept):
        await _accounts(db_session, dept)
        await _paid_settling_report(db_session, dept)

        rows = await _export(db_session, dept)

        by_entry: dict[str, Decimal] = {}
        for r in rows[1:]:
            by_entry[r[0]] = (
                by_entry.get(r[0], Decimal(0)) + Decimal(r[4] or 0) - Decimal(r[5] or 0)
            )
        assert set(by_entry.values()) == {Decimal(0)}

    async def test_refused_until_the_advance_accounts_are_set(self, db_session, dept):
        with pytest.raises(ValueError, match="cash advances have no advances account"):
            await FinanceService(db_session).generate_export(
                dept["org_id"], dept["user_id"], *RANGE
            )
        assert await _logs(db_session, dept["org_id"]) == []

    async def test_a_department_with_no_advances_needs_no_accounts(
        self, db_session, dept
    ):
        dept["advance"].status = CheckRequestStatus.CANCELLED
        await db_session.flush()

        rows = await _export(db_session, dept)

        assert any(r[0] == "PR-2026-0001" for r in rows)

    async def test_readiness_and_settings(self, db_session, dept):
        await _accounts(db_session, dept)

        advances = (
            await FinanceService(db_session).get_export_readiness(dept["org_id"])
        )["advances"]

        assert advances == {
            "status": "ready",
            "advances_account": "Employee Advances",
            "cash_account": "Operating Checking",
            "accounts_not_in_chart": [],
        }
        org = await db_session.get(Organization, dept["org_id"])
        await db_session.refresh(org)
        assert org.settings["finance"]["qb_advances_account"] == "Employee Advances"


class TestBoardReports:
    async def test_the_register_shows_cash_as_it_moved(self, db_session, dept):
        await _paid_settling_report(db_session, dept)
        db_session.add(
            AdvanceReturn(
                organization_id=dept["org_id"],
                advance_id=dept["advance"].id,
                amount=Decimal("20.00"),
                returned_at=PAID,
                recorded_by=dept["user_id"],
            )
        )
        await db_session.flush()

        report = await FinanceReportService(db_session).payments_register(
            dept["org_id"], PAID.date(), PAID.date()
        )

        rows = {(r["kind"], r["number"]): r for r in report["rows"]}
        number = dept["advance"].request_number
        assert rows[("cash_advance", number)]["amount"] == Decimal("300.00")
        assert rows[("advance_return", number)]["amount"] == Decimal("-20.00")
        settling = rows[("expense_report", "ER-ADV-0001")]
        assert settling["amount"] == Decimal("20.00")
        assert f"50.00 from advance {number}" in settling["description"]

    async def test_functional_expenses_count_the_spending_not_the_advance(
        self, db_session, dept
    ):
        await _paid_settling_report(db_session, dept)

        report = await FinanceReportService(db_session).functional_expenses(
            dept["org_id"], PAID.date(), PAID.date()
        )

        # make_books' payments (240.50 + 80 + 35) and the report's 70; not
        # the 300 advance.
        assert report["total"] == Decimal("425.50")


class TestAdvancesReport:
    async def test_lists_what_is_still_owed_and_what_is_overdue(self, db_session, dept):
        settled = await _advance(db_session, dept, dept["member_id"], number="CK-DONE")
        await FinanceService(db_session).record_advance_return(
            dept["org_id"], settled.id, dept["user_id"], Decimal("300.00")
        )
        async with await _client_with(
            db_session, dept["org_id"], ["finance.view"]
        ) as client:
            response = await client.get("/finance/reports/advances")
            download = await client.get(
                "/finance/reports/advances", params={"format": "csv"}
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert [a["requestNumber"] for a in body["advances"]] == [
            dept["advance"].request_number
        ]
        assert body["outstanding"] == "300.00"
        assert body["overdueOutstanding"] == "300.00"
        assert download.status_code == 200
        assert download.headers["content-type"].startswith("text/csv")
        lines = download.text.strip().splitlines()
        assert lines[0].startswith("Advance,Member,Purpose,Issued,Due")
        assert lines[1].startswith(f"{dept['advance'].request_number},Tess Treasurer")
        assert lines[1].endswith("300.00,yes")

    async def test_needs_finance_view(self, db_session, dept):
        async with await _client_with(
            db_session, dept["org_id"], ["finance.request"]
        ) as client:
            response = await client.get("/finance/reports/advances")

        assert response.status_code == 403


class TestEndpoints:
    async def test_a_member_sees_only_their_own_advances(self, db_session, dept):
        async with await _client_with(
            db_session, dept["org_id"], ["finance.request"]
        ) as client:
            listed = await client.get("/finance/advances")
            detail = await client.get(f"/finance/advances/{dept['advance'].id}")

        assert listed.status_code == 200
        assert listed.json() == []
        assert detail.status_code == 404

    async def test_the_finance_office_sees_balances_and_records_returns(
        self, db_session, dept
    ):
        await _submitted(db_session, dept, ["100.00"], dept["advance"].id)
        async with await _client_with(
            db_session, dept["org_id"], ["finance.manage"]
        ) as client:
            created = await client.post(
                f"/finance/advances/{dept['advance'].id}/returns",
                json={"amount": "50.00", "paymentMethod": " cash ", "reference": ""},
            )
            listed = await client.get(
                "/finance/advances", params={"outstanding_only": "true"}
            )
            detail = await client.get(f"/finance/advances/{dept['advance'].id}")
            refused = await client.post(
                f"/finance/advances/{dept['advance'].id}/returns",
                json={"amount": "500.00"},
            )

        assert created.status_code == 201, created.text
        assert created.json()["paymentMethod"] == "cash"
        assert created.json()["reference"] is None
        [row] = listed.json()
        assert row["outstanding"] == "150.00"
        assert row["overdue"] is True
        body = detail.json()
        assert body["accounted"] == "100.00"
        assert body["returned"] == "50.00"
        assert [r["advanceApplied"] for r in body["reports"]] == ["100.00"]
        assert len(body["returns"]) == 1
        assert refused.status_code == 400

    async def test_the_finance_office_sets_the_accounts(self, db_session, dept):
        async with await _client_with(
            db_session, dept["org_id"], ["finance.manage"]
        ) as client:
            response = await client.put(
                "/finance/export/advance-accounts",
                json={"advancesAccount": "Employee Advances", "cashAccount": None},
            )
            refused = await client.put(
                "/finance/export/advance-accounts",
                json={
                    "advancesAccount": "Accounts Receivable (A/R)",
                    "cashAccount": "Operating Checking",
                },
            )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "status": "no_cash_account",
            "advancesAccount": "Employee Advances",
            "cashAccount": None,
            "accountsNotInChart": [],
        }
        assert refused.status_code == 400

    async def test_finance_view_alone_cannot_set_them(self, db_session, dept):
        async with await _client_with(
            db_session, dept["org_id"], ["finance.view"]
        ) as client:
            response = await client.put(
                "/finance/export/advance-accounts",
                json={"advancesAccount": "Advances", "cashAccount": "Checking"},
            )
            returned = await client.post(
                f"/finance/advances/{dept['advance'].id}/returns",
                json={"amount": "5.00"},
            )

        assert response.status_code == 403
        assert returned.status_code == 403

    async def test_an_advance_has_no_functional_class(self, db_session, dept):
        async with await _client_with(
            db_session, dept["org_id"], ["finance.manage"]
        ) as client:
            response = await client.put(
                f"/finance/check-requests/{dept['advance'].id}/functional-class",
                json={"functionalClass": "program"},
            )

        assert response.status_code == 400
