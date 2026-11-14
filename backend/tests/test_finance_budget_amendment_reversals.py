"""Reversing a mistaken budget amendment.

Owner decision, 2026-10-09: a mistaken amendment is corrected by a
**reversing entry**, never by editing or deleting it.

* the reversal is a new amendment row for the whole amount, negated -- or,
  since the owner's decision of 2026-11-01, any part of it -- naming the
  amendment it reverses, with its own reason, approval and approval date;
* a rejected reversal keeps naming that amendment for display
  (``reversesAmendmentRef``), though its link is cleared;
* it is entered pending, like any amendment, and lowers ``amount_budgeted``
  only once a second officer confirms it; the original budget (current less
  every confirmed row's amount) stays where it was;
* only a confirmed amendment is reversed, and a pending reversal holds its
  target: a second reversal is refused until the first is rejected;
* an amendment is reversed at most once (409), and a reversal is never
  reversed itself (400) -- money is restored by recording a new amendment;
* refused in a locked year (400) and when the lower budget would no longer
  cover what is spent and committed (409 "Insufficient available budget");
* ``finance.manage`` only; the list's read gate shows the link both ways;
* another department's line, or an amendment not on the line, is 404;
* each reversal is audited as ``finance.budget_amendment_reversed``.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import finance as finance_endpoints
from app.models.finance import (
    Budget,
    BudgetAmendment,
    BudgetAmendmentStatus,
    BudgetCategory,
    FiscalYearStatus,
)
from app.schemas.finance import BudgetAmendmentCreate, BudgetAmendmentReverse
from tests.test_finance_budget_amendments import (
    _client,
    _decide,
    _org,
    _position,
    _user,
    _year,
)

_REVERSAL = {
    "reason": "Entered $2,500 for $250",
    "approvedBy": "Treasurer's correction, Chief concurs",
    "approvedOn": "2026-10-08",
}


# ============================================
# The request schema, no database
# ============================================


@pytest.mark.unit
class TestReversalSchema:
    def test_a_valid_body_is_accepted_in_camel_case(self):
        body = BudgetAmendmentReverse.model_validate(_REVERSAL)
        assert body.approved_by == "Treasurer's correction, Chief concurs"
        assert body.approved_on == date(2026, 10, 8)

    @pytest.mark.parametrize("field", ["reason", "approvedBy"])
    def test_blank_text_is_refused(self, field):
        with pytest.raises(ValidationError):
            BudgetAmendmentReverse.model_validate({**_REVERSAL, field: "  "})

    @pytest.mark.parametrize("field", ["reason", "approvedBy", "approvedOn"])
    def test_every_field_is_required(self, field):
        body = {k: v for k, v in _REVERSAL.items() if k != field}
        with pytest.raises(ValidationError):
            BudgetAmendmentReverse.model_validate(body)

    def test_the_amount_is_optional_and_means_the_whole_amendment(self):
        # Owner decision 2026-11-01: partial reversals. Left out, the whole
        # amendment is reversed, as before.
        assert BudgetAmendmentReverse.model_validate(_REVERSAL).amount is None
        body = BudgetAmendmentReverse.model_validate({**_REVERSAL, "amount": "2250"})
        assert body.amount == Decimal("2250")

    @pytest.mark.parametrize("amount", ["-250.00", "0", "0.001"])
    def test_a_reversal_amount_must_be_a_positive_cent_figure(self, amount):
        with pytest.raises(ValidationError):
            BudgetAmendmentReverse.model_validate({**_REVERSAL, "amount": amount})

    @pytest.mark.parametrize("amount", ["-250.00", "0"])
    def test_creating_an_amendment_still_refuses_a_non_positive_amount(self, amount):
        with pytest.raises(ValidationError):
            BudgetAmendmentCreate.model_validate({**_REVERSAL, "amount": amount})


# ============================================
# Fixtures
# ============================================


@pytest.fixture
async def dept(db_session: AsyncSession):
    """A department with amended lines in each kind of year, and a second one.

    Each line started at 800.00, has 100.00 spent, and carries two
    amendments: +250.00 (``first``) and +2,500.00 (``typo``).
    """
    org_id = await _org(db_session, "reverse")
    other_org = await _org(db_session, "reverse-other")
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    viewer_pos = await _position(db_session, org_id, "Finance Viewer", ["finance.view"])
    captain_pos = await _position(db_session, org_id, "Captain", [])
    reviewer_pos = await _position(
        db_session, org_id, "President", ["finance.view", "finance.budget_review"]
    )
    foreign_pos = await _position(
        db_session, other_org, "Their Treasurer", ["finance.view", "finance.manage"]
    )
    treasurer = await _user(db_session, org_id, "treasurer", treasurer_pos)
    viewer = await _user(db_session, org_id, "viewer", viewer_pos)
    owner = await _user(db_session, org_id, "captain", captain_pos)
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
            owner_position_id=captain_pos,
            amount_budgeted=Decimal("3550.00"),
            amount_spent=Decimal("100.00"),
            created_by=treasurer.id,
        )
        for key, fy in years.items()
    }
    db_session.add_all(lines.values())
    await db_session.flush()

    base = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    amendments: dict = {}
    for key, line in lines.items():
        first = BudgetAmendment(
            organization_id=org_id,
            budget_id=line.id,
            amount=Decimal("250.00"),
            reason="Hose",
            approved_by="Board vote 9/30",
            approved_on=date(2026, 9, 30),
            created_by=treasurer.id,
            created_at=base,
            status=BudgetAmendmentStatus.CONFIRMED,
        )
        typo = BudgetAmendment(
            organization_id=org_id,
            budget_id=line.id,
            amount=Decimal("2500.00"),
            reason="Gloves",
            approved_by="Board vote 10/7",
            approved_on=date(2026, 10, 7),
            created_by=treasurer.id,
            created_at=base + timedelta(days=1),
            status=BudgetAmendmentStatus.CONFIRMED,
        )
        db_session.add_all([first, typo])
        amendments[key] = (first, typo)
    await db_session.flush()
    return {
        "org_id": org_id,
        "treasurer": treasurer,
        "viewer": viewer,
        "owner": owner,
        "reviewer": reviewer,
        "outsider": outsider,
        "lines": {k: v.id for k, v in lines.items()},
        "first": {k: v[0].id for k, v in amendments.items()},
        "typo": {k: v[1].id for k, v in amendments.items()},
    }


@pytest.fixture
def audit(monkeypatch):
    recorder = AsyncMock()
    monkeypatch.setattr(finance_endpoints, "log_audit_event", recorder)
    return recorder


async def _reverse(client, budget_id: str, amendment_id: str, **overrides):
    return await client.post(
        f"/finance/budgets/{budget_id}/amendments/{amendment_id}/reverse",
        json={**_REVERSAL, **overrides},
    )


async def _reverse_and_confirm(db, dept, budget_id: str, amendment_id: str):
    """Enter a reversal as the Treasurer and confirm it as the President."""
    async with _client(db, dept["treasurer"]) as client:
        entered = await _reverse(client, budget_id, amendment_id)
    assert entered.status_code == 201, entered.text
    confirmed = await _decide(
        db, dept["reviewer"], budget_id, entered.json()["amendment"]["id"], "confirm"
    )
    assert confirmed.status_code == 200, confirmed.text
    return entered, confirmed


async def _amount(db: AsyncSession, budget_id: str) -> Decimal:
    return (
        await db.execute(select(Budget.amount_budgeted).where(Budget.id == budget_id))
    ).scalar_one()


async def _rows(db: AsyncSession, budget_id: str) -> list:
    return list(
        (
            await db.execute(
                select(BudgetAmendment).where(BudgetAmendment.budget_id == budget_id)
            )
        )
        .scalars()
        .all()
    )


# ============================================
# Recording a reversal
# ============================================


@pytest.mark.integration
class TestReverseAmendment:
    async def test_entering_one_lowers_nothing_until_it_is_confirmed(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"])
        assert resp.status_code == 201, resp.text
        assert resp.json()["amendment"]["status"] == "pending"
        assert resp.json()["budget"]["pendingAmendmentCount"] == 1
        assert await _amount(db_session, line) == Decimal("3550.00")

    async def test_lowers_the_budget_and_keeps_the_original(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        entered, resp = await _reverse_and_confirm(db_session, dept, line, typo)
        body = resp.json()
        budget = body["budget"]
        assert Decimal(budget["amountBudgeted"]) == Decimal("1050.00")
        assert Decimal(budget["originalAmount"]) == Decimal("800.00")
        assert Decimal(budget["amendmentsTotal"]) == Decimal("250.00")
        assert budget["amendmentCount"] == 3
        reversal = body["amendment"]
        assert Decimal(reversal["amount"]) == Decimal("-2500.00")
        assert reversal["reversesAmendmentId"] == typo
        assert reversal["isReversal"] is True
        assert reversal["status"] == "confirmed"
        assert reversal["reason"] == "Entered $2,500 for $250"
        assert reversal["approvedOn"] == "2026-10-08"
        assert reversal["createdBy"] == dept["treasurer"].id
        assert reversal["enteredByName"] == "Treasurer Test"
        assert await _amount(db_session, line) == Decimal("1050.00")
        # The original is untouched: same amount, still on record.
        original = await db_session.get(BudgetAmendment, typo)
        await db_session.refresh(original)
        assert original.amount == Decimal("2500.00")
        assert original.reverses_amendment_id is None

    async def test_two_amendments_reversed_one_after_another_both_apply(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        await _reverse_and_confirm(db_session, dept, line, dept["typo"]["active"])
        await _reverse_and_confirm(db_session, dept, line, dept["first"]["active"])
        async with _client(db_session, dept["treasurer"]) as client:
            detail = (await client.get(f"/finance/budgets/{line}")).json()
        assert Decimal(detail["amountBudgeted"]) == Decimal("800.00")
        assert Decimal(detail["originalAmount"]) == Decimal("800.00")
        assert Decimal(detail["amendmentsTotal"]) == Decimal("0.00")
        assert detail["amendmentCount"] == 4

    async def test_an_amendment_is_reversed_only_once(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            assert (await _reverse(client, line, typo)).status_code == 201
            again = await _reverse(client, line, typo)
        assert again.status_code == 409
        assert again.json()["detail"] == "This amendment has already been reversed."
        # The first reversal is still pending, so nothing has moved yet.
        assert await _amount(db_session, line) == Decimal("3550.00")
        assert len(await _rows(db_session, line)) == 3
        assert audit.await_count == 1

    async def test_a_rejected_reversal_frees_its_target_to_be_reversed_again(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            first = (await _reverse(client, line, typo)).json()["amendment"]["id"]
        rejected = await _decide(
            db_session, dept["reviewer"], line, first, "reject", {"note": "Wrong line"}
        )
        assert rejected.status_code == 200, rejected.text
        listed = {r["id"]: r for r in (await self._list(db_session, dept, line))}
        assert listed[typo]["reversedByAmendmentId"] is None
        assert listed[first]["status"] == "rejected"

        await _reverse_and_confirm(db_session, dept, line, typo)

        assert await _amount(db_session, line) == Decimal("1050.00")

    async def test_a_pending_amendment_cannot_be_reversed(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        pending = BudgetAmendment(
            organization_id=dept["org_id"],
            budget_id=line,
            amount=Decimal("40.00"),
            reason="r",
            approved_by="Chief",
            approved_on=date(2026, 10, 8),
        )
        db_session.add(pending)
        await db_session.flush()
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, pending.id)
        assert resp.status_code == 400
        assert await _amount(db_session, line) == Decimal("3550.00")

    async def _list(self, db_session, dept, line):
        async with _client(db_session, dept["treasurer"]) as client:
            return (await client.get(f"/finance/budgets/{line}/amendments")).json()

    async def test_a_reversal_cannot_be_reversed(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"])
            reversal_id = resp.json()["amendment"]["id"]
            again = await _reverse(client, line, reversal_id)
        assert again.status_code == 400
        assert again.json()["detail"].startswith("A reversal cannot itself be")
        assert await _amount(db_session, line) == Decimal("3550.00")

    async def test_an_amendment_on_another_line_is_not_found(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["draft"])
            missing = await _reverse(client, line, str(uuid.uuid4()))
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Amendment not found"
        assert missing.status_code == 404
        assert await _amount(db_session, line) == Decimal("3550.00")
        assert await _amount(db_session, dept["lines"]["draft"]) == Decimal("3550.00")
        audit.assert_not_called()

    async def test_another_department_gets_404(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["outsider"]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"])
            listed = await client.get(f"/finance/budgets/{line}/amendments")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Budget not found"
        assert listed.status_code == 404
        assert await _amount(db_session, line) == Decimal("3550.00")
        assert len(await _rows(db_session, line)) == 2
        audit.assert_not_called()

    async def test_a_locked_year_refuses_it(self, db_session, dept, audit):
        line = dept["lines"]["locked"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["locked"])
        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("This fiscal year is locked")
        assert await _amount(db_session, line) == Decimal("3550.00")
        assert len(await _rows(db_session, line)) == 2
        audit.assert_not_called()

    @pytest.mark.parametrize("year", ["draft", "closed"])
    async def test_draft_and_closed_years_allow_it(self, db_session, dept, audit, year):
        line = dept["lines"][year]
        await _reverse_and_confirm(db_session, dept, line, dept["typo"][year])
        assert await _amount(db_session, line) == Decimal("1050.00")

    async def test_spent_and_committed_must_stay_covered(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        budget = await db_session.get(Budget, line)
        budget.amount_spent = Decimal("900.00")
        budget.amount_encumbered = Decimal("200.00")
        await db_session.flush()
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"])
        assert resp.status_code == 409
        assert resp.json()["detail"] == "Insufficient available budget"
        assert await _amount(db_session, line) == Decimal("3550.00")
        assert len(await _rows(db_session, line)) == 2
        audit.assert_not_called()

    async def test_exactly_covering_spent_and_committed_is_allowed(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        budget = await db_session.get(Budget, line)
        budget.amount_spent = Decimal("1000.00")
        budget.amount_encumbered = Decimal("50.00")
        await db_session.flush()
        await _reverse_and_confirm(db_session, dept, line, dept["typo"]["active"])
        assert await _amount(db_session, line) == Decimal("1050.00")

    async def test_spending_after_entry_is_checked_again_at_confirmation(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"])
        assert resp.status_code == 201, resp.text
        budget = await db_session.get(Budget, line)
        budget.amount_spent = Decimal("2000.00")
        await db_session.flush()

        confirm = await _decide(
            db_session,
            dept["reviewer"],
            line,
            resp.json()["amendment"]["id"],
            "confirm",
        )

        assert confirm.status_code == 409
        assert confirm.json()["detail"] == "Insufficient available budget"
        assert await _amount(db_session, line) == Decimal("3550.00")

    async def test_a_future_approval_date_is_refused(self, db_session, dept, audit):
        tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(
                client, line, dept["typo"]["active"], approvedOn=tomorrow
            )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "The approval date cannot be in the future."
        assert await _amount(db_session, line) == Decimal("3550.00")

    @pytest.mark.parametrize(
        "overrides",
        [{"reason": "   "}, {"approvedBy": ""}, {"approvedBy": "x" * 201}],
    )
    async def test_invalid_bodies_are_refused(self, db_session, dept, audit, overrides):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"], **overrides)
        assert resp.status_code == 422
        assert await _amount(db_session, line) == Decimal("3550.00")

    @pytest.mark.parametrize("who", ["viewer", "owner"])
    async def test_only_finance_manage_reverses(self, db_session, dept, audit, who):
        line = dept["lines"]["active"]
        async with _client(db_session, dept[who]) as client:
            resp = await _reverse(client, line, dept["typo"]["active"])
        assert resp.status_code == 403
        assert await _amount(db_session, line) == Decimal("3550.00")

    async def test_the_reversal_is_audited(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(client, line, typo)
        assert resp.status_code == 201
        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "finance.budget_amendment_reversed"
        assert kwargs["event_category"] == "finance"
        assert kwargs["organization_id"] == dept["org_id"]
        assert kwargs["user_id"] == dept["treasurer"].id
        assert kwargs["event_data"] == {
            "budget_id": line,
            "amendment_id": resp.json()["amendment"]["id"],
            "reversed_amendment_id": typo,
            "amount": "-2500.00",
            "approved_by": "Treasurer's correction, Chief concurs",
            "approved_on": "2026-10-08",
        }


# ============================================
# Listing
# ============================================


@pytest.mark.integration
class TestListShowsTheLink:
    @pytest.mark.parametrize("who", ["viewer", "owner"])
    async def test_both_rows_carry_the_link(self, db_session, dept, audit, who):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            reversal_id = (await _reverse(client, line, typo)).json()["amendment"]["id"]
        async with _client(db_session, dept[who]) as client:
            resp = await client.get(f"/finance/budgets/{line}/amendments")
        assert resp.status_code == 200
        rows = {r["id"]: r for r in resp.json()}
        assert len(rows) == 3

        reversal = rows[reversal_id]
        assert reversal["isReversal"] is True
        assert reversal["reversesAmendmentId"] == typo
        assert reversal["reversedByAmendmentId"] is None
        assert Decimal(reversal["amount"]) == Decimal("-2500.00")

        original = rows[typo]
        assert original["isReversal"] is False
        assert original["reversesAmendmentId"] is None
        assert original["reversedByAmendmentId"] == reversal_id
        assert original["reversedByName"] == "Treasurer Test"
        # Entered, not yet confirmed: the screen says so beside the link.
        assert original["reversalStatus"] == "pending"
        assert original["reversedAt"] is not None
        assert Decimal(original["amount"]) == Decimal("2500.00")

        untouched = rows[dept["first"]["active"]]
        assert untouched["isReversal"] is False
        assert untouched["reversedByAmendmentId"] is None
        assert untouched["reversedAt"] is None
        assert untouched["reversedByName"] is None

    async def test_the_reversal_is_listed_first(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            await _reverse(client, line, dept["first"]["active"])
            rows = (await client.get(f"/finance/budgets/{line}/amendments")).json()
        assert rows[0]["isReversal"] is True
        assert [r["isReversal"] for r in rows[1:]] == [False, False]

    async def test_a_negative_row_without_its_link_still_reads_as_a_reversal(
        self, db_session, dept
    ):
        """What a downgrade leaves: the amount stays, the link is gone."""
        line = dept["lines"]["active"]
        orphan = BudgetAmendment(
            organization_id=dept["org_id"],
            budget_id=line,
            amount=Decimal("-250.00"),
            reason="r",
            approved_by="Chief",
            approved_on=date(2026, 10, 8),
            status=BudgetAmendmentStatus.CONFIRMED,
        )
        db_session.add(orphan)
        await db_session.flush()
        async with _client(db_session, dept["treasurer"]) as client:
            rows = {
                r["id"]: r
                for r in (
                    await client.get(f"/finance/budgets/{line}/amendments")
                ).json()
            }
            again = await _reverse(client, line, orphan.id)
        assert rows[orphan.id]["isReversal"] is True
        assert again.status_code == 400


# ============================================
# Partial reversals (owner decision, 2026-11-01)
# ============================================


@pytest.mark.integration
class TestPartialReversal:
    async def test_corrects_the_amount_in_one_entry(self, db_session, dept, audit):
        """$2,500 entered for $250: one reversal of $2,250, not two entries."""
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            entered = await _reverse(client, line, typo, amount="2250.00")
        assert entered.status_code == 201, entered.text
        reversal = entered.json()["amendment"]
        assert Decimal(reversal["amount"]) == Decimal("-2250.00")
        assert reversal["reversesAmendmentId"] == typo
        confirmed = await _decide(
            db_session, dept["reviewer"], line, reversal["id"], "confirm"
        )
        assert confirmed.status_code == 200, confirmed.text
        budget = confirmed.json()["budget"]
        assert Decimal(budget["amountBudgeted"]) == Decimal("1300.00")
        assert Decimal(budget["originalAmount"]) == Decimal("800.00")
        assert Decimal(budget["amendmentsTotal"]) == Decimal("500.00")
        assert await _amount(db_session, line) == Decimal("1300.00")
        # The original keeps its amount; the list says how much was taken back.
        async with _client(db_session, dept["viewer"]) as client:
            rows = {
                r["id"]: r
                for r in (
                    await client.get(f"/finance/budgets/{line}/amendments")
                ).json()
            }
        assert Decimal(rows[typo]["amount"]) == Decimal("2500.00")
        assert Decimal(rows[typo]["reversedAmount"]) == Decimal("2250.00")
        assert rows[typo]["reversedByAmendmentId"] == reversal["id"]
        audited = audit.await_args_list[0].kwargs["event_data"]
        assert audited["amount"] == "-2250.00"

    async def test_left_out_the_amount_is_the_whole_amendment(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            entered = await _reverse(client, line, typo)
            rows = {
                r["id"]: r
                for r in (
                    await client.get(f"/finance/budgets/{line}/amendments")
                ).json()
            }
        assert Decimal(entered.json()["amendment"]["amount"]) == Decimal("-2500.00")
        assert Decimal(rows[typo]["reversedAmount"]) == Decimal("2500.00")

    async def test_more_than_the_amendment_is_refused(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(
                client, line, dept["typo"]["active"], amount="2500.01"
            )
        assert resp.status_code == 400
        assert "at most" in resp.json()["detail"]
        assert len(await _rows(db_session, line)) == 2

    async def test_a_partly_reversed_amendment_is_not_reversed_again(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            entered = await _reverse(client, line, typo, amount="100.00")
        assert Decimal(entered.json()["amendment"]["amount"]) == Decimal("-100.00")
        await _decide(
            db_session,
            dept["reviewer"],
            line,
            entered.json()["amendment"]["id"],
            "confirm",
        )
        async with _client(db_session, dept["treasurer"]) as client:
            again = await _reverse(client, line, typo, amount="100.00")
        assert again.status_code == 409

    async def test_the_spend_check_uses_the_partial_amount(
        self, db_session, dept, audit
    ):
        """3,550 budgeted, 100 spent: taking back 3,450 is allowed, 3,451 not."""
        line = dept["lines"]["active"]
        first = BudgetAmendment(
            organization_id=dept["org_id"],
            budget_id=line,
            amount=Decimal("5000.00"),
            reason="r",
            approved_by="Chief",
            approved_on=date(2026, 10, 8),
            status=BudgetAmendmentStatus.CONFIRMED,
        )
        db_session.add(first)
        await db_session.flush()
        async with _client(db_session, dept["treasurer"]) as client:
            short = await _reverse(client, line, first.id, amount="3450.01")
            exact = await _reverse(client, line, first.id, amount="3450.00")
        assert short.status_code == 409
        assert exact.status_code == 201, exact.text

    async def test_a_locked_year_still_refuses_a_partial_reversal(
        self, db_session, dept, audit
    ):
        async with _client(db_session, dept["treasurer"]) as client:
            resp = await _reverse(
                client,
                dept["lines"]["locked"],
                dept["typo"]["locked"],
                amount="2250.00",
            )
        assert resp.status_code == 400
        assert "locked" in resp.json()["detail"]


# ============================================
# A rejected reversal keeps naming its amendment (owner decision, 2026-11-01)
# ============================================


@pytest.mark.integration
class TestRejectedReversalKeepsItsReference:
    async def test_the_reference_survives_the_rejection(self, db_session, dept, audit):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            reversal_id = (await _reverse(client, line, typo)).json()["amendment"]["id"]
        rejected = await _decide(
            db_session,
            dept["reviewer"],
            line,
            reversal_id,
            "reject",
            {"note": "Wrong line"},
        )
        assert rejected.status_code == 200, rejected.text
        row = rejected.json()["amendment"]
        # The link that holds the unique key is freed...
        assert row["reversesAmendmentId"] is None
        # ...and the display reference still names the amendment.
        assert row["reversesAmendmentRef"] == typo
        async with _client(db_session, dept["owner"]) as client:
            rows = {
                r["id"]: r
                for r in (
                    await client.get(f"/finance/budgets/{line}/amendments")
                ).json()
            }
        assert rows[reversal_id]["reversesAmendmentRef"] == typo
        assert rows[typo]["reversedByAmendmentId"] is None
        # The audit event takes the pair from the reference.
        rejected_event = audit.await_args_list[-1].kwargs["event_data"]
        assert rejected_event["reversed_amendment_id"] == typo

    async def test_the_reference_does_not_hold_the_amendment(
        self, db_session, dept, audit
    ):
        line = dept["lines"]["active"]
        typo = dept["typo"]["active"]
        async with _client(db_session, dept["treasurer"]) as client:
            first = (await _reverse(client, line, typo)).json()["amendment"]["id"]
        await _decide(
            db_session, dept["reviewer"], line, first, "reject", {"note": "No"}
        )
        entered, _ = await _reverse_and_confirm(db_session, dept, line, typo)
        second = entered.json()["amendment"]["id"]
        rows = {r.id: r for r in await _rows(db_session, line)}
        assert rows[first].reverses_amendment_ref == typo
        assert rows[second].reverses_amendment_ref == typo
        assert rows[second].reverses_amendment_id == typo

    async def test_an_ordinary_amendment_has_no_reference(
        self, db_session, dept, audit
    ):
        async with _client(db_session, dept["viewer"]) as client:
            rows = (
                await client.get(
                    f"/finance/budgets/{dept['lines']['active']}/amendments"
                )
            ).json()
        assert all(r["reversesAmendmentRef"] is None for r in rows)
