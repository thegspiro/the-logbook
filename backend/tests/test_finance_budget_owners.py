"""Budget-line owners, stations on budget lines, and the Create/Edit Budget API.

A budget line is owned by a **position**. A category may name an owner
position too; a line with no owner of its own inherits its category's, and a
line's own owner overrides it. Only ``finance.manage`` sets amounts, owners and
stations (owner decisions, 2026-10-08).

Pinned here:

* the resolver in ``finance_budget_ownership`` — own owner, inherited,
  override, none — and the "which lines does this member own" query it gives
  the follow-up "My budgets" view, across every fiscal year, org-scoped and
  active members only;
* ``POST``/``PUT /finance/budgets`` carry ``stationId`` and
  ``ownerPositionId``; on update an omitted key leaves the field alone and an
  explicit null clears it (CLAUDE.md pitfall #1);
* a station or position from another department is refused (pitfall #14c);
* a closed fiscal year takes no new lines;
* the list filters by station and reports station and owner names;
* the position and station pickers are ``finance.manage`` only and org-scoped.
"""

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

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
from app.services.finance_budget_ownership import (
    effective_owner_position_id,
    owned_budget_ids,
    resolve_owner,
    user_owns_budget,
)

# ============================================
# The rule itself, no database
# ============================================


@pytest.mark.unit
class TestResolveOwner:
    def test_a_line_with_its_own_owner_uses_it(self):
        assert resolve_owner("pos-line", None) == ("pos-line", False)

    def test_a_line_without_one_inherits_the_categorys(self):
        assert resolve_owner(None, "pos-cat") == ("pos-cat", True)

    def test_the_lines_own_owner_overrides_the_categorys(self):
        assert resolve_owner("pos-line", "pos-cat") == ("pos-line", False)

    def test_neither_means_no_owner_and_nothing_inherited(self):
        assert resolve_owner(None, None) == (None, False)
        assert resolve_owner("", "") == (None, False)

    def test_object_form_agrees(self):
        line = SimpleNamespace(owner_position_id=None)
        category = SimpleNamespace(owner_position_id="pos-cat")
        assert effective_owner_position_id(line, category) == "pos-cat"
        assert effective_owner_position_id(line, None) is None
        line.owner_position_id = "pos-line"
        assert effective_owner_position_id(line, category) == "pos-line"


# ============================================
# Fixtures
# ============================================


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


async def _position(db: AsyncSession, org_id: str, name: str, permissions) -> str:
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": f"{name.lower().replace(' ', '-')}-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    return position_id


async def _user(
    db: AsyncSession, org_id: str, name: str, position_ids, status="active"
) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Test', :em, 'hashed', :st)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "fn": name,
            "un": f"{name}-{user_id[:8]}",
            "em": f"{name}-{user_id[:8]}@test.example",
            "st": status,
        },
    )
    for position_id in position_ids:
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


async def _station(db: AsyncSession, org_id: str, name: str, archived=False) -> str:
    facility_type = FacilityType(organization_id=None, name="Station", is_system=True)
    facility_status = FacilityStatus(
        organization_id=None, name="In service", is_system=True
    )
    db.add_all([facility_type, facility_status])
    await db.flush()
    station = Facility(
        organization_id=org_id,
        name=name,
        facility_type_id=facility_type.id,
        status_id=facility_status.id,
        is_archived=archived,
    )
    db.add(station)
    await db.flush()
    return station.id


