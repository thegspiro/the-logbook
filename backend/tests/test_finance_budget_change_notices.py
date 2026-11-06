"""Who is told when a budget line's money changes hands, and the pending queue.

Owner decisions of 2026-11-01:

* **Email + pending queue.** An amendment or a reversal entered pending is
  emailed to every active member who may confirm it -- a
  ``finance.budget_review`` or ``finance.manage`` holder, wildcards included
  -- other than whoever entered it, inside the department only, under the
  optional *Treasurer duties* email kind. ``GET
  /finance/budget-amendments/pending`` lists every pending one across the
  department's lines in one place, for the same people.
* **Email owners on change.** When leadership changes a request's amount in
  leadership review, the line's owners -- the holders of its owner position
  and the request's submitter -- are emailed, never the reviewer, under the
  optional *Next year's budget requests* kind. Saving the amount the owner
  already had sends nothing.

Both are email only (CLAUDE.md pitfall #18), never fail the action, and are
idempotent: each send is recorded in the email sent-log, and a second call
for the same amendment, or the same review, sends nothing again (#36).
"""

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    Budget,
    BudgetAmendment,
    BudgetAmendmentStatus,
    BudgetCategory,
    FiscalYearStatus,
)
from app.models.notification import NotificationLog
from app.services import finance_budget_change_notifications as change_notices
from tests.test_finance_budget_owners import (
    _client,
    _org,
    _position,
    _station,
    _user,
    _year,
)
from tests.test_finance_budget_request_notices import _Mailer


@pytest.fixture
def mailer(monkeypatch):
    recorder = _Mailer()
    monkeypatch.setattr(
        "app.services.email_service.EmailService", recorder.factory, raising=True
    )
    return recorder


@pytest.fixture
def _no_audit(monkeypatch):
    from app.api.v1.endpoints import finance as finance_endpoints

    monkeypatch.setattr(finance_endpoints, "log_audit_event", AsyncMock())


@pytest.fixture
async def dept(db_session: AsyncSession, _no_audit):
    org_id = await _org(db_session, "changes")
    other_org = await _org(db_session, "changes-other")

    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    president_pos = await _position(
        db_session, org_id, "President", ["finance.request", "finance.budget_review"]
    )
    admin_pos = await _position(db_session, org_id, "IT Manager", ["*"])
    viewer_pos = await _position(db_session, org_id, "Viewer", ["finance.view"])
    training_pos = await _position(db_session, org_id, "Training Officer", [])
    their_treasurer_pos = await _position(
        db_session, other_org, "Their Treasurer", ["finance.view", "finance.manage"]
    )

    people = {
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "president": await _user(db_session, org_id, "president", [president_pos]),
        "it": await _user(db_session, org_id, "itmanager", [admin_pos]),
        "old_president": await _user(
            db_session, org_id, "oldpresident", [president_pos], status="inactive"
        ),
        "viewer": await _user(db_session, org_id, "viewer", [viewer_pos]),
        "trainer": await _user(db_session, org_id, "trainer", [training_pos]),
        "co_trainer": await _user(db_session, org_id, "cotrainer", [training_pos]),
        "their_treasurer": await _user(
            db_session, other_org, "theirtreasurer", [their_treasurer_pos]
        ),
    }
    treasurer_id = people["treasurer"].id

    active = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026)
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027)
    their_active = _year(
        other_org, "Their FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026
    )
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    training = BudgetCategory(
        organization_id=org_id, name="Training", owner_position_id=training_pos
    )
    their_gear = BudgetCategory(organization_id=other_org, name="Their Gear")
    db_session.add_all([active, draft, their_active, gear, training, their_gear])
    await db_session.flush()
    station = await _station(db_session, org_id, "Station 2")

    lines = {
        "gear": Budget(
            organization_id=org_id,
            fiscal_year_id=active.id,
            category_id=gear.id,
            station_id=station,
            amount_budgeted=Decimal("3550.00"),
            created_by=treasurer_id,
        ),
        "training": Budget(
            organization_id=org_id,
            fiscal_year_id=active.id,
            category_id=training.id,
            amount_budgeted=Decimal("1000.00"),
            created_by=treasurer_id,
        ),
        "training_next": Budget(
            organization_id=org_id,
            fiscal_year_id=draft.id,
            category_id=training.id,
            amount_budgeted=Decimal("0.00"),
            created_by=treasurer_id,
        ),
        "theirs": Budget(
            organization_id=other_org,
            fiscal_year_id=their_active.id,
            category_id=their_gear.id,
            amount_budgeted=Decimal("500.00"),
            created_by=treasurer_id,
        ),
    }
    db_session.add_all(lines.values())
    await db_session.flush()
    confirmed = BudgetAmendment(
        organization_id=org_id,
        budget_id=lines["gear"].id,
        amount=Decimal("2500.00"),
        reason="Gloves",
        approved_by="Board vote 10/7",
        approved_on=date(2026, 10, 7),
        created_by=treasurer_id,
        status=BudgetAmendmentStatus.CONFIRMED,
    )
    db_session.add(confirmed)
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "draft": draft.id,
        "lines": {k: v.id for k, v in lines.items()},
        "confirmed": confirmed.id,
        **people,
    }


