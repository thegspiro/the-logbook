"""Dues payments in the QuickBooks export.

Owner decision, 2026-10-14: a dues schedule names the QuickBooks income account
its payments are credited to and the deposit (bank) account they are debited
to; a schedule that names none takes the department's default. Each payment is
one balanced entry, sent once like every other exported payment.

The department here is make_books' (Training and Fuel, one paid transaction of
each type in March 2026), plus an Annual dues schedule with two payments in
March and one in April.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.models.finance import (
    DuesFrequency,
    DuesPayment,
    DuesSchedule,
    MemberDues,
)
from app.services.finance_service import FinanceService
from tests.test_finance_quickbooks_export import (
    RANGE,
    _client_with,
    _export,
    _logs,
    _org,
    _user,
    make_books,
)

pytestmark = [pytest.mark.integration]

MARCH_12 = datetime(2026, 3, 12, 15, 0, tzinfo=timezone.utc)


async def _schedule(db, org_id, user_id, name="Annual dues", **accounts):
    schedule = DuesSchedule(
        organization_id=org_id,
        name=name,
        amount=Decimal("100.00"),
        frequency=DuesFrequency.ANNUAL,
        due_date=datetime(2026, 1, 31, tzinfo=timezone.utc),
        created_by=user_id,
        **accounts,
    )
    db.add(schedule)
    await db.flush()
    return schedule


async def _payment(db, org_id, schedule, user_id, amount, when, **extra):
    dues = MemberDues(
        organization_id=org_id,
        dues_schedule_id=schedule.id,
        user_id=user_id,
        amount_due=Decimal("100.00"),
        due_date=datetime(2026, 1, 31, tzinfo=timezone.utc),
    )
    db.add(dues)
    await db.flush()
    payment = DuesPayment(
        organization_id=org_id,
        member_dues_id=dues.id,
        amount=Decimal(amount),
        received_at=when,
        **extra,
    )
    db.add(payment)
    await db.flush()
    return payment


async def _defaults(db, org_id, income="Dues Income", deposit="Operating Checking"):
    await FinanceService(db).set_dues_default_accounts(org_id, income, deposit)


@pytest.fixture
async def books(db_session):
    books = await make_books(db_session)
    schedule = await _schedule(db_session, books["org_id"], books["user_id"])
    books["schedule"] = schedule
    books["check_payment"] = await _payment(
        db_session,
        books["org_id"],
        schedule,
        books["user_id"],
        "100.00",
        MARCH_12,
        payment_method="check",
        transaction_reference="2041",
    )
    books["cash_payment"] = await _payment(
        db_session,
        books["org_id"],
        schedule,
        books["user_id"],
        "40.00",
        MARCH_12,
        payment_method="cash",
    )
    books["april_payment"] = await _payment(
        db_session,
        books["org_id"],
        schedule,
        books["user_id"],
        "60.00",
        datetime(2026, 4, 2, 15, tzinfo=timezone.utc),
    )
    return books


def _dues_rows(rows):
    return [r for r in rows if r[0].startswith("DUES-")]


class TestTheEntries:
    async def test_each_payment_is_a_balanced_entry_on_the_default_accounts(
        self, db_session, books
    ):
        await _defaults(db_session, books["org_id"])

        rows = _dues_rows(await _export(db_session, books))

        check_no = f"DUES-{books['check_payment'].id[:8]}"
        assert [r for r in rows if r[0] == check_no] == [
            [
                check_no,
                "03/12/2026",
                "Dues: Annual dues",
                "Operating Checking",
                "100.00",
                "",
                "Tess Treasurer (check, 2041)",
            ],
            [
                check_no,
                "03/12/2026",
                "Dues: Annual dues",
                "Dues Income",
                "",
                "100.00",
                "Tess Treasurer (check, 2041)",
            ],
        ]
        # The two March payments only; April's is outside the period.
        assert len(rows) == 4

    async def test_a_schedules_own_account_wins_piece_by_piece(self, db_session, books):
        await _defaults(db_session, books["org_id"])
        books["schedule"].qb_income_account = "Dues Income:Annual"
        await db_session.flush()

        rows = _dues_rows(await _export(db_session, books))

        assert {r[3] for r in rows} == {"Operating Checking", "Dues Income:Annual"}

    async def test_sent_once_and_sent_again_on_request(self, db_session, books):
        await _defaults(db_session, books["org_id"])
        service = FinanceService(db_session)

        await _export(db_session, books)
        await db_session.refresh(books["check_payment"])
        assert books["check_payment"].qb_exported_at is not None

        again = _dues_rows(await _export(db_session, books))
        assert again == []

        stream = await service.generate_export(
            books["org_id"], books["user_id"], *RANGE, include_exported=True
        )
        content = "".join([chunk async for chunk in stream])
        assert content.count("DUES-") == 4

    async def test_another_departments_dues_stay_out(self, db_session, books):
        await _defaults(db_session, books["org_id"])
        other_org = await _org(db_session)
        other_user = await _user(db_session, other_org)
        theirs = await _schedule(
            db_session,
            other_org,
            other_user,
            qb_income_account="Their Income",
            qb_deposit_account="Their Bank",
        )
        await _payment(db_session, other_org, theirs, other_user, "75.00", MARCH_12)

        rows = _dues_rows(await _export(db_session, books))

        assert "Their Income" not in {r[3] for r in rows}
        assert len(rows) == 4


class TestRefused:
    async def test_a_schedule_with_no_income_account_refuses_the_export(
        self, db_session, books
    ):
        with pytest.raises(
            ValueError, match="dues 'Annual dues' has no income account"
        ):
            await FinanceService(db_session).generate_export(
                books["org_id"], books["user_id"], *RANGE
            )
        assert await _logs(db_session, books["org_id"]) == []

    async def test_with_no_deposit_account(self, db_session, books):
        await _defaults(db_session, books["org_id"], deposit=None)

        with pytest.raises(
            ValueError, match="dues 'Annual dues' has no deposit account"
        ):
            await FinanceService(db_session).generate_export(
                books["org_id"], books["user_id"], *RANGE
            )

    async def test_a_schedule_with_no_payments_in_the_period_does_not_block(
        self, db_session, books
    ):
        await _defaults(db_session, books["org_id"])
        await _schedule(db_session, books["org_id"], books["user_id"], name="Fines")
        await _defaults(db_session, books["org_id"], income=None)
        books["schedule"].qb_income_account = "Dues Income"
        await db_session.flush()

        rows = _dues_rows(await _export(db_session, books))

        assert len(rows) == 4

    async def test_payable_or_receivable_is_refused_where_it_is_set(
        self, db_session, books
    ):
        service = FinanceService(db_session)
        with pytest.raises(ValueError, match="Accounts Payable"):
            await service.set_dues_default_accounts(
                books["org_id"], "Accounts Receivable (A/R)", "Operating Checking"
            )
        with pytest.raises(ValueError, match="Accounts Payable"):
            await service.update_dues_schedule(
                books["schedule"].id,
                books["org_id"],
                qb_deposit_account="Accounts Payable (A/P)",
            )


class TestReadinessAndSettings:
    async def test_readiness_lists_each_schedule_and_where_its_accounts_come_from(
        self, db_session, books
    ):
        await _defaults(db_session, books["org_id"])
        books["schedule"].qb_income_account = "Dues Income:Annual"
        await db_session.flush()

        dues = (await FinanceService(db_session).get_export_readiness(books["org_id"]))[
            "dues"
        ]

        assert dues["default_income_account"] == "Dues Income"
        assert dues["default_deposit_account"] == "Operating Checking"
        [annual] = dues["schedules"]
        assert annual["status"] == "ready"
        assert (annual["income_account"], annual["income_source"]) == (
            "Dues Income:Annual",
            "schedule",
        )
        assert (annual["deposit_account"], annual["deposit_source"]) == (
            "Operating Checking",
            "default",
        )

    async def test_the_finance_office_sets_and_clears_the_default(
        self, db_session, books
    ):
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            set_resp = await client.put(
                "/finance/export/dues-accounts",
                json={
                    "incomeAccount": " Dues Income ",
                    "depositAccount": "Operating Checking",
                },
            )
            cleared = await client.put(
                "/finance/export/dues-accounts",
                json={"incomeAccount": None, "depositAccount": "Operating Checking"},
            )
            refused = await client.put(
                "/finance/export/dues-accounts",
                json={
                    "incomeAccount": "Accounts Receivable (A/R)",
                    "depositAccount": "Operating Checking",
                },
            )

        assert set_resp.status_code == 200, set_resp.text
        assert set_resp.json()["defaultIncomeAccount"] == "Dues Income"
        assert set_resp.json()["schedules"][0]["status"] == "ready"
        assert cleared.status_code == 200
        assert cleared.json()["defaultIncomeAccount"] is None
        assert cleared.json()["schedules"][0]["status"] == "no_income"
        assert refused.status_code == 400

    async def test_finance_view_alone_cannot_set_it(self, db_session, books):
        async with await _client_with(
            db_session, books["org_id"], ["finance.view"]
        ) as client:
            response = await client.put(
                "/finance/export/dues-accounts",
                json={"incomeAccount": "Dues Income", "depositAccount": "Checking"},
            )

        assert response.status_code == 403

    async def test_setting_the_default_keeps_the_departments_other_finance_rules(
        self, db_session, books
    ):
        from app.models.user import Organization

        org = await db_session.get(Organization, books["org_id"])
        org.settings = {"finance": {"substantiation_mode": "warn"}}
        await db_session.flush()

        await _defaults(db_session, books["org_id"])

        await db_session.refresh(org)
        assert org.settings["finance"] == {
            "substantiation_mode": "warn",
            "qb_dues_income_account": "Dues Income",
            "qb_dues_deposit_account": "Operating Checking",
        }
