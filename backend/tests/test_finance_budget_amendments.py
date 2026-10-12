"""Budget amendments: extra money leadership approved for a budget line.

Owner decisions, 2026-10-08:

* each increase is a logged amendment — amount added, reason, who approved it
  and when, who entered it — and adding one raises the line's
  ``amount_budgeted``, which stays the live ceiling;
* the original budget is the current one less the amendments, derived and
  reported on every budget response, list and detail;
* amendments are allowed in draft, active and closed years and refused in a
  locked one, where a plain edit of the amount is refused too (notes, owner
  and station stay editable);
* ``finance.manage`` records one; the line's own read gate lists them;
* each one is audited.
"""

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import finance as finance_endpoints
from app.core.database import get_db
from app.models.finance import (
    Budget,
    BudgetAmendment,
    BudgetCategory,
    FiscalYear,
    FiscalYearStatus,
)
from app.models.user import User
from app.schemas.finance import BudgetAmendmentCreate

_VALID = {
    "amount": "250.00",
    "reason": "Hose replacement after the warehouse fire",
    "approvedBy": "Board vote 10/7",
    "approvedOn": "2026-10-07",
}


# ============================================
# The request schema, no database
# ============================================


@pytest.mark.unit
class TestAmendmentSchema:
    def test_a_valid_body_is_accepted_in_camel_case(self):
        body = BudgetAmendmentCreate.model_validate(_VALID)
        assert body.amount == Decimal("250.00")
        assert body.approved_by == "Board vote 10/7"
        assert body.approved_on == date(2026, 10, 7)

    @pytest.mark.parametrize("amount", ["0", "0.00", "-5.00"])
    def test_amount_must_be_positive(self, amount):
        with pytest.raises(ValidationError):
            BudgetAmendmentCreate.model_validate({**_VALID, "amount": amount})

    @pytest.mark.parametrize("amount", ["1.005", "10000000000.00"])
    def test_amount_fits_the_column(self, amount):
        with pytest.raises(ValidationError):
            BudgetAmendmentCreate.model_validate({**_VALID, "amount": amount})

    @pytest.mark.parametrize("field", ["reason", "approvedBy"])
    def test_blank_text_is_refused(self, field):
        with pytest.raises(ValidationError):
            BudgetAmendmentCreate.model_validate({**_VALID, field: "   "})

    def test_text_is_length_limited(self):
        with pytest.raises(ValidationError):
            BudgetAmendmentCreate.model_validate({**_VALID, "approvedBy": "x" * 201})
        with pytest.raises(ValidationError):
            BudgetAmendmentCreate.model_validate({**_VALID, "reason": "x" * 2001})

    def test_surrounding_whitespace_is_trimmed(self):
        body = BudgetAmendmentCreate.model_validate(
            {**_VALID, "approvedBy": "  Chief  "}
        )
        assert body.approved_by == "Chief"


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


async def _user(db: AsyncSession, org_id: str, name: str, position_id: str) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Test', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "fn": name.capitalize(),
            "un": f"{name}-{user_id[:8]}",
            "em": f"{name}-{user_id[:8]}@test.example",
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


def _year(org_id, name, status, created_by, year, locked=False) -> FiscalYear:
    return FiscalYear(
        organization_id=org_id,
        name=name,
        start_date=datetime(year, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(year, 12, 31, tzinfo=timezone.utc),
        status=status,
        is_locked=locked,
        created_by=created_by,
    )


@pytest.fixture
async def dept(db_session: AsyncSession):
    """A department with a line in each kind of year, and a second department."""
    org_id = await _org(db_session, "amend")
    other_org = await _org(db_session, "amend-other")
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    viewer_pos = await _position(db_session, org_id, "Finance Viewer", ["finance.view"])
    # The second officer who confirms what the Treasurer enters.
    reviewer_pos = await _position(
        db_session, org_id, "President", ["finance.view", "finance.budget_review"]
    )
    foreign_pos = await _position(
        db_session, other_org, "Their Treasurer", ["finance.view", "finance.manage"]
    )
    treasurer = await _user(db_session, org_id, "treasurer", treasurer_pos)
    viewer = await _user(db_session, org_id, "viewer", viewer_pos)
    reviewer = await _user(db_session, org_id, "reviewer", reviewer_pos)
    outsider = await _user(db_session, other_org, "outsider", foreign_pos)

    years = {
        "active": _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer.id, 2026),
        "draft": _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer.id, 2027),
        "closed": _year(org_id, "FY2025", FiscalYearStatus.CLOSED, treasurer.id, 2025),
        "locked": _year(
            org_id, "FY2024", FiscalYearStatus.CLOSED, treasurer.id, 2024, locked=True
        ),
    }
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    db_session.add_all([*years.values(), gear])
    await db_session.flush()

    lines = {
        key: Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=gear.id,
            amount_budgeted=Decimal("800.00"),
            amount_spent=Decimal("100.00"),
            created_by=treasurer.id,
        )
        for key, fy in years.items()
    }
    db_session.add_all(lines.values())
    await db_session.flush()
    return {
        "org_id": org_id,
        "treasurer": treasurer,
        "viewer": viewer,
        "reviewer": reviewer,
        "outsider": outsider,
        "lines": {k: v.id for k, v in lines.items()},
    }


