"""Cash advances: the owner's decisions of 2026-11-01.

1. **On behalf.** A ``finance.manage`` holder raises an advance for a named
   member. The member holds it -- it is theirs to account for, its overdue
   block and statements are theirs -- and the officer is recorded as having
   raised it, and may then neither approve it nor issue its check. The member
   must be a current member of the department.
2. **Periodic statements.** A department may choose the IRS periodic
   statement method: a statement at each calendar-quarter end after the
   check, and 120 days from the first one to account for the advance. The
   deadline drives the same overdue rule as the fixed-date method. An advance
   keeps the method in force when its check was issued. The statements are
   emailed to the holder once each.
3. **At close.** A year's outstanding advances are listed among its open
   items, without stopping the lock.

The department is make_books' (UTC calendar), with a member, Alice.
"""

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import finance as finance_endpoints
from app.core.database import get_db
from app.models.finance import (
    AdvanceStatement,
    ApprovalEntityType,
    Budget,
    CheckRequest,
    CheckRequestStatus,
    FiscalYear,
    FiscalYearStatus,
)
from app.models.user import Organization, User
from app.services import cash_advance_statements as statements
from app.services.cash_advances import (
    AdvanceHolderError,
    OverdueAdvanceError,
    advance_balances,
    first_statement_date,
)
from app.services.finance_service import FinanceService
from app.services.separation_of_duties import SeparationOfDutiesError
from tests.test_finance_budget_request_notices import _Mailer
from tests.test_finance_cash_advances import _advance
from tests.test_finance_quickbooks_export import _org, _user, make_books

pytestmark = [pytest.mark.integration]

PERIODIC = "periodic_statement"
FIXED = "fixed_date"


@pytest.fixture
async def dept(db_session):
    """make_books' department, a member (Alice) and her $300 March advance,
    issued 10 March 2026 and never accounted for."""
    books = await make_books(db_session)
    line = (
        await db_session.execute(
            select(Budget).where(Budget.organization_id == books["org_id"]).limit(1)
        )
    ).scalar_one()
    books["fy_id"] = line.fiscal_year_id
    books["member_id"] = await _user(db_session, books["org_id"])
    books["advance"] = await _advance(db_session, books, books["member_id"])
    return books


async def _officer(db, org_id: str, permissions=("finance.manage",)):
    """A member holding ``permissions`` through a position, and a client
    signed in as them."""
    user_id = await _user(db, org_id)
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"Treasurer {position_id[:6]}",
            "slug": f"treasurer-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()
    user = await db.get(User, user_id)
    await db.refresh(user, ["positions"])
    app = FastAPI()
    app.include_router(finance_endpoints.router, prefix="/finance")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return user_id, AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    )


async def _method(db, org_id: str, method: str) -> None:
    org = await db.get(Organization, org_id)
    org.settings = {
        **(org.settings or {}),
        "finance": {"advance_return_method": method},
    }
    await db.flush()


def _payload(dept, **extra):
    return {
        "fiscalYearId": dept["fy_id"],
        "isAdvance": True,
        "payeeName": "Alice Member",
        "amount": "250.00",
        "purpose": "Conference",
        **extra,
    }


async def _approved_on_behalf(db, dept, officer_id):
    """An advance the officer raised for Alice, submitted and approved by a
    second officer, waiting to be issued."""
    service = FinanceService(db)
    cr = await service.create_check_request(
        dept["org_id"],
        dept["member_id"],
        raised_by=officer_id,
        fiscal_year_id=dept["fy_id"],
        is_advance=True,
        payee_name="Alice Member",
        amount=Decimal("250.00"),
    )
    # The holder's March advance must not block this one.
    await service.record_advance_return(
        dept["org_id"], dept["advance"].id, officer_id, Decimal("300.00")
    )
    await service.submit_check_request(cr.id, dept["org_id"])
    return cr


# ============================================
# 1. On behalf
# ============================================


