"""Every member can raise their own finance requests, and only their own.

``finance.request`` is the baseline grant behind purchase requests, expense
reports and check requests. Before it existed the create/edit/submit endpoints
required ``finance.manage`` — the Treasurer and IT Manager only — while the
pages offered "New …" buttons to anyone with ``finance.view``, whose save then
403'd.

What is pinned here, over HTTP against the real router:

* a member holding only ``finance.request`` raises, edits, submits and
  withdraws (as a draft) their own requests;
* another member's request is a 404 to them on every read and write — it reads
  exactly like an id that does not exist;
* lists are confined to the caller's own records unless they hold
  ``finance.view`` or ``finance.manage``, which keep today's org-wide view;
* the finance office's actions (order, receive, pay, issue, void) stay
  ``finance.manage``;
* the budget and fiscal-year option lists the forms use give a requester a
  name and the remaining amount, org-scoped, and nobody without a finance
  grant gets them.
"""

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import finance as finance_endpoints
from app.core.database import get_db
from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.finance import Budget, BudgetCategory, FiscalYear, FiscalYearStatus
from app.models.user import User

pytestmark = [pytest.mark.integration]

REQUEST_ONLY = ["finance.request"]


async def _org(db: AsyncSession, label: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"{label} Dept", "slug": f"{label}-{org_id[:8]}"},
    )
    return org_id


async def _user(db: AsyncSession, org_id: str, name: str, permissions) -> User:
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Test', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "fn": name,
            "un": f"{name}-{user_id[:8]}",
            "em": f"{name}-{user_id[:8]}@test.example",
        },
    )
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"{name} position {position_id[:6]}",
            "slug": f"{name}-{position_id[:8]}",
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
    return user


def _client(db: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(finance_endpoints.router, prefix="/finance")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def dept(db_session: AsyncSession):
    """One department: two members, a finance viewer, a treasurer, an outsider."""
    org_id = await _org(db_session, "fin")
    people = {
        "alice": await _user(db_session, org_id, "alice", REQUEST_ONLY),
        "bob": await _user(db_session, org_id, "bob", REQUEST_ONLY),
        "viewer": await _user(db_session, org_id, "viewer", ["finance.view"]),
        "treasurer": await _user(
            db_session, org_id, "treasurer", ["finance.view", "finance.manage"]
        ),
        "nobody": await _user(db_session, org_id, "nobody", ["events.view"]),
    }
    fy = FiscalYear(
        organization_id=org_id,
        name="FY2026",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        status=FiscalYearStatus.ACTIVE,
        created_by=people["treasurer"].id,
    )
    closed = FiscalYear(
        organization_id=org_id,
        name="FY2024",
        start_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2024, 12, 31, tzinfo=timezone.utc),
        status=FiscalYearStatus.CLOSED,
        created_by=people["treasurer"].id,
    )
    training = BudgetCategory(organization_id=org_id, name="Training")
    apparatus = BudgetCategory(organization_id=org_id, name="Apparatus")
    db_session.add_all([fy, closed, training, apparatus])
    await db_session.flush()

    facility_type = FacilityType(organization_id=None, name="Station", is_system=True)
    facility_status = FacilityStatus(
        organization_id=None, name="In service", is_system=True
    )
    db_session.add_all([facility_type, facility_status])
    await db_session.flush()
    station = Facility(
        organization_id=org_id,
        name="Station 2",
        facility_type_id=facility_type.id,
        status_id=facility_status.id,
    )
    db_session.add(station)
    await db_session.flush()

    budgets = {
        "training": Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=training.id,
            amount_budgeted=Decimal("2000.00"),
            amount_spent=Decimal("500.00"),
            amount_encumbered=Decimal("250.00"),
            notes="Instructor fees for the spring academy",
            created_by=people["treasurer"].id,
        ),
        "apparatus_station": Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=apparatus.id,
            station_id=station.id,
            amount_budgeted=Decimal("100.00"),
            created_by=people["treasurer"].id,
        ),
        "apparatus_a": Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=apparatus.id,
            amount_budgeted=Decimal("10.00"),
            created_by=people["treasurer"].id,
        ),
        "apparatus_b": Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=apparatus.id,
            amount_budgeted=Decimal("20.00"),
            created_by=people["treasurer"].id,
        ),
    }
    db_session.add_all(budgets.values())
    await db_session.flush()
    return {
        "org_id": org_id,
        "fy_id": fy.id,
        "closed_fy_id": closed.id,
        "budgets": {k: v.id for k, v in budgets.items()},
        **people,
    }