def _year(org_id, name, status, created_by, year) -> FiscalYear:
    return FiscalYear(
        organization_id=org_id,
        name=name,
        start_date=datetime(year, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(year, 12, 31, tzinfo=timezone.utc),
        status=status,
        created_by=created_by,
    )


@pytest.fixture
async def dept(db_session: AsyncSession):
    """A department with owner positions, two years, and a second department."""
    org_id = await _org(db_session, "own")
    other_org = await _org(db_session, "other")

    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    viewer_pos = await _position(db_session, org_id, "Finance Viewer", ["finance.view"])
    training_officer = await _position(db_session, org_id, "Training Officer", [])
    chief = await _position(db_session, org_id, "Chief", [])
    foreign_pos = await _position(db_session, other_org, "Their Chief", [])

    people = {
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "viewer": await _user(db_session, org_id, "viewer", [viewer_pos]),
        "trainer": await _user(db_session, org_id, "trainer", [training_officer]),
        "chief": await _user(db_session, org_id, "chief", [chief]),
        "former": await _user(
            db_session, org_id, "former", [training_officer], status="inactive"
        ),
        "outsider": await _user(db_session, other_org, "outsider", [foreign_pos]),
    }
    treasurer_id = people["treasurer"].id

    active = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026)
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027)
    closed = _year(org_id, "FY2025", FiscalYearStatus.CLOSED, treasurer_id, 2025)
    training = BudgetCategory(
        organization_id=org_id, name="Training", owner_position_id=training_officer
    )
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    db_session.add_all([active, draft, closed, training, gear])
    await db_session.flush()

    station = await _station(db_session, org_id, "Station 2")
    archived_station = await _station(
        db_session, org_id, "Old Station 9", archived=True
    )
    foreign_station = await _station(db_session, other_org, "Their Station")

    lines = {
        # Inherits Training Officer from its category.
        "training": Budget(
            organization_id=org_id,
            fiscal_year_id=active.id,
            category_id=training.id,
            amount_budgeted=Decimal("2000.00"),
            amount_spent=Decimal("500.00"),
            amount_encumbered=Decimal("250.00"),
            created_by=treasurer_id,
        ),
        # Its own owner overrides the category's.
        "training_chief": Budget(
            organization_id=org_id,
            fiscal_year_id=active.id,
            category_id=training.id,
            owner_position_id=chief,
            station_id=station,
            amount_budgeted=Decimal("300.00"),
            created_by=treasurer_id,
        ),
        # Last year's, still the Training Officer's.
        "training_last_year": Budget(
            organization_id=org_id,
            fiscal_year_id=closed.id,
            category_id=training.id,
            amount_budgeted=Decimal("1500.00"),
            created_by=treasurer_id,
        ),
        # Nobody's.
        "gear": Budget(
            organization_id=org_id,
            fiscal_year_id=active.id,
            category_id=gear.id,
            amount_budgeted=Decimal("800.00"),
            created_by=treasurer_id,
        ),
    }
    db_session.add_all(lines.values())
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "fy": active.id,
        "draft_fy": draft.id,
        "closed_fy": closed.id,
        "training_cat": training.id,
        "gear_cat": gear.id,
        "training_officer": training_officer,
        "chief_pos": chief,
        "foreign_pos": foreign_pos,
        "station": station,
        "archived_station": archived_station,
        "foreign_station": foreign_station,
        "lines": {k: v.id for k, v in lines.items()},
        **people,
    }


# ============================================
# Who owns which line
# ============================================


@pytest.mark.integration
class TestOwnedBudgets:
    async def test_the_category_owner_owns_inherited_lines_in_every_year(
        self, db_session, dept
    ):
        owned = await owned_budget_ids(db_session, dept["org_id"], dept["trainer"].id)
        assert owned == {
            dept["lines"]["training"],
            dept["lines"]["training_last_year"],
        }

    async def test_a_lines_own_owner_overrides_the_category_owner(
        self, db_session, dept
    ):
        chief_owns = await owned_budget_ids(
            db_session, dept["org_id"], dept["chief"].id
        )
        assert chief_owns == {dept["lines"]["training_chief"]}
        assert not await user_owns_budget(
            db_session,
            dept["org_id"],
            dept["trainer"].id,
            dept["lines"]["training_chief"],
        )
        assert await user_owns_budget(
            db_session,
            dept["org_id"],
            dept["chief"].id,
            dept["lines"]["training_chief"],
        )

    async def test_a_line_with_no_owner_belongs_to_nobody(self, db_session, dept):
        for person in ("treasurer", "viewer", "trainer", "chief"):
            assert not await user_owns_budget(
                db_session, dept["org_id"], dept[person].id, dept["lines"]["gear"]
            )

    async def test_an_inactive_member_holding_the_position_owns_nothing(
        self, db_session, dept
    ):
        assert (
            await owned_budget_ids(db_session, dept["org_id"], dept["former"].id)
            == set()
        )

    async def test_another_departments_member_and_position_own_nothing_here(
        self, db_session, dept
    ):
        # Even a line that somehow stores the other org's position id.
        await db_session.execute(
            text("UPDATE budgets SET owner_position_id = :p WHERE id = :b"),
            {"p": dept["foreign_pos"], "b": dept["lines"]["gear"]},
        )
        assert (
            await owned_budget_ids(db_session, dept["org_id"], dept["outsider"].id)
            == set()
        )
        assert (
            await owned_budget_ids(db_session, dept["other_org"], dept["outsider"].id)
            == set()
        )


# ============================================
# Create / edit over HTTP
# ============================================


def _by_id(rows, row_id):
    return next(r for r in rows if r["id"] == row_id)