class TestRaisingForAMember:
    async def test_the_member_holds_it_and_the_officer_is_recorded(
        self, db_session, dept
    ):
        officer_id, client = await _officer(db_session, dept["org_id"])
        async with client:
            response = await client.post(
                "/finance/check-requests",
                json=_payload(dept, advanceHolderId=dept["member_id"]),
            )
            mine = await client.get("/finance/check-requests/" + response.json()["id"])

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["requestedBy"] == dept["member_id"]
        assert body["raisedBy"] == officer_id
        assert mine.json()["raisedBy"] == officer_id
        logged = (
            await db_session.execute(
                text(
                    "SELECT event_data FROM audit_logs "
                    "WHERE event_type = 'finance.advance_raised_on_behalf'"
                )
            )
        ).scalars()
        assert any(body["id"] in str(row) for row in logged)

    async def test_the_member_sees_it_as_their_own(self, db_session, dept):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        cr = await FinanceService(db_session).create_check_request(
            dept["org_id"],
            dept["member_id"],
            raised_by=officer_id,
            fiscal_year_id=dept["fy_id"],
            is_advance=True,
            payee_name="Alice Member",
            amount=Decimal("80.00"),
        )

        theirs = await FinanceService(db_session).get_check_request(
            cr.id, dept["org_id"], restrict_to_user=dept["member_id"]
        )
        assert theirs is not None
        assert theirs.raised_by == officer_id

    async def test_raising_ones_own_records_no_raiser(self, db_session, dept):
        officer_id, client = await _officer(db_session, dept["org_id"])
        async with client:
            response = await client.post(
                "/finance/check-requests",
                json=_payload(dept, advanceHolderId=officer_id),
            )

        assert response.status_code == 201, response.text
        assert response.json()["requestedBy"] == officer_id
        assert response.json()["raisedBy"] is None

    async def test_a_requester_cannot_raise_one_for_someone_else(
        self, db_session, dept
    ):
        _id, client = await _officer(db_session, dept["org_id"], ["finance.request"])
        async with client:
            response = await client.post(
                "/finance/check-requests",
                json=_payload(dept, advanceHolderId=dept["member_id"]),
            )

        assert response.status_code == 403
        assert (
            await db_session.execute(
                select(CheckRequest).where(
                    CheckRequest.requested_by == dept["member_id"],
                    CheckRequest.status == CheckRequestStatus.DRAFT,
                )
            )
        ).first() is None

    async def test_only_an_advance(self, db_session, dept):
        _id, client = await _officer(db_session, dept["org_id"])
        async with client:
            response = await client.post(
                "/finance/check-requests",
                json=_payload(dept, isAdvance=False, advanceHolderId=dept["member_id"]),
            )

        assert response.status_code == 400
        assert "Only a cash advance" in response.json()["detail"]

    async def test_another_departments_member_is_refused(self, db_session, dept):
        elsewhere = await _user(db_session, await _org(db_session))
        _id, client = await _officer(db_session, dept["org_id"])
        async with client:
            response = await client.post(
                "/finance/check-requests",
                json=_payload(dept, advanceHolderId=elsewhere),
            )

        assert response.status_code == 400
        assert "current member of this department" in response.json()["detail"]

    async def test_a_former_member_is_refused(self, db_session, dept):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        await db_session.execute(
            text("UPDATE users SET status = 'inactive' WHERE id = :id"),
            {"id": dept["member_id"]},
        )
        with pytest.raises(AdvanceHolderError):
            await FinanceService(db_session).create_check_request(
                dept["org_id"],
                dept["member_id"],
                raised_by=officer_id,
                fiscal_year_id=dept["fy_id"],
                is_advance=True,
                payee_name="Alice Member",
                amount=Decimal("80.00"),
            )

    async def test_a_probationary_member_can_hold_one(self, db_session, dept):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        await db_session.execute(
            text("UPDATE users SET status = 'probationary' WHERE id = :id"),
            {"id": dept["member_id"]},
        )
        cr = await FinanceService(db_session).create_check_request(
            dept["org_id"],
            dept["member_id"],
            raised_by=officer_id,
            fiscal_year_id=dept["fy_id"],
            is_advance=True,
            payee_name="Alice Member",
            amount=Decimal("80.00"),
        )
        assert cr.requested_by == dept["member_id"]

    async def test_the_holders_overdue_advance_blocks_it(self, db_session, dept):
        # Alice's March advance is long past 120 days and unsettled.
        officer_id, _client = await _officer(db_session, dept["org_id"])
        service = FinanceService(db_session)
        cr = await service.create_check_request(
            dept["org_id"],
            dept["member_id"],
            raised_by=officer_id,
            fiscal_year_id=dept["fy_id"],
            is_advance=True,
            payee_name="Alice Member",
            amount=Decimal("80.00"),
        )

        with pytest.raises(OverdueAdvanceError, match=dept["advance"].request_number):
            await service.submit_check_request(cr.id, dept["org_id"])

    async def test_the_holders_list_is_the_departments_current_members(
        self, db_session, dept
    ):
        gone = await _user(db_session, dept["org_id"])
        await db_session.execute(
            text("UPDATE users SET status = 'inactive' WHERE id = :id"), {"id": gone}
        )
        elsewhere = await _user(db_session, await _org(db_session))
        _id, client = await _officer(db_session, dept["org_id"])
        _req, requester = await _officer(
            db_session, dept["org_id"], ["finance.request"]
        )
        async with client:
            response = await client.get("/finance/advances/holders")
        async with requester:
            refused = await requester.get("/finance/advances/holders")

        assert response.status_code == 200
        ids = {row["id"] for row in response.json()}
        assert dept["member_id"] in ids
        assert gone not in ids
        assert elsewhere not in ids
        assert {"id", "name", "legalName"} <= set(response.json()[0])
        assert refused.status_code == 403