async def _new_pr(client: AsyncClient, fy_id: str, title="Gloves") -> dict:
    resp = await client.post(
        "/finance/purchase-requests",
        json={"title": title, "estimatedAmount": "50.00", "fiscalYearId": fy_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _new_er(client: AsyncClient, fy_id: str) -> dict:
    resp = await client.post(
        "/finance/expense-reports",
        json={
            "title": "Conference mileage",
            "fiscalYearId": fy_id,
            "lineItems": [
                {
                    "description": "Mileage",
                    "amount": "42.00",
                    "dateIncurred": "2026-03-01T00:00:00Z",
                    "expenseType": "mileage",
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _new_cr(client: AsyncClient, fy_id: str) -> dict:
    resp = await client.post(
        "/finance/check-requests",
        json={"payeeName": "Hose Co", "amount": "75.00", "fiscalYearId": fy_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestAMemberRaisesTheirOwnRequests:
    async def test_purchase_request_create_edit_submit(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
            assert pr["requestedBy"] == dept["alice"].id

            resp = await alice.put(
                f"/finance/purchase-requests/{pr['id']}",
                json={"title": "Structure gloves", "budgetId": None},
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["title"] == "Structure gloves"

            resp = await alice.post(f"/finance/purchase-requests/{pr['id']}/submit")
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "pending_approval"

            resp = await alice.get(f"/finance/purchase-requests/{pr['id']}")
            assert resp.status_code == 200, resp.text

    async def test_expense_report_create_add_item_submit(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            er = await _new_er(alice, dept["fy_id"])
            assert er["submittedBy"] == dept["alice"].id

            resp = await alice.post(
                f"/finance/expense-reports/{er['id']}/items",
                json={
                    "description": "Parking",
                    "amount": "8.00",
                    "dateIncurred": "2026-03-01T00:00:00Z",
                },
            )
            assert resp.status_code == 201, resp.text

            resp = await alice.post(f"/finance/expense-reports/{er['id']}/submit")
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "pending_approval"

            resp = await alice.get(f"/finance/expense-reports/{er['id']}")
            assert resp.status_code == 200, resp.text

    async def test_check_request_create_edit_submit(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            cr = await _new_cr(alice, dept["fy_id"])
            assert cr["requestedBy"] == dept["alice"].id

            resp = await alice.put(
                f"/finance/check-requests/{cr['id']}", json={"memo": "Invoice 77"}
            )
            assert resp.status_code == 200, resp.text

            resp = await alice.post(f"/finance/check-requests/{cr['id']}/submit")
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "pending_approval"

    async def test_a_member_withdraws_their_own_draft(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
            resp = await alice.post(f"/finance/purchase-requests/{pr['id']}/cancel")
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "cancelled"

    async def test_but_not_once_it_is_submitted(self, db_session, dept):
        """Past draft there are approval steps waiting on other people; the
        finance office cancels those."""
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
            await alice.post(f"/finance/purchase-requests/{pr['id']}/submit")
            resp = await alice.post(f"/finance/purchase-requests/{pr['id']}/cancel")
            assert resp.status_code == 400, resp.text

        async with _client(db_session, dept["treasurer"]) as treasurer:
            resp = await treasurer.post(f"/finance/purchase-requests/{pr['id']}/cancel")
            assert resp.status_code == 200, resp.text


class TestAnotherMembersRequestIsAbsent:
    """Every read and write answers 404, the same as an unknown id."""

    async def test_purchase_request(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
        url = f"/finance/purchase-requests/{pr['id']}"
        async with _client(db_session, dept["bob"]) as bob:
            assert (await bob.get(url)).status_code == 404
            assert (await bob.put(url, json={"title": "Mine now"})).status_code == 404
            assert (await bob.post(f"{url}/submit")).status_code == 404
            assert (await bob.post(f"{url}/cancel")).status_code == 404

    async def test_expense_report(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            er = await _new_er(alice, dept["fy_id"])
        url = f"/finance/expense-reports/{er['id']}"
        item = {
            "description": "Lunch",
            "amount": "12.00",
            "dateIncurred": "2026-03-01T00:00:00Z",
        }
        async with _client(db_session, dept["bob"]) as bob:
            assert (await bob.get(url)).status_code == 404
            assert (await bob.put(url, json={"title": "Mine"})).status_code == 404
            assert (await bob.post(f"{url}/items", json=item)).status_code == 404
            assert (await bob.post(f"{url}/submit")).status_code == 404

    async def test_check_request(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            cr = await _new_cr(alice, dept["fy_id"])
        url = f"/finance/check-requests/{cr['id']}"
        async with _client(db_session, dept["bob"]) as bob:
            assert (await bob.get(url)).status_code == 404
            assert (await bob.put(url, json={"memo": "x"})).status_code == 404
            assert (await bob.post(f"{url}/submit")).status_code == 404

    async def test_a_finance_viewer_reads_it_but_cannot_act_on_it(
        self, db_session, dept
    ):
        """finance.view keeps the org-wide read it always had; it was never a
        grant to edit somebody else's request."""
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
        url = f"/finance/purchase-requests/{pr['id']}"
        async with _client(db_session, dept["viewer"]) as viewer:
            assert (await viewer.get(url)).status_code == 200
            assert (await viewer.put(url, json={"title": "x"})).status_code == 403

    async def test_the_treasurer_still_edits_anyones(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
        async with _client(db_session, dept["treasurer"]) as treasurer:
            resp = await treasurer.put(
                f"/finance/purchase-requests/{pr['id']}", json={"title": "Fixed"}
            )
            assert resp.status_code == 200, resp.text


class TestListsAreScopedToTheCaller:
    async def _raise_one_each(self, db_session, dept):
        ids = {}
        for who in ("alice", "bob"):
            async with _client(db_session, dept[who]) as client:
                ids[who] = {
                    "pr": (await _new_pr(client, dept["fy_id"], title=who))["id"],
                    "er": (await _new_er(client, dept["fy_id"]))["id"],
                    "cr": (await _new_cr(client, dept["fy_id"]))["id"],
                }
        return ids

    @staticmethod
    async def _listed(client):
        return {
            "pr": {
                r["id"] for r in (await client.get("/finance/purchase-requests")).json()
            },
            "er": {
                r["id"] for r in (await client.get("/finance/expense-reports")).json()
            },
            "cr": {
                r["id"] for r in (await client.get("/finance/check-requests")).json()
            },
        }

    async def test_a_member_sees_only_their_own(self, db_session, dept):
        ids = await self._raise_one_each(db_session, dept)
        async with _client(db_session, dept["alice"]) as alice:
            listed = await self._listed(alice)
        for kind in ("pr", "er", "cr"):
            assert listed[kind] == {ids["alice"][kind]}, kind

    async def test_a_finance_viewer_still_sees_the_whole_queue(self, db_session, dept):
        """Purchase and check requests stay org-wide for finance.view; expense
        reports were already own-only for a viewer (FIN-5) and stay that way."""
        ids = await self._raise_one_each(db_session, dept)
        async with _client(db_session, dept["viewer"]) as viewer:
            listed = await self._listed(viewer)
        assert listed["pr"] >= {ids["alice"]["pr"], ids["bob"]["pr"]}
        assert listed["cr"] >= {ids["alice"]["cr"], ids["bob"]["cr"]}
        assert listed["er"] == set()

    async def test_the_treasurer_sees_everything(self, db_session, dept):
        ids = await self._raise_one_each(db_session, dept)
        async with _client(db_session, dept["treasurer"]) as treasurer:
            listed = await self._listed(treasurer)
        for kind in ("pr", "er", "cr"):
            assert listed[kind] >= {ids["alice"][kind], ids["bob"][kind]}, kind

    async def test_without_any_finance_grant_there_is_nothing(self, db_session, dept):
        async with _client(db_session, dept["nobody"]) as nobody:
            for url in (
                "/finance/purchase-requests",
                "/finance/expense-reports",
                "/finance/check-requests",
            ):
                assert (await nobody.get(url)).status_code == 403, url
            resp = await nobody.post(
                "/finance/purchase-requests",
                json={"title": "x", "estimatedAmount": "1.00", "fiscalYearId": "x"},
            )
            assert resp.status_code == 403


class TestTheFinanceOfficeKeepsItsActions:
    async def test_a_member_cannot_order_pay_issue_or_void(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            pr = await _new_pr(alice, dept["fy_id"])
            er = await _new_er(alice, dept["fy_id"])
            cr = await _new_cr(alice, dept["fy_id"])
            refused = [
                f"/finance/purchase-requests/{pr['id']}/mark-ordered",
                f"/finance/purchase-requests/{pr['id']}/mark-received",
                f"/finance/purchase-requests/{pr['id']}/mark-paid",
                f"/finance/expense-reports/{er['id']}/mark-paid",
                f"/finance/check-requests/{cr['id']}/issue?check_number=101",
                f"/finance/check-requests/{cr['id']}/void",
            ]
            for url in refused:
                assert (await alice.post(url)).status_code == 403, url

    async def test_and_cannot_read_the_budget_pages(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            for url in (
                "/finance/budgets",
                f"/finance/budgets/summary?fiscal_year_id={dept['fy_id']}",
                "/finance/fiscal-years",
                "/finance/dashboard",
            ):
                assert (await alice.get(url)).status_code == 403, url
            # One line by id opens to its owner too, so to a member who does
            # not own it the line simply does not exist (test_finance_my_budgets).
            line = dept["budgets"]["training"]
            for url in (
                f"/finance/budgets/{line}",
                f"/finance/budgets/{line}/amendments",
                f"/finance/budgets/{line}/transactions",
            ):
                assert (await alice.get(url)).status_code == 404, url


class TestTheFormOptions:
    async def test_a_member_sees_each_line_by_name_and_what_is_left(
        self, db_session, dept
    ):
        async with _client(db_session, dept["alice"]) as alice:
            resp = await alice.get(
                f"/finance/budgets/options?fiscal_year_id={dept['fy_id']}"
            )
        assert resp.status_code == 200, resp.text
        by_id = {row["id"]: row for row in resp.json()}
        budgets = dept["budgets"]

        training = by_id[budgets["training"]]
        assert training["label"] == "Training"
        assert Decimal(training["amountRemaining"]) == Decimal("1250.00")
        # Nothing else about the line: no budgeted/spent figures, no notes.
        assert set(training) == {"id", "label", "amountRemaining"}

        assert by_id[budgets["apparatus_station"]]["label"] == "Apparatus (Station 2)"
        duplicates = {
            by_id[budgets["apparatus_a"]]["label"],
            by_id[budgets["apparatus_b"]]["label"],
        }
        assert duplicates == {"Apparatus", "Apparatus #2"}

    async def test_fiscal_years_offered_are_the_open_ones(self, db_session, dept):
        async with _client(db_session, dept["alice"]) as alice:
            resp = await alice.get("/finance/fiscal-years/options")
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert {r["id"] for r in rows} == {dept["fy_id"]}
        assert set(rows[0]) == {"id", "name", "status"}
        assert rows[0]["status"] == "active"

    async def test_another_departments_lines_are_not_offered(self, db_session, dept):
        other_org = await _org(db_session, "other")
        outsider = await _user(db_session, other_org, "outsider", REQUEST_ONLY)
        async with _client(db_session, outsider) as client:
            budgets = await client.get(
                f"/finance/budgets/options?fiscal_year_id={dept['fy_id']}"
            )
            years = await client.get("/finance/fiscal-years/options")
        assert budgets.status_code == 200
        assert budgets.json() == []
        assert years.json() == []

    async def test_refused_without_any_finance_grant(self, db_session, dept):
        async with _client(db_session, dept["nobody"]) as nobody:
            budgets = await nobody.get(
                f"/finance/budgets/options?fiscal_year_id={dept['fy_id']}"
            )
            years = await nobody.get("/finance/fiscal-years/options")
        assert budgets.status_code == 403
        assert years.status_code == 403
