"""Planning next year: start from last year, the request deadline, requests.

Owner decisions (2026-10-08): a line is owned by a position (its own, else
its category's — ``finance_budget_ownership``); owners propose next year's
amounts for a **draft** fiscal year; the Treasurer (``finance.manage``)
approves as asked, adjusts with a note, or declines; the Treasurer sets a
request deadline per draft year.

Pinned here:

* ``requests_open`` — draft and unlocked, and today (the org's) on or before
  the deadline — including the department-timezone day boundary;
* "Start from last year" copies category, station, the line's own owner and
  notes, carries the current budget forward, starts spent at zero, skips a
  category and station already in the draft (a re-run copies nothing), takes
  only a draft target, and is 404 for another department's year; audited;
* the deadline is set and cleared only on a draft year, is reported on the
  fiscal-year responses, and closes requests to owners but not to the
  Treasurer;
* requests: an owner via the line's own owner and via category inheritance,
  a proposed new line for a held position, non-holders refused, foreign keys
  from another department refused, one live request per line (409), the
  draft/submitted/withdraw/delete transitions, the three decisions and their
  note rules, an approval writing the line (or creating it for a proposal),
  re-deciding while draft and not once active, own-only visibility (404),
  ``my-lines``, and the active year's comparison figures.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import finance as finance_endpoints
from app.models.finance import (
    Budget,
    BudgetAmendment,
    BudgetCategory,
    FiscalYear,
    FiscalYearStatus,
)
from app.services.finance_budget_request_service import (
    FinanceBudgetRequestService,
    requests_open,
)
from tests.test_finance_budget_owners import (
    _client,
    _org,
    _position,
    _station,
    _user,
    _year,
)

# ============================================
# The rule itself, no database
# ============================================


@pytest.mark.unit
class TestRequestsOpenRule:
    today = date(2026, 10, 8)

    def test_a_draft_year_without_a_deadline_is_open(self):
        assert requests_open(FiscalYearStatus.DRAFT, False, None, self.today)

    def test_the_deadline_day_itself_is_still_open(self):
        assert requests_open("draft", False, self.today, self.today)

    def test_the_day_after_the_deadline_is_closed(self):
        assert not requests_open(
            "draft", False, self.today - timedelta(days=1), self.today
        )

    def test_active_closed_and_locked_years_are_never_open(self):
        assert not requests_open("active", False, None, self.today)
        assert not requests_open(FiscalYearStatus.CLOSED, False, None, self.today)
        assert not requests_open("draft", True, None, self.today)


# ============================================
# Fixtures
# ============================================


async def _org_in(db: AsyncSession, label: str, tz: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"{label} Dept",
            "slug": f"{label}-{org_id[:8]}",
            "tz": tz,
        },
    )
    return org_id


@pytest.fixture
def audit(monkeypatch):
    recorder = AsyncMock()
    monkeypatch.setattr(finance_endpoints, "log_audit_event", recorder)
    return recorder


def _audited(audit) -> list:
    return [call.kwargs["event_type"] for call in audit.await_args_list]


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "plan")
    other_org = await _org(db_session, "else")

    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    training_officer = await _position(
        db_session, org_id, "Training Officer", ["finance.request"]
    )
    chief = await _position(db_session, org_id, "Chief", ["finance.request"])
    firefighter = await _position(
        db_session, org_id, "Firefighter", ["finance.request"]
    )
    foreign_pos = await _position(db_session, other_org, "Their Chief", [])
    foreign_admin = await _position(
        db_session, other_org, "Their Treasurer", ["finance.*"]
    )

    people = {
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "trainer": await _user(db_session, org_id, "trainer", [training_officer]),
        "chief": await _user(db_session, org_id, "chief", [chief]),
        "member": await _user(db_session, org_id, "alice", [firefighter]),
        "outsider_admin": await _user(
            db_session, other_org, "their-treasurer", [foreign_admin]
        ),
    }
    treasurer_id = people["treasurer"].id

    active = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026)
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027)
    empty_draft = _year(org_id, "FY2028", FiscalYearStatus.DRAFT, treasurer_id, 2028)
    closed = _year(org_id, "FY2025", FiscalYearStatus.CLOSED, treasurer_id, 2025)
    foreign_year = _year(
        other_org, "Their FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027
    )
    training = BudgetCategory(
        organization_id=org_id, name="Training", owner_position_id=training_officer
    )
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    foreign_category = BudgetCategory(organization_id=other_org, name="Theirs")
    db_session.add_all(
        [active, draft, empty_draft, closed, foreign_year]
        + [training, gear, foreign_category]
    )
    await db_session.flush()
    station = await _station(db_session, org_id, "Station 2")
    foreign_station = await _station(db_session, other_org, "Their Station")

    def line(fy, category, amount, org=org_id, **kw):
        return Budget(
            organization_id=org,
            fiscal_year_id=fy.id,
            category_id=category.id,
            amount_budgeted=Decimal(amount),
            created_by=treasurer_id,
            **kw,
        )

    lines = {
        # This year (active): what next year's requests are compared with.
        "training": line(
            active,
            training,
            "2000.00",
            amount_spent=Decimal("500.00"),
            amount_encumbered=Decimal("100.00"),
            notes="Fire academy seats",
        ),
        "training_chief": line(
            active,
            training,
            "300.00",
            owner_position_id=chief,
            station_id=station,
            notes="Officer school",
        ),
        "gear": line(active, gear, "5000.00", amount_spent=Decimal("1200.00")),
        # Next year (draft): the lines requests are made against.
        "training_next": line(draft, training, "0.00"),
        "chief_next": line(draft, training, "0.00", owner_position_id=chief),
        "gear_next": line(draft, gear, "0.00"),
        # The second draft already has gear; start-from must skip it.
        "gear_2028": line(empty_draft, gear, "100.00"),
        "foreign": line(foreign_year, foreign_category, "10.00", org=other_org),
    }
    # chief_next is Training at Station 2, so its "this year" is
    # training_chief; give it the station.
    lines["chief_next"].station_id = station
    db_session.add_all(lines.values())
    await db_session.flush()
    # The gear line was amended up to 5000: the copy carries the current
    # budget, the amendment itself stays behind.
    db_session.add(
        BudgetAmendment(
            organization_id=org_id,
            budget_id=lines["gear"].id,
            amount=Decimal("1000.00"),
            reason="Turnout gear",
            approved_by="Board",
            approved_on=date(2026, 3, 1),
            created_by=treasurer_id,
        )
    )
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "active": active.id,
        "draft": draft.id,
        "empty_draft": empty_draft.id,
        "closed": closed.id,
        "foreign_year": foreign_year.id,
        "training_cat": training.id,
        "gear_cat": gear.id,
        "foreign_cat": foreign_category.id,
        "station": station,
        "foreign_station": foreign_station,
        "chief_pos": chief,
        "training_pos": training_officer,
        "foreign_pos": foreign_pos,
        "lines": {k: v.id for k, v in lines.items()},
        **people,
    }


async def _call(db, user, method, path, json=None):
    async with _client(db, user) as client:
        return await client.request(method, path, json=json)


async def _create(db, user, body):
    return await _call(db, user, "POST", "/finance/budget-requests", body)


def _line_body(dept, line, amount="2400.00", **extra):
    return {
        "fiscalYearId": dept["draft"],
        "budgetId": dept["lines"][line],
        "requestedAmount": amount,
        "justification": "Two more academy seats",
        **extra,
    }


async def _submitted(db, dept, user="trainer", line="training_next", amount="2400.00"):
    created = await _create(db, dept[user], _line_body(dept, line, amount))
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    resp = await _call(
        db, dept[user], "POST", f"/finance/budget-requests/{request_id}/submit"
    )
    assert resp.status_code == 200, resp.text
    return request_id


async def _set_deadline(db, dept, deadline):
    resp = await _call(
        db,
        dept["treasurer"],
        "PUT",
        f"/finance/fiscal-years/{dept['draft']}",
        {"requestDeadline": deadline.isoformat() if deadline else None},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _line(db, line_id) -> Budget:
    result = await db.execute(select(Budget).where(Budget.id == line_id))
    line = result.scalar_one()
    await db.refresh(line)
    return line


# ============================================
# Start from last year
# ============================================


@pytest.mark.integration
class TestStartFromLastYear:
    async def test_copies_lines_and_skips_what_is_there(self, db_session, dept, audit):
        target = dept["empty_draft"]
        resp = await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"/finance/fiscal-years/{target}/start-from/{dept['active']}",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"created": 2, "skipped": 1}
        assert _audited(audit) == ["finance.fiscal_year_started_from"]

        result = await db_session.execute(
            select(Budget).where(Budget.fiscal_year_id == target)
        )
        copies = {(b.category_id, b.station_id): b for b in result.scalars().all()}
        assert len(copies) == 3
        inherited = copies[(dept["training_cat"], None)]
        # The category's owner reaches the copy through the category; only a
        # line's own owner is copied onto the line.
        assert inherited.owner_position_id is None
        assert inherited.amount_budgeted == Decimal("2000.00")
        assert inherited.amount_spent == Decimal("0")
        assert inherited.amount_encumbered == Decimal("0")
        assert inherited.notes == "Fire academy seats"
        own = copies[(dept["training_cat"], dept["station"])]
        assert own.owner_position_id == dept["chief_pos"]
        assert own.amount_budgeted == Decimal("300.00")
        assert own.notes == "Officer school"
        # Skipped, untouched: the draft's own gear line keeps its amount.
        assert copies[(dept["gear_cat"], None)].amount_budgeted == Decimal("100.00")
        amendments = await db_session.execute(
            select(BudgetAmendment).where(
                BudgetAmendment.budget_id.in_([b.id for b in copies.values()])
            )
        )
        assert amendments.scalars().all() == []

    async def test_the_amended_amount_is_carried_forward(self, db_session, dept):
        target = dept["empty_draft"]
        gear_2028 = await db_session.get(Budget, dept["lines"]["gear_2028"])
        await db_session.delete(gear_2028)
        await db_session.flush()
        resp = await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"/finance/fiscal-years/{target}/start-from/{dept['active']}",
        )
        assert resp.json() == {"created": 3, "skipped": 0}
        result = await db_session.execute(
            select(Budget).where(
                Budget.fiscal_year_id == target,
                Budget.category_id == dept["gear_cat"],
            )
        )
        assert result.scalar_one().amount_budgeted == Decimal("5000.00")

    async def test_a_second_run_copies_nothing(self, db_session, dept):
        path = (
            f"/finance/fiscal-years/{dept['empty_draft']}/start-from/{dept['active']}"
        )
        await _call(db_session, dept["treasurer"], "POST", path)
        again = await _call(db_session, dept["treasurer"], "POST", path)
        assert again.status_code == 200
        assert again.json() == {"created": 0, "skipped": 3}

    async def test_only_into_a_draft_year(self, db_session, dept):
        resp = await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"/finance/fiscal-years/{dept['active']}/start-from/{dept['closed']}",
        )
        assert resp.status_code == 400
        assert "draft" in resp.json()["detail"]

    async def test_not_from_itself(self, db_session, dept):
        path = f"/finance/fiscal-years/{dept['draft']}/start-from/{dept['draft']}"
        resp = await _call(db_session, dept["treasurer"], "POST", path)
        assert resp.status_code == 400

    async def test_another_departments_year_is_404(self, db_session, dept, audit):
        for path in (
            f"/finance/fiscal-years/{dept['empty_draft']}/start-from/"
            f"{dept['foreign_year']}",
            f"/finance/fiscal-years/{dept['foreign_year']}/start-from/"
            f"{dept['active']}",
        ):
            resp = await _call(db_session, dept["treasurer"], "POST", path)
            assert resp.status_code == 404, path
        audit.assert_not_called()

    async def test_needs_finance_manage(self, db_session, dept):
        path = (
            f"/finance/fiscal-years/{dept['empty_draft']}/start-from/{dept['active']}"
        )
        resp = await _call(db_session, dept["trainer"], "POST", path)
        assert resp.status_code == 403


# ============================================
# The request deadline
# ============================================


@pytest.mark.integration
class TestRequestDeadline:
    async def test_set_and_clear_on_a_draft_year(self, db_session, dept, audit):
        body = await _set_deadline(db_session, dept, date(2099, 11, 1))
        assert body["requestDeadline"] == "2099-11-01"
        assert body["requestsOpen"] is True
        cleared = await _set_deadline(db_session, dept, None)
        assert cleared["requestDeadline"] is None
        assert cleared["requestsOpen"] is True
        assert _audited(audit) == ["finance.fiscal_year_request_deadline_set"] * 2

    async def test_a_passed_deadline_closes_requests(self, db_session, dept):
        await _set_deadline(db_session, dept, date(2020, 1, 1))
        years = await _call(
            db_session, dept["treasurer"], "GET", "/finance/fiscal-years"
        )
        by_id = {y["id"]: y for y in years.json()}
        assert by_id[dept["draft"]]["requestsOpen"] is False
        assert by_id[dept["empty_draft"]]["requestsOpen"] is True
        assert by_id[dept["active"]]["requestsOpen"] is False
        options = await _call(
            db_session, dept["member"], "GET", "/finance/fiscal-years/options"
        )
        option = next(o for o in options.json() if o["id"] == dept["draft"])
        assert option["requestDeadline"] == "2020-01-01"
        assert option["requestsOpen"] is False

    async def test_only_a_draft_year_takes_a_deadline(self, db_session, dept):
        path = f"/finance/fiscal-years/{dept['active']}"
        resp = await _call(
            db_session,
            dept["treasurer"],
            "PUT",
            path,
            {"requestDeadline": "2026-12-01"},
        )
        assert resp.status_code == 400
        assert "draft" in resp.json()["detail"]
        # Sending the unchanged (empty) value with an edit is not a change.
        ok = await _call(
            db_session,
            dept["treasurer"],
            "PUT",
            path,
            {"name": "FY2026 (current)", "requestDeadline": None},
        )
        assert ok.status_code == 200, ok.text

    async def test_the_deadline_is_read_on_the_departments_calendar(self, db_session):
        # Pago Pago (UTC-11) and Kiritimati (UTC+14) are always on different
        # calendar days, so a deadline of Pago Pago's today is open there and
        # passed in Kiritimati. Whatever the UTC date, one of the two answers
        # differs from what a UTC "today" would give.
        west = await _org_in(db_session, "west", "Pacific/Pago_Pago")
        east = await _org_in(db_session, "east", "Pacific/Kiritimati")
        deadline = datetime.now(ZoneInfo("Pacific/Pago_Pago")).date()
        service = FinanceBudgetRequestService(db_session)
        for org_id, expected in ((west, True), (east, False)):
            fy = FiscalYear(
                organization_id=org_id,
                name="Next",
                start_date=datetime(2027, 1, 1),
                end_date=datetime(2027, 12, 31),
                status=FiscalYearStatus.DRAFT,
                request_deadline=deadline,
                created_by=str(uuid.uuid4()),
            )
            (row,) = await service.fiscal_year_rows([fy], org_id)
            assert row["requests_open"] is expected, org_id

    async def test_owners_are_closed_out_the_treasurer_is_not(self, db_session, dept):
        await _set_deadline(db_session, dept, date(2020, 1, 1))
        refused = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        assert refused.status_code == 400
        assert refused.json()["detail"] == "The request deadline for FY2027 has passed."
        made = await _create(
            db_session, dept["treasurer"], _line_body(dept, "training_next")
        )
        assert made.status_code == 201, made.text

    async def test_the_deadline_day_is_still_open(self, db_session, dept):
        # The fixture's department keeps UTC, so its today is UTC's.
        await _set_deadline(db_session, dept, datetime.now(timezone.utc).date())
        made = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        assert made.status_code == 201, made.text

    async def test_owner_changes_close_with_the_deadline(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        await _set_deadline(db_session, dept, date(2020, 1, 1))
        path = f"/finance/budget-requests/{request_id}"
        for method, suffix, body in (
            ("PUT", "", {"requestedAmount": "1.00"}),
            ("POST", "/withdraw", None),
        ):
            resp = await _call(db_session, dept["trainer"], method, path + suffix, body)
            assert resp.status_code == 400
            assert "deadline" in resp.json()["detail"]
        manager = await _call(
            db_session, dept["treasurer"], "PUT", path, {"requestedAmount": "1.00"}
        )
        assert manager.status_code == 200


# ============================================
# Making a request
# ============================================


@pytest.mark.integration
class TestMakingARequest:
    async def test_the_category_owner_requests_for_an_inherited_line(
        self, db_session, dept, audit
    ):
        resp = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "draft"
        assert body["lineLabel"] == "Training"
        assert body["isProposedLine"] is False
        assert body["ownerPositionName"] == "Training Officer"
        assert Decimal(body["requestedAmount"]) == Decimal("2400.00")
        assert body["fiscalYearName"] == "FY2027"
        # "This year", seen from the draft: the active FY2026 Training line.
        assert body["lastYearFiscalYearName"] == "FY2026"
        assert Decimal(body["lastYearBudgeted"]) == Decimal("2000.00")
        assert Decimal(body["lastYearSpent"]) == Decimal("500.00")
        assert _audited(audit) == ["finance.budget_request_created"]

    async def test_a_lines_own_owner_overrides_the_category(self, db_session, dept):
        resp = await _create(
            db_session, dept["chief"], _line_body(dept, "chief_next", "350.00")
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["lineLabel"] == "Training · Station 2"
        assert body["ownerPositionName"] == "Chief"
        assert Decimal(body["lastYearBudgeted"]) == Decimal("300.00")
        refused = await _create(
            db_session, dept["trainer"], _line_body(dept, "chief_next")
        )
        assert refused.status_code == 403

    async def test_a_non_owner_is_refused(self, db_session, dept):
        resp = await _create(
            db_session, dept["member"], _line_body(dept, "training_next")
        )
        assert resp.status_code == 403

    async def test_a_line_with_no_last_year_has_no_comparison(self, db_session, dept):
        resp = await _create(
            db_session, dept["treasurer"], _line_body(dept, "gear_next")
        )
        body = resp.json()
        # Gear with no station exists this year: 5000 budgeted, 1200 spent.
        assert Decimal(body["lastYearBudgeted"]) == Decimal("5000.00")
        proposal = await _create(
            db_session,
            dept["treasurer"],
            {
                "fiscalYearId": dept["draft"],
                "categoryId": dept["gear_cat"],
                "stationId": dept["station"],
                "requestedAmount": "10.00",
                "justification": "New station kit",
            },
        )
        assert proposal.status_code == 201, proposal.text
        assert proposal.json()["lastYearBudgeted"] is None
        assert proposal.json()["lastYearSpent"] is None

    async def test_propose_a_new_line_for_a_held_position(self, db_session, dept):
        body = {
            "fiscalYearId": dept["draft"],
            "categoryId": dept["gear_cat"],
            "stationId": dept["station"],
            "ownerPositionId": dept["chief_pos"],
            "requestedAmount": "800.00",
            "justification": "Station 2 needs its own gear line",
        }
        resp = await _create(db_session, dept["chief"], body)
        assert resp.status_code == 201, resp.text
        made = resp.json()
        assert made["isProposedLine"] is True
        assert made["budgetId"] is None
        assert made["lineLabel"] == "Gear · Station 2"
        assert made["ownerPositionName"] == "Chief"
        # Somebody who does not hold the position cannot propose for it.
        refused = await _create(db_session, dept["member"], body)
        assert refused.status_code == 403
        # Nor without naming one.
        unnamed = await _create(
            db_session,
            dept["member"],
            {**body, "ownerPositionId": None, "stationId": None},
        )
        assert unnamed.status_code == 400

    async def test_a_proposal_for_an_existing_line_is_refused(self, db_session, dept):
        resp = await _create(
            db_session,
            dept["treasurer"],
            {
                "fiscalYearId": dept["draft"],
                "categoryId": dept["gear_cat"],
                "requestedAmount": "1.00",
                "justification": "Gear",
            },
        )
        assert resp.status_code == 409

    @pytest.mark.parametrize(
        "override",
        [
            {"categoryId": "foreign_cat"},
            {"stationId": "foreign_station"},
            {"ownerPositionId": "foreign_pos"},
            {"fiscalYearId": "foreign_year"},
        ],
    )
    async def test_another_departments_keys_are_refused(
        self, db_session, dept, override
    ):
        body = {
            "fiscalYearId": dept["draft"],
            "categoryId": dept["training_cat"],
            "stationId": dept["station"],
            "ownerPositionId": dept["chief_pos"],
            "requestedAmount": "1.00",
            "justification": "x",
        }
        body.update({k: dept[v] for k, v in override.items()})
        resp = await _create(db_session, dept["treasurer"], body)
        assert resp.status_code == 400, resp.text

    async def test_another_departments_line_is_refused(self, db_session, dept):
        body = _line_body(dept, "training_next")
        body["budgetId"] = dept["lines"]["foreign"]
        resp = await _create(db_session, dept["treasurer"], body)
        assert resp.status_code == 400

    async def test_only_for_a_draft_year(self, db_session, dept):
        body = _line_body(dept, "training")
        body["fiscalYearId"] = dept["active"]
        resp = await _create(db_session, dept["treasurer"], body)
        assert resp.status_code == 400
        assert "draft" in resp.json()["detail"]

    async def test_one_live_request_per_line(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        again = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        assert again.status_code == 409
        await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"/finance/budget-requests/{request_id}/decide",
            {"decision": "decline", "decisionNote": "Hold flat"},
        )
        after = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        assert after.status_code == 201, after.text


# ============================================
# The owner's lifecycle
# ============================================


@pytest.mark.integration
class TestOwnerLifecycle:
    async def test_edit_submit_withdraw_delete(self, db_session, dept, audit):
        created = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        path = f"/finance/budget-requests/{created.json()['id']}"
        trainer = dept["trainer"]

        edited = await _call(
            db_session,
            trainer,
            "PUT",
            path,
            {"requestedAmount": "2500.00", "justification": "Three seats"},
        )
        assert edited.status_code == 200
        assert Decimal(edited.json()["requestedAmount"]) == Decimal("2500.00")

        submitted = await _call(db_session, trainer, "POST", f"{path}/submit")
        assert submitted.json()["status"] == "submitted"
        assert submitted.json()["submittedByName"] == "trainer Test"
        assert submitted.json()["submittedAt"]
        assert (
            await _call(db_session, trainer, "POST", f"{path}/submit")
        ).status_code == 400
        # A submitted request is not deleted; it is withdrawn first.
        assert (await _call(db_session, trainer, "DELETE", path)).status_code == 400

        withdrawn = await _call(db_session, trainer, "POST", f"{path}/withdraw")
        assert withdrawn.json()["status"] == "draft"
        assert (
            await _call(db_session, trainer, "POST", f"{path}/withdraw")
        ).status_code == 400

        assert (await _call(db_session, trainer, "DELETE", path)).status_code == 204
        assert (await _call(db_session, trainer, "GET", path)).status_code == 404
        assert _audited(audit) == [
            "finance.budget_request_created",
            "finance.budget_request_submitted",
        ]

    async def test_a_decided_request_is_no_longer_the_owners(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        path = f"/finance/budget-requests/{request_id}"
        await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"{path}/decide",
            {"decision": "approve"},
        )
        for method, suffix, body in (
            ("PUT", "", {"requestedAmount": "1.00"}),
            ("POST", "/withdraw", None),
            ("DELETE", "", None),
        ):
            resp = await _call(db_session, dept["trainer"], method, path + suffix, body)
            assert resp.status_code == 400, (method, suffix)

    async def test_blank_justification_is_refused(self, db_session, dept):
        resp = await _create(
            db_session,
            dept["trainer"],
            _line_body(dept, "training_next", justification="   "),
        )
        assert resp.status_code == 422


# ============================================
# The Treasurer's decision
# ============================================


@pytest.mark.integration
class TestDecision:
    async def _decide(self, db, dept, request_id, body, user="treasurer"):
        return await _call(
            db,
            dept[user],
            "POST",
            f"/finance/budget-requests/{request_id}/decide",
            body,
        )

    async def test_approve_writes_the_requested_amount(self, db_session, dept, audit):
        request_id = await _submitted(db_session, dept)
        resp = await self._decide(db_session, dept, request_id, {"decision": "approve"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "approved"
        assert Decimal(body["approvedAmount"]) == Decimal("2400.00")
        assert body["decidedByName"] == "treasurer Test"
        line = await _line(db_session, dept["lines"]["training_next"])
        assert line.amount_budgeted == Decimal("2400.00")
        assert "finance.budget_request_decided" in _audited(audit)

    async def test_adjust_needs_an_amount_and_a_note(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        for body in (
            {"decision": "adjust", "approvedAmount": "2000.00"},
            {"decision": "adjust", "decisionNote": "Too much"},
            {"decision": "adjust", "approvedAmount": "2000.00", "decisionNote": " "},
        ):
            resp = await self._decide(db_session, dept, request_id, body)
            assert resp.status_code == 422, body
        resp = await self._decide(
            db_session,
            dept,
            request_id,
            {
                "decision": "adjust",
                "approvedAmount": "2000.00",
                "decisionNote": "Hold at this year's level",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "adjusted"
        assert resp.json()["decisionNote"] == "Hold at this year's level"
        line = await _line(db_session, dept["lines"]["training_next"])
        assert line.amount_budgeted == Decimal("2000.00")

    async def test_decline_needs_a_note_and_leaves_the_line(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        refused = await self._decide(
            db_session, dept, request_id, {"decision": "decline"}
        )
        assert refused.status_code == 422
        resp = await self._decide(
            db_session,
            dept,
            request_id,
            {"decision": "decline", "decisionNote": "No growth this year"},
        )
        assert resp.json()["status"] == "declined"
        assert resp.json()["approvedAmount"] is None
        line = await _line(db_session, dept["lines"]["training_next"])
        assert line.amount_budgeted == Decimal("0.00")

    async def test_only_finance_manage_decides(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        resp = await self._decide(
            db_session, dept, request_id, {"decision": "approve"}, user="trainer"
        )
        assert resp.status_code == 403

    async def test_a_draft_is_not_decided(self, db_session, dept):
        created = await _create(
            db_session, dept["trainer"], _line_body(dept, "training_next")
        )
        resp = await self._decide(
            db_session, dept, created.json()["id"], {"decision": "approve"}
        )
        assert resp.status_code == 400

    async def test_approving_a_proposal_creates_the_line(self, db_session, dept):
        created = await _create(
            db_session,
            dept["chief"],
            {
                "fiscalYearId": dept["draft"],
                "categoryId": dept["gear_cat"],
                "stationId": dept["station"],
                "ownerPositionId": dept["chief_pos"],
                "requestedAmount": "800.00",
                "justification": "Station 2 gear",
            },
        )
        request_id = created.json()["id"]
        await _call(
            db_session,
            dept["chief"],
            "POST",
            f"/finance/budget-requests/{request_id}/submit",
        )
        resp = await self._decide(db_session, dept, request_id, {"decision": "approve"})
        assert resp.status_code == 200, resp.text
        budget_id = resp.json()["budgetId"]
        assert budget_id
        line = await _line(db_session, budget_id)
        assert line.fiscal_year_id == dept["draft"]
        assert line.category_id == dept["gear_cat"]
        assert line.station_id == dept["station"]
        assert line.owner_position_id == dept["chief_pos"]
        assert line.amount_budgeted == Decimal("800.00")
        # The new line is the chief's: it shows in their lines for the year.
        mine = await _call(
            db_session,
            dept["chief"],
            "GET",
            f"/finance/budget-requests/my-lines?fiscal_year_id={dept['draft']}",
        )
        assert budget_id in [row["budget"]["id"] for row in mine.json()["lines"]]

    async def test_a_decision_changes_while_the_year_is_draft(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        await self._decide(db_session, dept, request_id, {"decision": "approve"})
        resp = await self._decide(
            db_session,
            dept,
            request_id,
            {"decision": "adjust", "approvedAmount": "2200.00", "decisionNote": "Trim"},
        )
        assert resp.status_code == 200
        line = await _line(db_session, dept["lines"]["training_next"])
        assert line.amount_budgeted == Decimal("2200.00")

    async def test_decisions_are_final_once_the_year_is_active(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        await self._decide(db_session, dept, request_id, {"decision": "approve"})
        activated = await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"/finance/fiscal-years/{dept['draft']}/activate",
        )
        assert activated.status_code == 200
        resp = await self._decide(
            db_session,
            dept,
            request_id,
            {"decision": "decline", "decisionNote": "Changed my mind"},
        )
        assert resp.status_code == 400
        assert "no longer a draft" in resp.json()["detail"]

    async def test_an_amount_below_what_is_spent_is_refused(self, db_session, dept):
        line = await _line(db_session, dept["lines"]["training_next"])
        line.amount_budgeted = Decimal("100.00")
        line.amount_encumbered = Decimal("50.00")
        await db_session.flush()
        request_id = await _submitted(db_session, dept, amount="40.00")
        resp = await self._decide(db_session, dept, request_id, {"decision": "approve"})
        assert resp.status_code == 409
        line = await _line(db_session, dept["lines"]["training_next"])
        assert line.amount_budgeted == Decimal("100.00")

    async def test_reviving_a_declined_request_keeps_one_live(self, db_session, dept):
        first = await _submitted(db_session, dept)
        await self._decide(
            db_session, dept, first, {"decision": "decline", "decisionNote": "No"}
        )
        await _submitted(db_session, dept)
        resp = await self._decide(db_session, dept, first, {"decision": "approve"})
        assert resp.status_code == 409


# ============================================
# Who sees what
# ============================================


@pytest.mark.integration
class TestVisibility:
    async def test_own_only_and_404_for_the_rest(self, db_session, dept):
        trainers = await _submitted(db_session, dept)
        chiefs = await _submitted(
            db_session, dept, user="chief", line="chief_next", amount="350.00"
        )

        def ids(resp):
            return {row["id"] for row in resp.json()}

        listing = "/finance/budget-requests"
        assert ids(await _call(db_session, dept["trainer"], "GET", listing)) == {
            trainers
        }
        assert ids(await _call(db_session, dept["chief"], "GET", listing)) == {chiefs}
        assert ids(await _call(db_session, dept["member"], "GET", listing)) == set()
        assert ids(await _call(db_session, dept["treasurer"], "GET", listing)) == {
            trainers,
            chiefs,
        }
        assert (
            ids(await _call(db_session, dept["outsider_admin"], "GET", listing))
            == set()
        )

        for user, request_id in (
            ("member", trainers),
            ("trainer", chiefs),
            ("outsider_admin", trainers),
        ):
            resp = await _call(db_session, dept[user], "GET", f"{listing}/{request_id}")
            assert resp.status_code == 404, user
            # Nor can they act on it.
            resp = await _call(
                db_session, dept[user], "POST", f"{listing}/{request_id}/withdraw"
            )
            assert resp.status_code == 404, user

    async def test_filters_by_year_and_status(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        base = "/finance/budget-requests"
        treasurer = dept["treasurer"]
        submitted = await _call(
            db_session, treasurer, "GET", f"{base}?status=submitted"
        )
        assert [r["id"] for r in submitted.json()] == [request_id]
        drafts = await _call(db_session, treasurer, "GET", f"{base}?status=draft")
        assert drafts.json() == []
        other = await _call(
            db_session, treasurer, "GET", f"{base}?fiscal_year_id={dept['empty_draft']}"
        )
        assert other.json() == []
        bad = await _call(db_session, treasurer, "GET", f"{base}?status=bogus")
        assert bad.status_code == 400

    async def test_my_lines(self, db_session, dept):
        request_id = await _submitted(db_session, dept)
        path = f"/finance/budget-requests/my-lines?fiscal_year_id={dept['draft']}"
        resp = await _call(db_session, dept["trainer"], "GET", path)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["fiscalYear"]["id"] == dept["draft"]
        assert body["fiscalYear"]["requestsOpen"] is True
        assert [row["budget"]["id"] for row in body["lines"]] == [
            dept["lines"]["training_next"]
        ]
        row = body["lines"][0]
        assert row["request"]["id"] == request_id
        assert Decimal(row["lastYearBudgeted"]) == Decimal("2000.00")
        assert Decimal(row["lastYearSpent"]) == Decimal("500.00")
        assert row["lastYearFiscalYearName"] == "FY2026"

        nothing = await _call(db_session, dept["member"], "GET", path)
        assert nothing.json()["lines"] == []
        foreign = await _call(
            db_session,
            dept["trainer"],
            "GET",
            f"/finance/budget-requests/my-lines?fiscal_year_id={dept['foreign_year']}",
        )
        assert foreign.status_code == 404