_AMENDMENT = {
    "amount": "400.00",
    "reason": "New hose",
    "approvedBy": "Board vote 11/2",
    "approvedOn": "2026-11-02",
}
_REVERSAL = {
    "reason": "Entered $2,500 for $250",
    "approvedBy": "Chief concurs",
    "approvedOn": "2026-11-02",
}


async def _post(db, user, path, body=None):
    async with _client(db, user) as client:
        return await client.post(path, json=body)


async def _get(db, user, path):
    async with _client(db, user) as client:
        return await client.get(path)


async def _amend(db, dept, line="gear", user="treasurer", **overrides):
    resp = await _post(
        db,
        dept[user],
        f"/finance/budgets/{dept['lines'][line]}/amendments",
        {**_AMENDMENT, **overrides},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["amendment"]["id"]


def _emails(dept, *names) -> set[str]:
    return {dept[name].email for name in names}


# ============================================
# An amendment waiting -> the officers who may confirm it
# ============================================


@pytest.mark.integration
class TestAmendmentPendingEmail:
    async def test_every_confirmer_but_the_one_who_entered_it(
        self, db_session, dept, mailer
    ):
        await _amend(db_session, dept)
        # The President (budget_review) and the IT Manager (*), not the
        # Treasurer who entered it, the viewer, the inactive President, or
        # another department's Treasurer.
        assert mailer.to("Budget amendment to confirm") == _emails(
            dept, "president", "it"
        )

    async def test_says_what_how_much_and_links_to_the_queue(
        self, db_session, dept, mailer
    ):
        await _amend(db_session, dept, reason="Hose <script>")
        (send,) = [s for s in mailer.sends if "amendment" in s["subject"]]
        assert (
            send["subject"]
            == "Budget amendment to confirm: Gear · Station 2 (+$400.00)"
        )
        assert "/finance/budget-amendments" in send["html"]
        assert "Board vote 11/2" in send["html"]
        assert "&lt;script&gt;" in send["html"]
        assert "<script>" not in send["html"]
        assert "/finance/budget-amendments" in send["text"]

    async def test_a_reversal_is_announced_too(self, db_session, dept, mailer):
        resp = await _post(
            db_session,
            dept["treasurer"],
            f"/finance/budgets/{dept['lines']['gear']}/amendments/"
            f"{dept['confirmed']}/reverse",
            {**_REVERSAL, "amount": "2250.00"},
        )
        assert resp.status_code == 201, resp.text
        assert mailer.to("Budget reversal to confirm") == _emails(
            dept, "president", "it"
        )
        (send,) = mailer.sends
        assert "-$2,250.00" in send["subject"]

    async def test_an_opted_out_officer_is_left_out(self, db_session, dept, mailer):
        dept["it"].notification_preferences = {"email_kinds": {"finance_duties": False}}
        await db_session.flush()
        await _amend(db_session, dept)
        assert mailer.to("Budget amendment to confirm") == _emails(dept, "president")

    async def test_a_second_call_for_the_same_amendment_sends_nothing(
        self, db_session, dept, mailer
    ):
        amendment_id = await _amend(db_session, dept)
        assert len(mailer.sends) == 1
        again = await change_notices.notify_amendment_pending(
            db_session, dept["org_id"], amendment_id, dept["treasurer"].id
        )
        assert again == 0
        assert len(mailer.sends) == 1
        logged = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == dept["org_id"],
                        NotificationLog.category
                        == change_notices.AMENDMENT_PENDING_LOG_CATEGORY,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {log.recipient_id for log in logged} == {
            dept["president"].id,
            dept["it"].id,
        }
        assert all(
            log.notification_metadata["amendment_id"] == amendment_id for log in logged
        )

    async def test_an_amendment_already_decided_sends_nothing(
        self, db_session, dept, mailer
    ):
        sent = await change_notices.notify_amendment_pending(
            db_session, dept["org_id"], dept["confirmed"], dept["treasurer"].id
        )
        assert sent == 0
        assert mailer.sends == []

    async def test_another_departments_amendment_names_nobody(
        self, db_session, dept, mailer
    ):
        sent = await change_notices.notify_amendment_pending(
            db_session, dept["other_org"], dept["confirmed"], dept["treasurer"].id
        )
        assert sent == 0
        assert mailer.sends == []

    async def test_a_failing_mailer_does_not_fail_the_entry(
        self, db_session, dept, mailer
    ):
        mailer.raise_on_send = True
        await _amend(db_session, dept)


# ============================================
# The pending queue
# ============================================


@pytest.mark.integration
class TestPendingQueue:
    async def test_lists_every_pending_amendment_across_lines(
        self, db_session, dept, mailer
    ):
        first = await _amend(db_session, dept)
        second = await _amend(db_session, dept, line="training", amount="75.00")
        reversal = await _post(
            db_session,
            dept["treasurer"],
            f"/finance/budgets/{dept['lines']['gear']}/amendments/"
            f"{dept['confirmed']}/reverse",
            {**_REVERSAL, "amount": "2250.00"},
        )
        assert reversal.status_code == 201, reversal.text
        reversal_id = reversal.json()["amendment"]["id"]

        resp = await _get(
            db_session, dept["president"], "/finance/budget-amendments/pending"
        )
        assert resp.status_code == 200, resp.text
        rows = {r["id"]: r for r in resp.json()}
        assert set(rows) == {first, second, reversal_id}
        gear = rows[first]
        assert gear["budgetId"] == dept["lines"]["gear"]
        assert gear["categoryName"] == "Gear"
        assert gear["stationName"] == "Station 2"
        assert gear["fiscalYearName"] == "FY2026"
        assert gear["yearLocked"] is False
        assert Decimal(gear["amount"]) == Decimal("400.00")
        assert gear["enteredByName"]
        assert gear["status"] == "pending"
        assert rows[second]["categoryName"] == "Training"
        assert rows[second]["stationName"] is None
        rev = rows[reversal_id]
        assert rev["isReversal"] is True
        assert rev["reversesAmendmentRef"] == dept["confirmed"]
        assert Decimal(rev["reversedAmendmentAmount"]) == Decimal("2500.00")
        assert rev["reversedAmendmentApprovedOn"] == "2026-10-07"

    async def test_decided_ones_leave_the_queue(self, db_session, dept, mailer):
        amendment_id = await _amend(db_session, dept)
        confirm = await _post(
            db_session,
            dept["president"],
            f"/finance/budgets/{dept['lines']['gear']}/amendments/"
            f"{amendment_id}/confirm",
        )
        assert confirm.status_code == 200, confirm.text
        resp = await _get(
            db_session, dept["treasurer"], "/finance/budget-amendments/pending"
        )
        assert resp.json() == []

    async def test_another_departments_are_not_listed(self, db_session, dept, mailer):
        await _amend(db_session, dept)
        resp = await _get(
            db_session, dept["their_treasurer"], "/finance/budget-amendments/pending"
        )
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.parametrize("who", ["viewer", "trainer"])
    async def test_only_those_who_may_confirm_read_it(
        self, db_session, dept, mailer, who
    ):
        resp = await _get(db_session, dept[who], "/finance/budget-amendments/pending")
        assert resp.status_code == 403


# ============================================
# Leadership changes an owner's amount -> the owners
# ============================================


async def _approved_request(db, dept, amount="2400.00") -> str:
    created = await _post(
        db,
        dept["trainer"],
        "/finance/budget-requests",
        {
            "fiscalYearId": dept["draft"],
            "budgetId": dept["lines"]["training_next"],
            "requestedAmount": amount,
            "justification": "Two more academy seats",
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    for user, path, body in (
        ("trainer", f"/finance/budget-requests/{request_id}/submit", None),
        (
            "treasurer",
            f"/finance/budget-requests/{request_id}/decide",
            {"decision": "approve"},
        ),
        (
            "treasurer",
            f"/finance/fiscal-years/{dept['draft']}/planning-stage",
            {"stage": "leadership_review"},
        ),
    ):
        resp = await _post(db, dept[user], path, body)
        assert resp.status_code == 200, resp.text
    return request_id


async def _review(db, dept, request_id, amount="2000.00", note="Chief's <priorities>"):
    return await _post(
        db,
        dept["president"],
        f"/finance/budget-requests/{request_id}/review",
        {"amount": amount, "note": note},
    )


@pytest.mark.integration
class TestLeadershipChangeEmail:
    async def test_the_owners_are_told_not_the_reviewer(self, db_session, dept, mailer):
        request_id = await _approved_request(db_session, dept)
        mailer.sends.clear()
        resp = await _review(db_session, dept, request_id)
        assert resp.status_code == 200, resp.text
        # The submitter and the other holder of the owning position.
        assert mailer.to("Leadership changed a budget request") == _emails(
            dept, "trainer", "co_trainer"
        )
        (send,) = mailer.sends
        assert "$2,400.00" in send["html"]
        assert "$2,000.00" in send["html"]
        assert "Chief&#x27;s &lt;priorities&gt;" in send["html"]
        assert "/finance/budget-requests" in send["text"]

    async def test_the_same_amount_again_sends_nothing(self, db_session, dept, mailer):
        request_id = await _approved_request(db_session, dept)
        same = await _review(db_session, dept, request_id, amount="2400.00")
        assert same.status_code == 200, same.text
        assert mailer.to("Leadership changed a budget request") == set()

        first = await _review(db_session, dept, request_id, amount="2000.00")
        assert first.status_code == 200
        mailer.sends.clear()
        again = await _review(db_session, dept, request_id, amount="2000.00")
        assert again.status_code == 200
        assert mailer.sends == []

    async def test_a_second_call_for_the_same_review_sends_nothing(
        self, db_session, dept, mailer
    ):
        request_id = await _approved_request(db_session, dept)
        mailer.sends.clear()
        await _review(db_session, dept, request_id)
        sends = len(mailer.sends)
        assert sends == 1
        again = await change_notices.notify_leadership_change(
            db_session,
            dept["org_id"],
            request_id,
            dept["president"].id,
            previous_amount=Decimal("2400.00"),
        )
        assert again == 0
        assert len(mailer.sends) == sends

    async def test_an_opted_out_owner_is_left_out(self, db_session, dept, mailer):
        dept["co_trainer"].notification_preferences = {
            "email_kinds": {"budget_requests": False}
        }
        await db_session.flush()
        request_id = await _approved_request(db_session, dept)
        mailer.sends.clear()
        await _review(db_session, dept, request_id)
        assert mailer.to("Leadership changed a budget request") == _emails(
            dept, "trainer"
        )

    async def test_a_failing_mailer_does_not_fail_the_review(
        self, db_session, dept, mailer
    ):
        request_id = await _approved_request(db_session, dept)
        mailer.raise_on_send = True
        resp = await _review(db_session, dept, request_id)
        assert resp.status_code == 200, resp.text