@pytest.fixture
def audit(monkeypatch):
    recorder = AsyncMock()
    monkeypatch.setattr(finance_endpoints, "log_audit_event", recorder)
    return recorder


async def _amend(client: AsyncClient, budget_id: str, **overrides):
    return await client.post(
        f"/finance/budgets/{budget_id}/amendments", json={**_VALID, **overrides}
    )


async def _decide(db, user, budget_id, amendment_id, action, body=None):
    async with _client(db, user) as client:
        return await client.post(
            f"/finance/budgets/{budget_id}/amendments/{amendment_id}/{action}",
            json=body,
        )


async def _amend_and_confirm(db, dept, budget_id, **overrides):
    """Enter an amendment as the Treasurer and confirm it as the President."""
    async with _client(db, dept["treasurer"]) as client:
        entered = await _amend(client, budget_id, **overrides)
    assert entered.status_code == 201, entered.text
    confirmed = await _decide(
        db, dept["reviewer"], budget_id, entered.json()["amendment"]["id"], "confirm"
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed


async def _amount(db: AsyncSession, budget_id: str) -> Decimal:
    return (
        await db.execute(select(Budget.amount_budgeted).where(Budget.id == budget_id))
    ).scalar_one()


# ============================================
# Recording an amendment
# ============================================


@pytest.mark.integration
class TestAddAmendment:
    async def test_entering_one_moves_nothing_until_it_is_confirmed(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, line)
        assert resp.status_code == 201, resp.text
        entered = resp.json()
        assert entered["amendment"]["status"] == "pending"
        assert Decimal(entered["budget"]["amountBudgeted"]) == Decimal("800.00")
        assert entered["budget"]["amendmentCount"] == 0
        assert entered["budget"]["pendingAmendmentCount"] == 1
        assert await _amount(db_session, line) == Decimal("800.00")

    async def test_confirming_raises_the_budget_and_keeps_the_original(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        resp = await _amend_and_confirm(db_session, dept, line)
        body = resp.json()
        assert Decimal(body["budget"]["amountBudgeted"]) == Decimal("1050.00")
        assert Decimal(body["budget"]["originalAmount"]) == Decimal("800.00")
        assert Decimal(body["budget"]["amendmentsTotal"]) == Decimal("250.00")
        assert body["budget"]["amendmentCount"] == 1
        amendment = body["amendment"]
        assert Decimal(amendment["amount"]) == Decimal("250.00")
        assert amendment["approvedBy"] == "Board vote 10/7"
        assert amendment["approvedOn"] == "2026-10-07"
        assert amendment["createdBy"] == dept["treasurer"].id
        assert amendment["enteredByName"] == "Treasurer Test"
        assert amendment["status"] == "confirmed"
        assert amendment["decidedBy"] == dept["reviewer"].id
        assert amendment["decidedByName"] == "Reviewer Test"
        assert amendment["decidedAt"] is not None
        assert body["budget"]["pendingAmendmentCount"] == 0
        assert await _amount(db_session, line) == Decimal("1050.00")

    async def test_amendments_sum(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        for amount in ("100.00", "50.25", "0.75"):
            await _amend_and_confirm(db_session, dept, line, amount=amount)
        async with _client(db_session, dept["treasurer"]) as client:
            detail = (await client.get(f"/finance/budgets/{line}")).json()
        assert Decimal(detail["amountBudgeted"]) == Decimal("951.00")
        assert Decimal(detail["originalAmount"]) == Decimal("800.00")
        assert Decimal(detail["amendmentsTotal"]) == Decimal("151.00")
        assert detail["amendmentCount"] == 3

    @pytest.mark.parametrize("year", ["draft", "closed"])
    async def test_draft_and_closed_years_take_amendments(
        self, db_session, dept, audit, year
    ):
        line = dept["lines"][year]
        await _amend_and_confirm(db_session, dept, line)
        assert await _amount(db_session, line) == Decimal("1050.00")

    async def test_a_locked_year_takes_none(self, db_session, dept, audit):
        line = dept["lines"]["locked"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, line)
        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("This fiscal year is locked")
        assert await _amount(db_session, line) == Decimal("800.00")
        count = (
            await db_session.execute(
                select(BudgetAmendment).where(BudgetAmendment.budget_id == line)
            )
        ).all()
        assert count == []
        audit.assert_not_called()

    async def test_the_amendment_is_audited(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, line)
        assert resp.status_code == 201
        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "finance.budget_amended"
        assert kwargs["organization_id"] == dept["org_id"]
        assert kwargs["user_id"] == dept["treasurer"].id
        assert kwargs["event_data"]["budget_id"] == line
        assert kwargs["event_data"]["amount"] == "250.00"
        assert kwargs["event_data"]["approved_by"] == "Board vote 10/7"

    async def test_a_future_approval_date_is_refused(self, db_session, dept, audit):
        tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, dept["lines"]["active"], approvedOn=tomorrow)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "The approval date cannot be in the future."

    async def test_todays_date_is_accepted(self, db_session, dept, audit):
        today = datetime.now(timezone.utc).date().isoformat()
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, dept["lines"]["active"], approvedOn=today)
        assert resp.status_code == 201, resp.text

    @pytest.mark.parametrize(
        "overrides",
        [
            {"amount": "0"},
            {"amount": "-1.00"},
            {"amount": "10000000000.00"},
            {"reason": "  "},
            {"approvedBy": ""},
            {"approvedBy": "x" * 201},
        ],
    )
    async def test_invalid_bodies_are_refused(self, db_session, dept, audit, overrides):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, line, **overrides)
        assert resp.status_code == 422
        assert await _amount(db_session, line) == Decimal("800.00")

    async def test_the_line_cannot_pass_the_columns_limit(
        self, db_session, dept, audit
    ):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, dept["lines"]["active"], amount="9999999999.99")
        assert resp.status_code == 400
        assert "past its limit" in resp.json()["detail"]

    async def test_another_departments_line_is_not_found(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["outsider"]) as client:
            post = await _amend(client, line)
            get = await client.get(f"/finance/budgets/{line}/amendments")
        assert post.status_code == 404
        assert get.status_code == 404
        assert await _amount(db_session, line) == Decimal("800.00")

    async def test_a_viewer_cannot_amend_but_can_read(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            assert (await _amend(client, line)).status_code == 201
        async with _client(db_session, dept["viewer"]) as client:
            post = await _amend(client, line)
            get = await client.get(f"/finance/budgets/{line}/amendments")
        assert post.status_code == 403
        assert get.status_code == 200
        assert len(get.json()) == 1


# ============================================
# Listing
# ============================================


@pytest.mark.integration
class TestListAmendments:
    async def test_newest_first_with_who_entered_each(self, db_session, dept):
        line = dept["lines"]["active"]
        base = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
        for days, approver in ((0, "First vote"), (2, "Third vote"), (1, "Second")):
            db_session.add(
                BudgetAmendment(
                    organization_id=dept["org_id"],
                    budget_id=line,
                    amount=Decimal("10.00"),
                    reason="r",
                    approved_by=approver,
                    approved_on=date(2026, 9, 30),
                    created_by=dept["treasurer"].id,
                    created_at=base + timedelta(days=days),
                )
            )
        await db_session.flush()
        async with _client(db_session, dept["viewer"]) as client:
            resp = await client.get(f"/finance/budgets/{line}/amendments")
        assert resp.status_code == 200
        rows = resp.json()
        assert [r["approvedBy"] for r in rows] == ["Third vote", "Second", "First vote"]
        assert {r["enteredByName"] for r in rows} == {"Treasurer Test"}

    async def test_an_unamended_line_reports_its_amount_as_original(
        self, db_session, dept
    ):
        async with _client(db_session, dept["viewer"]) as client:
            rows = (await client.get("/finance/budgets")).json()
            listed = (
                await client.get(
                    f"/finance/budgets/{dept['lines']['draft']}/amendments"
                )
            ).json()
        assert listed == []
        for row in rows:
            assert row["amendmentCount"] == 0
            assert Decimal(row["amendmentsTotal"]) == 0
            assert Decimal(row["originalAmount"]) == Decimal(row["amountBudgeted"])

    async def test_the_list_reports_each_lines_own_amendments(
        self, db_session, dept, audit
    ):
        for line, amount in (
            ("active", "40.00"),
            ("active", "60.00"),
            ("draft", "5.00"),
        ):
            await _amend_and_confirm(
                db_session, dept, dept["lines"][line], amount=amount
            )
        async with _client(db_session, dept["treasurer"]) as client:
            rows = {r["id"]: r for r in (await client.get("/finance/budgets")).json()}
        active = rows[dept["lines"]["active"]]
        assert active["amendmentCount"] == 2
        assert Decimal(active["amendmentsTotal"]) == Decimal("100.00")
        assert Decimal(active["originalAmount"]) == Decimal("800.00")
        draft = rows[dept["lines"]["draft"]]
        assert draft["amendmentCount"] == 1
        assert Decimal(draft["amountBudgeted"]) == Decimal("805.00")
        assert rows[dept["lines"]["closed"]]["amendmentCount"] == 0


# ============================================
# A locked year's amounts are frozen for plain edits too
# ============================================


@pytest.mark.integration
class TestLockedYearEdit:
    async def test_the_amount_cannot_change(self, db_session, dept):
        line = dept["lines"]["locked"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"amountBudgeted": "900.00"}
            )
        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("This fiscal year is locked")
        assert await _amount(db_session, line) == Decimal("800.00")

    async def test_notes_still_save_with_the_amount_unchanged(self, db_session, dept):
        line = dept["lines"]["locked"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}",
                json={"amountBudgeted": "800.00", "notes": "Audited"},
            )
            only_notes = await client.put(
                f"/finance/budgets/{line}", json={"notes": "Audited twice"}
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["notes"] == "Audited"
        assert only_notes.status_code == 200
        assert only_notes.json()["notes"] == "Audited twice"

    @pytest.mark.parametrize("year", ["active", "closed"])
    async def test_an_active_or_closing_years_amount_changes_only_by_amendment(
        self, db_session, dept, year
    ):
        line = dept["lines"][year]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"amountBudgeted": "900.00"}
            )
            detail = (await client.get(f"/finance/budgets/{line}")).json()
        assert resp.status_code == 400
        assert "only through an amendment" in resp.json()["detail"]
        assert await _amount(db_session, line) == Decimal("800.00")
        assert detail["amountEditable"] is False

    async def test_a_draft_taking_requests_still_takes_amount_edits(
        self, db_session, dept
    ):
        line = dept["lines"]["draft"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"amountBudgeted": "900.00"}
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["amountEditable"] is True
        assert await _amount(db_session, line) == Decimal("900.00")

    @pytest.mark.parametrize("stage", ["board_review", "adopted"])
    async def test_a_draft_before_the_board_or_adopted_is_frozen_too(
        self, db_session, dept, stage
    ):
        line = dept["lines"]["draft"]
        year = await db_session.get(
            FiscalYear, (await db_session.get(Budget, line)).fiscal_year_id
        )
        year.planning_stage = stage
        await db_session.flush()
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await client.put(
                f"/finance/budgets/{line}", json={"amountBudgeted": "900.00"}
            )
        assert resp.status_code == 400
        assert "only through an amendment" in resp.json()["detail"]

    async def test_a_new_line_in_an_active_year_starts_at_zero(self, db_session, dept):
        line = await db_session.get(Budget, dept["lines"]["active"])
        other = BudgetCategory(organization_id=dept["org_id"], name="Fuel")
        db_session.add(other)
        await db_session.flush()
        body = {"fiscalYearId": line.fiscal_year_id, "categoryId": other.id}
        async with _client(db_session, dept["treasurer"]) as client:
            funded = await client.post(
                "/finance/budgets", json={**body, "amountBudgeted": "500.00"}
            )
            empty = await client.post(
                "/finance/budgets", json={**body, "amountBudgeted": "0"}
            )
        assert funded.status_code == 400
        assert "starts at zero" in funded.json()["detail"]
        assert empty.status_code == 201, empty.text