class TestTheRaiserCannotApproveOrIssueIt:
    async def test_the_raiser_cannot_approve_it(self, db_session, dept):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        cr = await _approved_on_behalf(db_session, dept, officer_id)

        with pytest.raises(SeparationOfDutiesError, match="You raised this cash"):
            await FinanceService(db_session).manual_approve(
                ApprovalEntityType.CHECK_REQUEST,
                cr.id,
                officer_id,
                org_id=dept["org_id"],
            )

    async def test_the_holder_cannot_approve_it_either(self, db_session, dept):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        cr = await _approved_on_behalf(db_session, dept, officer_id)

        with pytest.raises(SeparationOfDutiesError):
            await FinanceService(db_session).manual_approve(
                ApprovalEntityType.CHECK_REQUEST,
                cr.id,
                dept["member_id"],
                org_id=dept["org_id"],
            )

    async def test_the_raiser_cannot_issue_it_and_another_officer_can(
        self, db_session, dept
    ):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        second_id, _other = await _officer(db_session, dept["org_id"])
        cr = await _approved_on_behalf(db_session, dept, officer_id)
        service = FinanceService(db_session)
        await service.manual_approve(
            ApprovalEntityType.CHECK_REQUEST, cr.id, second_id, org_id=dept["org_id"]
        )

        with pytest.raises(SeparationOfDutiesError, match="cannot issue it"):
            await service.issue_check(
                cr.id, dept["org_id"], "3001", acted_by=officer_id
            )
        issued = await service.issue_check(
            cr.id, dept["org_id"], "3001", acted_by=second_id
        )
        assert issued.status == CheckRequestStatus.ISSUED


# ============================================
# 2. Periodic statements
# ============================================


