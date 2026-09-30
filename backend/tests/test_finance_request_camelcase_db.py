"""
The Finance endpoints accept the camelCase bodies the Finance pages send.

End-to-end counterpart of ``test_finance_request_camelcase.py``: drives the
finance router over HTTP with the exact key spelling the frontend uses, and
reads the rows back. Before the request schemas took an alias, the fiscal year
create here was a 422 and the ``budgetId: null`` update was a 200 that left
the budget attached.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import finance as finance_endpoints
from app.core.database import get_db
from app.models.finance import PurchaseRequest
from app.models.user import User

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def treasurer(db_session: AsyncSession) -> User:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Camel Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"camel-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Tre', 'Asurer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"treasurer-{user_id[:8]}",
            "em": f"treasurer-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Treasurer', 'treasurer', "
            '\'["finance.view", "finance.manage"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db_session.flush()
    user = await db_session.get(User, user_id)
    await db_session.refresh(user, ["positions"])
    return user


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(finance_endpoints.router, prefix="/finance")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestFinanceEndpointsAcceptCamelCase:
    async def test_create_with_camelcase_then_clear_a_field_with_camelcase_null(
        self, db_session: AsyncSession, treasurer: User
    ):
        async with _client(db_session, treasurer) as client:
            # The body FiscalYearSettingsPage sends.
            resp = await client.post(
                "/finance/fiscal-years",
                json={
                    "name": "FY2026",
                    "startDate": "2026-01-01T00:00:00Z",
                    "endDate": "2026-12-31T00:00:00Z",
                },
            )
            assert resp.status_code == 201, resp.text
            fy_id = resp.json()["id"]
            assert resp.json()["startDate"].startswith("2026-01-01")

            resp = await client.post(
                "/finance/budget-categories",
                json={"name": "Equipment", "qbAccountName": "6200 Equipment"},
            )
            assert resp.status_code == 201, resp.text
            assert resp.json()["qbAccountName"] == "6200 Equipment"
            category_id = resp.json()["id"]

            resp = await client.post(
                "/finance/budgets",
                json={
                    "fiscalYearId": fy_id,
                    "categoryId": category_id,
                    "amountBudgeted": "5000.00",
                },
            )
            assert resp.status_code == 201, resp.text
            budget_id = resp.json()["id"]

            # The body PurchaseRequestFormPage sends on create.
            resp = await client.post(
                "/finance/purchase-requests",
                json={
                    "title": "Hose",
                    "estimatedAmount": "250.00",
                    "priority": "high",
                    "fiscalYearId": fy_id,
                    "vendor": "Hose Co",
                    "budgetId": budget_id,
                },
            )
            assert resp.status_code == 201, resp.text
            pr_id = resp.json()["id"]
            assert resp.json()["budgetId"] == budget_id

            # The body PurchaseRequestFormPage sends on edit when the budget
            # is unselected and the vendor emptied.
            resp = await client.put(
                f"/finance/purchase-requests/{pr_id}",
                json={
                    "title": "Hose",
                    "estimatedAmount": "250.00",
                    "priority": "high",
                    "fiscalYearId": fy_id,
                    "description": None,
                    "vendor": None,
                    "budgetId": None,
                },
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["budgetId"] is None
            assert resp.json()["vendor"] is None

            # An omitted key is left alone.
            resp = await client.put(
                f"/finance/purchase-requests/{pr_id}",
                json={"notes": "Needed for Engine 2"},
            )
            assert resp.status_code == 200, resp.text

        pr = await db_session.get(PurchaseRequest, pr_id)
        await db_session.refresh(pr)
        assert pr.budget_id is None
        assert pr.vendor is None
        assert pr.title == "Hose"
        assert pr.notes == "Needed for Engine 2"
        assert str(pr.fiscal_year_id) == fy_id

    async def test_snake_case_body_still_works(
        self, db_session: AsyncSession, treasurer: User
    ):
        async with _client(db_session, treasurer) as client:
            resp = await client.post(
                "/finance/fiscal-years",
                json={
                    "name": "FY2027",
                    "start_date": "2027-01-01T00:00:00Z",
                    "end_date": "2027-12-31T00:00:00Z",
                },
            )
            assert resp.status_code == 201, resp.text