# ============================================
# The second officer
# ============================================


@pytest.mark.integration
class TestConfirmation:
    async def _entered(self, db_session, dept, line="active") -> str:
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _amend(client, dept["lines"][line])
        assert resp.status_code == 201, resp.text
        return resp.json()["amendment"]["id"]

    async def test_whoever_entered_it_cannot_confirm_it(self, db_session, dept, audit):
        amendment = await self._entered(db_session, dept)
        line = dept["lines"]["active"]

        resp = await _decide(db_session, dept["treasurer"], line, amendment, "confirm")

        assert resp.status_code == 400
        assert "your own" in resp.json()["detail"]
        assert await _amount(db_session, line) == Decimal("800.00")

    async def test_another_finance_manager_may_confirm(self, db_session, dept, audit):
        amendment = await self._entered(db_session, dept)
        line = dept["lines"]["active"]
        other_pos = await _position(
            db_session, dept["org_id"], "Assistant Treasurer", ["finance.manage"]
        )
        other = await _user(db_session, dept["org_id"], "assistant", other_pos)

        resp = await _decide(db_session, other, line, amendment, "confirm")

        assert resp.status_code == 200, resp.text
        assert await _amount(db_session, line) == Decimal("1050.00")
        assert "finance.budget_amendment_confirmed" in [
            call.kwargs["event_type"] for call in audit.await_args_list
        ]

    async def test_a_viewer_cannot_decide(self, db_session, dept, audit):
        amendment = await self._entered(db_session, dept)
        line = dept["lines"]["active"]

        confirm = await _decide(db_session, dept["viewer"], line, amendment, "confirm")
        reject = await _decide(
            db_session, dept["viewer"], line, amendment, "reject", {"note": "No"}
        )

        assert (confirm.status_code, reject.status_code) == (403, 403)

    async def test_a_rejection_needs_a_reason_and_moves_nothing(
        self, db_session, dept, audit
    ):
        amendment = await self._entered(db_session, dept)
        line = dept["lines"]["active"]
        reviewer = dept["reviewer"]

        blank = await _decide(
            db_session, reviewer, line, amendment, "reject", {"note": " "}
        )
        resp = await _decide(
            db_session, reviewer, line, amendment, "reject", {"note": "Not voted on"}
        )
        again = await _decide(db_session, reviewer, line, amendment, "confirm")

        assert blank.status_code == 422
        assert resp.status_code == 200, resp.text
        rejected = resp.json()["amendment"]
        assert rejected["status"] == "rejected"
        assert rejected["decisionNote"] == "Not voted on"
        assert again.status_code == 409
        assert await _amount(db_session, line) == Decimal("800.00")

    async def test_whoever_entered_it_may_withdraw_it(self, db_session, dept, audit):
        amendment = await self._entered(db_session, dept)
        line = dept["lines"]["active"]

        resp = await _decide(
            db_session, dept["treasurer"], line, amendment, "reject", {"note": "Typo"}
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["amendment"]["status"] == "rejected"

    async def test_a_year_locked_since_it_was_entered_refuses_it(
        self, db_session, dept, audit
    ):
        amendment = await self._entered(db_session, dept, "closed")
        line = dept["lines"]["closed"]
        year = await db_session.get(
            FiscalYear, (await db_session.get(Budget, line)).fiscal_year_id
        )
        year.is_locked = True
        await db_session.flush()

        resp = await _decide(db_session, dept["reviewer"], line, amendment, "confirm")

        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("This fiscal year is locked")

    async def test_another_departments_amendment_is_not_found(
        self, db_session, dept, audit
    ):
        amendment = await self._entered(db_session, dept)
        line = dept["lines"]["active"]

        resp = await _decide(db_session, dept["outsider"], line, amendment, "confirm")

        assert resp.status_code == 404

    async def test_a_pending_amendment_holds_the_year_open(
        self, db_session, dept, audit
    ):
        amendment = await self._entered(db_session, dept, "closed")
        line = dept["lines"]["closed"]
        fy_id = (await db_session.get(Budget, line)).fiscal_year_id

        async with _client(db_session, dept["treasurer"]) as client:
            items = (
                await client.get(f"/finance/fiscal-years/{fy_id}/open-items")
            ).json()
            lock = await client.post(
                f"/finance/fiscal-years/{fy_id}/lock", json={"notes": "Reconciled"}
            )
        assert [i["kind"] for i in items] == ["budget_amendment"]
        assert items[0]["entityId"] == line
        assert items[0]["number"] == "Amendment to Gear"
        assert lock.status_code == 400
        assert "confirm or reject each amendment" in lock.json()["detail"]

        await _decide(
            db_session, dept["reviewer"], line, amendment, "reject", {"note": "No vote"}
        )
        async with _client(db_session, dept["treasurer"]) as client:
            items = (
                await client.get(f"/finance/fiscal-years/{fy_id}/open-items")
            ).json()
        assert items == []