@pytest.mark.unit
class TestStatementDates:
    @pytest.mark.parametrize(
        ("issued", "first"),
        [
            (date(2026, 3, 10), date(2026, 3, 31)),
            # Never on the day of the check itself.
            (date(2026, 3, 31), date(2026, 6, 30)),
            (date(2026, 4, 1), date(2026, 6, 30)),
            (date(2026, 9, 30), date(2026, 12, 31)),
            (date(2026, 12, 31), date(2027, 3, 31)),
        ],
    )
    def test_the_first_statement_is_the_next_quarter_end(self, issued, first):
        assert first_statement_date(issued) == first

    def test_the_setting_reads_defensively(self):
        from app.utils.finance_settings import finance_settings_in

        assert finance_settings_in({}).advance_return_method == FIXED
        assert (
            finance_settings_in({"finance": {"advance_return_method": "weekly"}})
        ).advance_return_method == FIXED
        assert (
            finance_settings_in({"finance": {"advance_return_method": PERIODIC}})
        ).advance_return_method == PERIODIC

    def test_organization_settings_accept_only_the_two_methods(self):
        from pydantic import ValidationError

        from app.schemas.organization import FinanceSettingsUpdate

        assert (
            FinanceSettingsUpdate(advance_return_method=PERIODIC).advance_return_method
            == PERIODIC
        )
        with pytest.raises(ValidationError):
            FinanceSettingsUpdate(advance_return_method="weekly")


class TestThePeriodicDeadline:
    async def _march(self, db, dept, method):
        dept["advance"].advance_return_method = method
        await db.flush()
        return dept["advance"].id

    async def _at(self, db, dept, advance_id, when):
        return (
            await advance_balances(
                db, dept["org_id"], advance_ids=[advance_id], now=when
            )
        )[advance_id]

    async def test_120_days_from_the_first_quarter_end(self, db_session, dept):
        # Issued 10 March: first statement 31 March, last day 29 July.
        advance_id = await self._march(db_session, dept, PERIODIC)
        last_day = datetime(2026, 7, 29, 22, 0, tzinfo=timezone.utc)
        next_day = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)

        before = await self._at(db_session, dept, advance_id, last_day)
        after = await self._at(db_session, dept, advance_id, next_day)

        assert before.first_statement == date(2026, 3, 31)
        assert before.due_at == datetime(2026, 7, 29, 23, 59, 59, tzinfo=timezone.utc)
        assert (before.overdue, after.overdue) == (False, True)

    async def test_the_fixed_date_method_is_unchanged(self, db_session, dept):
        advance_id = await self._march(db_session, dept, None)
        balance = await self._at(
            db_session, dept, advance_id, datetime(2026, 7, 9, tzinfo=timezone.utc)
        )

        assert balance.method == FIXED
        assert balance.first_statement is None
        assert balance.due_at == dept["advance"].check_date + timedelta(days=120)
        assert balance.overdue is True

    async def test_the_quarter_ends_on_the_departments_calendar(self, db_session, dept):
        # 03:00 UTC on 1 April is still 31 March in New York: the statement
        # that day is not "after" the check, so the first is 30 June.
        org = await db_session.get(Organization, dept["org_id"])
        org.timezone = "America/New_York"
        advance = await _advance(
            db_session,
            dept,
            dept["member_id"],
            amount="40.00",
            issued=datetime(2026, 4, 1, 3, 0, tzinfo=timezone.utc),
            number="CK-ADV-NY",
        )
        advance.advance_return_method = PERIODIC
        await db_session.flush()

        balance = await self._at(
            db_session, dept, advance.id, datetime(2026, 5, 1, tzinfo=timezone.utc)
        )
        assert balance.first_statement == date(2026, 6, 30)

    async def test_it_drives_the_block_on_another_advance(self, db_session, dept):
        # Issued the day after a quarter end more than 120 days ago: overdue
        # by the check's date, not yet by its first statement's.
        today = datetime.now(timezone.utc).date()
        cutoff = today - timedelta(days=121)
        quarter_end = first_statement_date(date(cutoff.year - 1, 12, 31))
        while first_statement_date(quarter_end) <= cutoff:
            quarter_end = first_statement_date(quarter_end)
        issued = datetime.combine(
            quarter_end + timedelta(days=1), time.min, timezone.utc
        )
        service = FinanceService(db_session)
        await service.record_advance_return(
            dept["org_id"],
            dept["advance"].id,
            await _user(db_session, dept["org_id"]),
            Decimal("300.00"),
        )
        recent = await _advance(
            db_session, dept, dept["member_id"], issued=issued, number="CK-ADV-Q"
        )

        async def submit_another():
            cr = await service.create_check_request(
                dept["org_id"],
                dept["member_id"],
                fiscal_year_id=dept["fy_id"],
                is_advance=True,
                payee_name="Alice Member",
                amount=Decimal("20.00"),
            )
            return await service.submit_check_request(cr.id, dept["org_id"])

        with pytest.raises(OverdueAdvanceError, match="CK-ADV-Q"):
            await submit_another()

        recent.advance_return_method = PERIODIC
        await db_session.flush()
        submitted = await submit_another()
        assert submitted.status == CheckRequestStatus.PENDING_APPROVAL

    async def test_issuing_fixes_the_method_in_force(self, db_session, dept):
        officer_id, _client = await _officer(db_session, dept["org_id"])
        second_id, _other = await _officer(db_session, dept["org_id"])
        await _method(db_session, dept["org_id"], PERIODIC)
        cr = await _approved_on_behalf(db_session, dept, officer_id)
        service = FinanceService(db_session)
        await service.manual_approve(
            ApprovalEntityType.CHECK_REQUEST, cr.id, second_id, org_id=dept["org_id"]
        )
        issued = await service.issue_check(
            cr.id, dept["org_id"], "3002", acted_by=second_id
        )
        assert issued.advance_return_method == PERIODIC

        # A later change of setting moves no deadline already running.
        await _method(db_session, dept["org_id"], FIXED)
        balance = (await advance_balances(db_session, dept["org_id"]))[cr.id]
        assert balance.method == PERIODIC
        assert balance.first_statement is not None

    async def test_the_advance_page_lists_its_statements(self, db_session, dept):
        advance_id = await self._march(db_session, dept, PERIODIC)
        _id, client = await _officer(db_session, dept["org_id"], ["finance.view"])
        async with client:
            response = await client.get(f"/finance/advances/{advance_id}")
            settings = await client.get("/finance/settings")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["returnMethod"] == PERIODIC
        assert body["firstStatementDate"] == "2026-03-31"
        assert body["dueAt"].startswith("2026-07-29T23:59:59")
        rows = body["statements"]
        assert rows[0] == {
            "statementDate": "2026-03-31",
            "dueDate": "2026-07-29",
            "outstanding": None,
            "emailedAt": None,
            "upcoming": False,
        }
        assert rows[-1]["upcoming"] is True
        assert [r["upcoming"] for r in rows[:-1]] == [False] * (len(rows) - 1)
        assert settings.json()["advanceReturnMethod"] == FIXED