@pytest.mark.integration
class TestCreateBudget:
    async def test_create_with_station_and_owner(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.post(
                "/finance/budgets",
                json={
                    "fiscalYearId": dept["fy"],
                    "categoryId": dept["gear_cat"],
                    "amountBudgeted": "1200.00",
                    "stationId": dept["station"],
                    "ownerPositionId": dept["chief_pos"],
                    "notes": "Turnout gear",
                },
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["stationId"] == dept["station"]
        assert body["stationName"] == "Station 2"
        assert body["ownerPositionId"] == dept["chief_pos"]
        assert body["ownerPositionName"] == "Chief"
        assert body["effectiveOwnerPositionId"] == dept["chief_pos"]
        assert body["effectiveOwnerPositionName"] == "Chief"
        assert body["ownerInherited"] is False

    async def test_create_without_owner_reports_the_inherited_one(
        self, db_session, dept
    ):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.post(
                "/finance/budgets",
                json={
                    "fiscalYearId": dept["draft_fy"],
                    "categoryId": dept["training_cat"],
                    "amountBudgeted": "100.00",
                },
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["ownerPositionId"] is None
        assert body["ownerPositionName"] is None
        assert body["effectiveOwnerPositionId"] == dept["training_officer"]
        assert body["effectiveOwnerPositionName"] == "Training Officer"
        assert body["ownerInherited"] is True
        assert body["stationId"] is None
        assert body["stationName"] is None

    async def test_a_closed_fiscal_year_takes_no_new_lines(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.post(
                "/finance/budgets",
                json={
                    "fiscalYearId": dept["closed_fy"],
                    "categoryId": dept["gear_cat"],
                    "amountBudgeted": "100.00",
                },
            )
        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("This fiscal year is closed")

    @pytest.mark.parametrize(
        ("field", "key"),
        [("stationId", "foreign_station"), ("ownerPositionId", "foreign_pos")],
    )
    async def test_another_departments_reference_is_refused(
        self, db_session, dept, field, key
    ):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.post(
                "/finance/budgets",
                json={
                    "fiscalYearId": dept["fy"],
                    "categoryId": dept["gear_cat"],
                    "amountBudgeted": "100.00",
                    field: dept[key],
                },
            )
        assert resp.status_code == 400
        assert resp.json()["detail"] in ("Invalid Station", "Invalid Owner position")

    async def test_a_viewer_cannot_create(self, db_session, dept):
        async with _client(db_session, dept["viewer"]) as client:
            resp = await client.post(
                "/finance/budgets",
                json={
                    "fiscalYearId": dept["fy"],
                    "categoryId": dept["gear_cat"],
                    "amountBudgeted": "100.00",
                },
            )
        assert resp.status_code == 403


@pytest.mark.integration
class TestUpdateBudget:
    async def test_explicit_null_clears_owner_back_to_the_category(
        self, db_session, dept
    ):
        line = dept["lines"]["training_chief"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"ownerPositionId": None}
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ownerPositionId"] is None
        assert body["effectiveOwnerPositionId"] == dept["training_officer"]
        assert body["ownerInherited"] is True
        # Station was omitted, so it is untouched.
        assert body["stationId"] == dept["station"]

    async def test_explicit_null_clears_station_and_leaves_owner(
        self, db_session, dept
    ):
        line = dept["lines"]["training_chief"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"stationId": None}
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["stationId"] is None
        assert body["stationName"] is None
        assert body["ownerPositionId"] == dept["chief_pos"]

    async def test_sets_owner_and_station(self, db_session, dept):
        line = dept["lines"]["gear"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}",
                json={
                    "ownerPositionId": dept["training_officer"],
                    "stationId": dept["station"],
                    "amountBudgeted": "900.00",
                },
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["effectiveOwnerPositionName"] == "Training Officer"
        assert body["ownerInherited"] is False
        assert body["stationName"] == "Station 2"
        assert Decimal(body["amountBudgeted"]) == Decimal("900.00")

    @pytest.mark.parametrize(
        ("field", "key"),
        [("stationId", "foreign_station"), ("ownerPositionId", "foreign_pos")],
    )
    async def test_another_departments_reference_is_refused(
        self, db_session, dept, field, key
    ):
        line = dept["lines"]["gear"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(f"/finance/budgets/{line}", json={field: dept[key]})
        assert resp.status_code == 400

    async def test_lowering_below_spent_and_encumbered_is_refused(
        self, db_session, dept
    ):
        line = dept["lines"]["training"]  # 500 spent + 250 encumbered
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"amountBudgeted": "700.00"}
            )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "Insufficient available budget"


@pytest.mark.integration
class TestListAndDetail:
    async def test_list_reports_station_and_owner_names(self, db_session, dept):
        async with _client(db_session, dept["viewer"]) as client:
            resp = await client.get(f"/finance/budgets?fiscal_year_id={dept['fy']}")
        assert resp.status_code == 200
        rows = resp.json()
        inherited = _by_id(rows, dept["lines"]["training"])
        assert inherited["effectiveOwnerPositionName"] == "Training Officer"
        assert inherited["ownerInherited"] is True
        own = _by_id(rows, dept["lines"]["training_chief"])
        assert own["effectiveOwnerPositionName"] == "Chief"
        assert own["ownerInherited"] is False
        assert own["stationName"] == "Station 2"
        nobody = _by_id(rows, dept["lines"]["gear"])
        assert nobody["effectiveOwnerPositionId"] is None
        assert nobody["ownerInherited"] is False

    async def test_list_filters_by_station(self, db_session, dept):
        async with _client(db_session, dept["viewer"]) as client:
            resp = await client.get(f"/finance/budgets?station_id={dept['station']}")
        assert resp.status_code == 200
        assert [r["id"] for r in resp.json()] == [dept["lines"]["training_chief"]]

    async def test_detail_reports_the_same(self, db_session, dept):
        line = dept["lines"]["training_last_year"]
        async with _client(db_session, dept["viewer"]) as client:
            resp = await client.get(f"/finance/budgets/{line}")
        assert resp.status_code == 200
        assert resp.json()["effectiveOwnerPositionId"] == dept["training_officer"]

    async def test_another_departments_line_is_not_found(self, db_session, dept):
        line = dept["lines"]["gear"]
        outsider_admin = await _user(
            db_session,
            dept["other_org"],
            "their-treasurer",
            [
                await _position(
                    db_session, dept["other_org"], "Their Treasurer", ["finance.*"]
                )
            ],
        )
        async with _client(db_session, outsider_admin) as client:
            get = await client.get(f"/finance/budgets/{line}")
            put = await client.put(
                f"/finance/budgets/{line}", json={"ownerPositionId": None}
            )
        assert get.status_code == 404
        assert put.status_code == 400


@pytest.mark.integration
class TestCategoryOwner:
    async def test_create_and_clear_category_owner(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            created = await client.post(
                "/finance/budget-categories",
                json={"name": "Fuel", "ownerPositionId": dept["chief_pos"]},
            )
            assert created.status_code == 201, created.text
            assert created.json()["ownerPositionName"] == "Chief"
            cat_id = created.json()["id"]

            renamed = await client.put(
                f"/finance/budget-categories/{cat_id}", json={"name": "Fuel & Oil"}
            )
            assert renamed.json()["ownerPositionId"] == dept["chief_pos"]

            cleared = await client.put(
                f"/finance/budget-categories/{cat_id}",
                json={"ownerPositionId": None},
            )
            assert cleared.status_code == 200
            assert cleared.json()["ownerPositionId"] is None
            assert cleared.json()["ownerPositionName"] is None

            listed = await client.get("/finance/budget-categories")
        assert _by_id(listed.json(), dept["training_cat"])["ownerPositionName"] == (
            "Training Officer"
        )

    async def test_another_departments_position_is_refused(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            created = await client.post(
                "/finance/budget-categories",
                json={"name": "Fuel", "ownerPositionId": dept["foreign_pos"]},
            )
            updated = await client.put(
                f"/finance/budget-categories/{dept['gear_cat']}",
                json={"ownerPositionId": dept["foreign_pos"]},
            )
        assert created.status_code == 400
        assert updated.status_code == 400


@pytest.mark.integration
class TestFormOptions:
    async def test_positions_are_the_departments_own(self, db_session, dept):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.get("/finance/position-options")
        assert resp.status_code == 200
        names = [row["name"] for row in resp.json()]
        assert names == sorted(names)
        assert {"Training Officer", "Chief", "Treasurer"} <= set(names)
        assert "Their Chief" not in names
        assert set(resp.json()[0]) == {"id", "name"}

    async def test_stations_are_the_departments_unarchived_facilities(
        self, db_session, dept
    ):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.get("/finance/station-options")
        assert resp.status_code == 200
        assert resp.json() == [{"id": dept["station"], "name": "Station 2"}]

    @pytest.mark.parametrize("path", ["position-options", "station-options"])
    async def test_a_viewer_is_refused(self, db_session, dept, path):
        async with _client(db_session, dept["viewer"]) as client:
            resp = await client.get(f"/finance/{path}")
        assert resp.status_code == 403