class TestStatementEmails:
    @pytest.fixture
    def mailer(self, monkeypatch):
        recorder = _Mailer()
        monkeypatch.setattr(
            "app.services.email_service.EmailService",
            recorder.factory,
            raising=True,
        )
        return recorder

    async def _org(self, db, dept):
        return await db.get(Organization, dept["org_id"])

    async def test_the_holder_is_sent_the_latest_statement_once(
        self, db_session, dept, mailer
    ):
        dept["advance"].advance_return_method = PERIODIC
        await db_session.flush()
        org = await self._org(db_session, dept)
        holder = await db_session.get(User, dept["member_id"])

        first = await statements.send_advance_statements(db_session, org)
        second = await statements.send_advance_statements(db_session, org)

        assert (first, second) == (1, 0)
        assert len(mailer.sends) == 1
        assert mailer.sends[0]["to"] == [holder.email]
        assert "$300.00" in mailer.sends[0]["subject"]
        rows = (
            (
                await db_session.execute(
                    select(AdvanceStatement).where(
                        AdvanceStatement.advance_id == dept["advance"].id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        latest = statements.latest_statement_date(
            date(2026, 3, 10), datetime.now(timezone.utc).date()
        )
        assert rows[0].statement_date == latest
        assert rows[0].due_date == latest + timedelta(days=120)
        assert rows[0].outstanding == Decimal("300.00")
        assert rows[0].emailed_at is not None

    async def test_a_claimed_statement_left_unsent_goes_out_next_run(
        self, db_session, dept, mailer
    ):
        dept["advance"].advance_return_method = PERIODIC
        org = await self._org(db_session, dept)
        day = statements.latest_statement_date(
            date(2026, 3, 10), datetime.now(timezone.utc).date()
        )
        # A run that claimed the statement and crashed before the mailer.
        db_session.add(
            AdvanceStatement(
                organization_id=dept["org_id"],
                advance_id=dept["advance"].id,
                statement_date=day,
                due_date=day + timedelta(days=120),
                outstanding=Decimal("300.00"),
            )
        )
        await db_session.flush()

        assert await statements.send_advance_statements(db_session, org) == 1
        assert await statements.send_advance_statements(db_session, org) == 0
        assert len(mailer.sends) == 1

    async def test_fixed_date_and_settled_advances_get_none(
        self, db_session, dept, mailer
    ):
        org = await self._org(db_session, dept)
        settled = await _advance(
            db_session, dept, dept["member_id"], amount="50.00", number="CK-ADV-S"
        )
        settled.advance_return_method = PERIODIC
        await FinanceService(db_session).record_advance_return(
            dept["org_id"],
            settled.id,
            await _user(db_session, dept["org_id"]),
            Decimal("50.00"),
        )

        assert await statements.send_advance_statements(db_session, org) == 0
        assert mailer.sends == []

    async def test_the_task_is_registered_and_scheduled(self):
        from app.services import scheduled_tasks

        name = "advance_statements"
        assert (
            scheduled_tasks.TASK_RUNNERS[name] is scheduled_tasks.run_advance_statements
        )
        assert name in scheduled_tasks.SCHEDULE
        assert scheduled_tasks.TASK_INTERVALS_SECONDS[name] == 86400


# ============================================
# 3. At close
# ============================================


class TestAtTheClose:
    async def _closing(self, db, dept):
        fy = await db.get(FiscalYear, dept["fy_id"])
        fy.status = FiscalYearStatus.CLOSED
        await db.flush()

    async def test_an_outstanding_advance_is_listed_and_does_not_stop_the_lock(
        self, db_session, dept
    ):
        await self._closing(db_session, dept)
        service = FinanceService(db_session)
        items = await service.list_open_items(dept["fy_id"], dept["org_id"])
        advances = [i for i in items if i["kind"] == "cash_advance"]

        assert advances == [
            {
                "kind": "cash_advance",
                "entity_id": dept["advance"].id,
                "number": dept["advance"].request_number,
                "description": "Tess Treasurer",
                "status": "overdue",
                "amount": Decimal("300.00"),
                "blocks_lock": False,
            }
        ]
        assert all(i["blocks_lock"] for i in items if i["kind"] != "cash_advance")

        officer = await _user(db_session, dept["org_id"])
        locked = await service.lock_fiscal_year(
            dept["fy_id"], dept["org_id"], locked_by=officer, notes="Reconciled"
        )
        assert locked.is_locked is True

    async def test_a_settled_advance_is_not_listed(self, db_session, dept):
        await FinanceService(db_session).record_advance_return(
            dept["org_id"],
            dept["advance"].id,
            await _user(db_session, dept["org_id"]),
            Decimal("300.00"),
        )
        items = await FinanceService(db_session).list_open_items(
            dept["fy_id"], dept["org_id"]
        )
        assert [i for i in items if i["kind"] == "cash_advance"] == []

    async def test_the_endpoint_marks_it(self, db_session, dept):
        _id, client = await _officer(db_session, dept["org_id"])
        async with client:
            response = await client.get(
                f"/finance/fiscal-years/{dept['fy_id']}/open-items"
            )

        assert response.status_code == 200, response.text
        row = next(r for r in response.json() if r["kind"] == "cash_advance")
        assert row["blocksLock"] is False
        assert row["amount"] == "300.00"
