"""Email notices for next year's budget requests, and the owner screen's API.

Owner decisions (2026-10-08): owners propose, the Treasurer decides, a
deadline per draft year with reminder emails; every notice is email only
(CLAUDE.md pitfall #18) and goes to recipients resolved inside the
department (#14) through the one ownership rule (#29).

Pinned here:

* **Request submitted** reaches the active ``finance.manage`` holders —
  wildcard included — and not the submitter, an inactive Treasurer, another
  department's, or one who turned Treasurer duty emails off; it names the
  line, the amount, the submitter and links to the review screen;
* **Decision made** reaches the submitter and the active holders of the
  owning position (a line's own owner, or its category's), not the decider;
  the adjusted amount and the note are in it, escaped;
* **Requests open** reaches every owner of a line in the draft year once,
  via the line's own owner and via category inheritance, nobody inactive or
  in another department; a moved deadline sends the "changed" variant;
  clearing it, resending the same date, or a date already past sends
  nothing;
* a mailer that raises never fails the action;
* the **deadline reminder**: which offset is due, owners who still owe a
  request only, closed/active/locked years skipped, idempotent across two
  runs, a member told the window opened this week not reminded again, and one
  department failing does not stop the next;
* ``/budget-requests/proposal-options`` offers only held positions and the
  department's own categories and stations; ``/my-budgets/summary`` reports
  ``plansNextYear``.
"""

from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    Budget,
    BudgetCategory,
    BudgetRequest,
    BudgetRequestStatus,
    FiscalYear,
    FiscalYearStatus,
)
from app.models.notification import NotificationLog
from app.models.user import Organization
from app.services import finance_budget_request_notifications as notices
from app.services import scheduled_tasks
from app.utils.org_timezone import org_today
from tests.test_finance_budget_owners import (
    _client,
    _org,
    _position,
    _station,
    _user,
    _year,
)

# ============================================
# Which reminder is due, no database
# ============================================


@pytest.mark.unit
class TestDueOffset:
    @pytest.mark.parametrize(
        ("days_left", "expected"),
        [
            (10, None),
            (8, None),
            (7, 7),
            (3, 7),
            (2, 7),
            (1, 1),
            (0, 1),
            (-1, None),
        ],
    )
    def test_the_most_urgent_window_that_has_begun(self, days_left, expected):
        today = org_today(None)
        deadline = today + timedelta(days=days_left)
        assert notices.due_offset(deadline, today) == expected

    def test_money_and_dates_read_as_a_member_would(self):
        assert notices.money(Decimal("2400")) == "$2,400.00"
        assert notices.money(None) == "$0.00"
        today = org_today(None).replace(year=2026, month=10, day=15)
        assert notices.long_date(today) == "October 15, 2026"


# ============================================
# A fake mailer
# ============================================


class _Mailer:
    """Records each send; every address is accepted unless told otherwise."""

    def __init__(self):
        self.sends: list[dict] = []
        self.raise_on_send = False

    def factory(self, organization=None):
        mailer = self

        class _Service:
            async def send_email(self, to_emails, subject, html_body, **kwargs):
                if mailer.raise_on_send:
                    raise RuntimeError("smtp down")
                mailer.sends.append(
                    {
                        "to": list(to_emails),
                        "subject": subject,
                        "html": html_body,
                        "text": kwargs.get("text_body") or "",
                        "organization": organization,
                    }
                )
                out = kwargs.get("results_out")
                if out is not None:
                    out.clear()
                    out.extend([True] * len(to_emails))
                return len(to_emails), 0

        return _Service()

    def to(self, subject_start: str) -> set[str]:
        return {
            address
            for send in self.sends
            if send["subject"].startswith(subject_start)
            for address in send["to"]
        }


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


# ============================================
# Fixtures
# ============================================


@pytest.fixture
async def dept(db_session: AsyncSession, _no_audit):
    org_id = await _org(db_session, "notice")
    other_org = await _org(db_session, "elsewhere")

    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    admin_pos = await _position(db_session, org_id, "IT Manager", ["*"])
    training_officer = await _position(db_session, org_id, "Training Officer", [])
    chief = await _position(db_session, org_id, "Chief", [])
    firefighter = await _position(db_session, org_id, "Firefighter", [])
    their_treasurer = await _position(
        db_session, other_org, "Their Treasurer", ["finance.manage"]
    )
    their_trainer = await _position(db_session, other_org, "Their Trainer", [])

    people = {
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "it": await _user(db_session, org_id, "itmanager", [admin_pos]),
        "old_treasurer": await _user(
            db_session, org_id, "oldtreasurer", [treasurer_pos], status="inactive"
        ),
        "trainer": await _user(db_session, org_id, "trainer", [training_officer]),
        "co_trainer": await _user(db_session, org_id, "cotrainer", [training_officer]),
        "old_trainer": await _user(
            db_session, org_id, "oldtrainer", [training_officer], status="inactive"
        ),
        "chief": await _user(db_session, org_id, "chief", [chief]),
        "member": await _user(db_session, org_id, "member", [firefighter]),
        "nobody": await _user(db_session, org_id, "nobody", []),
        "their_treasurer": await _user(
            db_session, other_org, "theirtreasurer", [their_treasurer]
        ),
        "their_trainer": await _user(
            db_session, other_org, "theirtrainer", [their_trainer]
        ),
    }
    treasurer_id = people["treasurer"].id

    active = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026)
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027)
    their_draft = _year(
        other_org, "Their FY2027", FiscalYearStatus.DRAFT, treasurer_id, 2027
    )
    training = BudgetCategory(
        organization_id=org_id, name="Training", owner_position_id=training_officer
    )
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    inactive_category = BudgetCategory(
        organization_id=org_id, name="Retired", is_active=False
    )
    their_category = BudgetCategory(
        organization_id=other_org,
        name="Their Training",
        owner_position_id=their_trainer,
    )
    db_session.add_all(
        [active, draft, their_draft, training, gear, inactive_category]
        + [their_category]
    )
    await db_session.flush()
    station = await _station(db_session, org_id, "Station 2")
    their_station = await _station(db_session, other_org, "Their Station")

    def line(fy, category, org=org_id, **kw):
        return Budget(
            organization_id=org,
            fiscal_year_id=fy.id,
            category_id=category.id,
            amount_budgeted=Decimal("0.00"),
            created_by=treasurer_id,
            **kw,
        )

    lines = {
        # Inherit the Training Officer from the category: two lines, one email.
        "training_next": line(draft, training),
        "training_s2": line(draft, training, station_id=station),
        # Its own owner.
        "chief_next": line(draft, gear, owner_position_id=chief),
        # Nobody's.
        "gear_s2": line(draft, gear, station_id=station),
        # This year's, not the draft's: owners of it alone are not told.
        "training_now": line(active, training),
        "theirs": line(their_draft, their_category, org=other_org),
    }
    db_session.add_all(lines.values())
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "draft": draft.id,
        "active": active.id,
        "their_draft": their_draft.id,
        "training_cat": training.id,
        "gear_cat": gear.id,
        "their_cat": their_category.id,
        "station": station,
        "their_station": their_station,
        "chief_pos": chief,
        "training_pos": training_officer,
        "firefighter_pos": firefighter,
        "their_trainer_pos": their_trainer,
        "lines": {k: v.id for k, v in lines.items()},
        **people,
    }


async def _call(db, user, method, path, json=None):
    async with _client(db, user) as client:
        return await client.request(method, path, json=json)


async def _submit(db, dept, user="trainer", line="training_next", amount="2400.00"):
    created = await _call(
        db,
        dept[user],
        "POST",
        "/finance/budget-requests",
        {
            "fiscalYearId": dept["draft"],
            "budgetId": dept["lines"][line],
            "requestedAmount": amount,
            "justification": "Two more academy seats",
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    resp = await _call(
        db, dept[user], "POST", f"/finance/budget-requests/{request_id}/submit"
    )
    assert resp.status_code == 200, resp.text
    return request_id


async def _decide(db, dept, request_id, body):
    return await _call(
        db,
        dept["treasurer"],
        "POST",
        f"/finance/budget-requests/{request_id}/decide",
        body,
    )


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


def _emails(dept, *names) -> set[str]:
    return {dept[name].email for name in names}


async def _org_row(db, dept) -> Organization:
    return await db.get(Organization, dept["org_id"])


# ============================================
# 1. Request submitted -> the Treasurers
# ============================================


@pytest.mark.integration
class TestRequestSubmitted:
    async def test_the_treasurers_are_told(self, db_session, dept, mailer):
        await _submit(db_session, dept)
        assert mailer.to("Budget request to review") == _emails(dept, "treasurer", "it")

    async def test_says_what_and_who_and_links_to_review(
        self, db_session, dept, mailer
    ):
        await _submit(db_session, dept)
        (send,) = [
            s for s in mailer.sends if s["subject"].startswith("Budget request to")
        ]
        assert send["subject"] == "Budget request to review: Training ($2,400.00)"
        assert "trainer" in send["html"]
        assert "$2,400.00" in send["html"]
        assert "/finance/budget-requests/review" in send["html"]
        assert "Two more academy seats" in send["text"]

    async def test_not_the_submitter_even_a_treasurer(self, db_session, dept, mailer):
        # The Treasurer submits on the owner's behalf: the other manager hears.
        created = await _call(
            db_session,
            dept["treasurer"],
            "POST",
            "/finance/budget-requests",
            {
                "fiscalYearId": dept["draft"],
                "budgetId": dept["lines"]["gear_s2"],
                "requestedAmount": "50.00",
                "justification": "Hose",
            },
        )
        request_id = created.json()["id"]
        resp = await _call(
            db_session,
            dept["treasurer"],
            "POST",
            f"/finance/budget-requests/{request_id}/submit",
        )
        assert resp.status_code == 200
        assert mailer.to("Budget request to review") == _emails(dept, "it")

    async def test_an_opted_out_treasurer_is_left_out(self, db_session, dept, mailer):
        dept["it"].notification_preferences = {"email_kinds": {"finance_duties": False}}
        await db_session.flush()
        await _submit(db_session, dept)
        assert mailer.to("Budget request to review") == _emails(dept, "treasurer")

    async def test_a_failing_mailer_does_not_fail_the_submit(
        self, db_session, dept, mailer
    ):
        mailer.raise_on_send = True
        request_id = await _submit(db_session, dept)
        row = await db_session.get(BudgetRequest, request_id)
        assert row.status == BudgetRequestStatus.SUBMITTED

    async def test_the_justification_is_escaped(self, db_session, dept, mailer):
        created = await _call(
            db_session,
            dept["chief"],
            "POST",
            "/finance/budget-requests",
            {
                "fiscalYearId": dept["draft"],
                "budgetId": dept["lines"]["chief_next"],
                "requestedAmount": "10.00",
                "justification": "<script>alert(1)</script>",
            },
        )
        request_id = created.json()["id"]
        await _call(
            db_session,
            dept["chief"],
            "POST",
            f"/finance/budget-requests/{request_id}/submit",
        )
        (send,) = mailer.sends
        assert "<script>" not in send["html"]
        assert "&lt;script&gt;" in send["html"]


# ============================================
# 2. Decision made -> the submitter and the owners
# ============================================


@pytest.mark.integration
class TestDecisionMade:
    async def test_approved_reaches_submitter_and_position_holders(
        self, db_session, dept, mailer
    ):
        request_id = await _submit(db_session, dept)
        mailer.sends.clear()
        resp = await _decide(db_session, dept, request_id, {"decision": "approve"})
        assert resp.status_code == 200, resp.text
        # Training inherits the Training Officer: both active holders, not
        # the inactive one, not the deciding Treasurer.
        assert mailer.to("Budget request approved") == _emails(
            dept, "trainer", "co_trainer"
        )
        (send,) = mailer.sends
        assert send["subject"] == "Budget request approved: Training"
        assert "/finance/budget-requests" in send["html"]

    async def test_adjusted_carries_the_amount_and_the_escaped_note(
        self, db_session, dept, mailer
    ):
        request_id = await _submit(db_session, dept)
        mailer.sends.clear()
        resp = await _decide(
            db_session,
            dept,
            request_id,
            {
                "decision": "adjust",
                "approvedAmount": "1800.00",
                "decisionNote": "One seat <b>only</b>",
            },
        )
        assert resp.status_code == 200, resp.text
        (send,) = mailer.sends
        assert send["subject"] == "Budget request adjusted: Training"
        assert "$1,800.00" in send["html"]
        assert "$2,400.00" in send["html"]
        assert "One seat &lt;b&gt;only&lt;/b&gt;" in send["html"]
        assert "One seat <b>only</b>" in send["text"]

    async def test_declined_carries_the_note_and_no_amount(
        self, db_session, dept, mailer
    ):
        request_id = await _submit(db_session, dept, user="chief", line="chief_next")
        mailer.sends.clear()
        resp = await _decide(
            db_session,
            dept,
            request_id,
            {"decision": "decline", "decisionNote": "Not this year"},
        )
        assert resp.status_code == 200, resp.text
        # The line's own owner: the chief, who also submitted — told once.
        (send,) = mailer.sends
        assert send["to"] == [dept["chief"].email]
        assert send["subject"] == "Budget request declined: Gear"
        assert "Not this year" in send["html"]
        assert "Approved" not in send["text"]

    async def test_a_failing_mailer_does_not_fail_the_decision(
        self, db_session, dept, mailer
    ):
        request_id = await _submit(db_session, dept)
        mailer.raise_on_send = True
        resp = await _decide(db_session, dept, request_id, {"decision": "approve"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "approved"

    async def test_an_opted_out_owner_is_left_out(self, db_session, dept, mailer):
        dept["co_trainer"].notification_preferences = {"email_notifications": False}
        await db_session.flush()
        request_id = await _submit(db_session, dept)
        mailer.sends.clear()
        await _decide(db_session, dept, request_id, {"decision": "approve"})
        assert mailer.to("Budget request approved") == _emails(dept, "trainer")


# ============================================
# 3. Requests open / deadline changed -> the year's owners
# ============================================


@pytest.mark.integration
class TestRequestsOpen:
    async def test_every_owner_once_via_line_and_category(
        self, db_session, dept, mailer
    ):
        today = org_today(await _org_row(db_session, dept))
        await _set_deadline(db_session, dept, today + timedelta(days=14))
        (send,) = mailer.sends
        # trainer and co_trainer own two lines each (category), chief one
        # (its own owner); gear_s2 is nobody's; nobody inactive or elsewhere.
        assert sorted(send["to"]) == sorted(
            _emails(dept, "trainer", "co_trainer", "chief")
        )
        assert send["subject"].startswith("Budget requests for FY2027 are open until")
        assert notices.long_date(today + timedelta(days=14)) in send["subject"]
        assert "/finance/budget-requests" in send["html"]

    async def test_the_send_is_recorded_for_the_reminder(
        self, db_session, dept, mailer
    ):
        today = org_today(await _org_row(db_session, dept))
        await _set_deadline(db_session, dept, today + timedelta(days=14))
        await db_session.flush()
        logs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == dept["org_id"],
                        NotificationLog.category == notices.WINDOW_LOG_CATEGORY,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {log.recipient_id for log in logs} == {
            dept["trainer"].id,
            dept["co_trainer"].id,
            dept["chief"].id,
        }
        assert logs[0].notification_metadata["fiscal_year_id"] == dept["draft"]

    async def test_a_moved_deadline_sends_the_changed_variant(
        self, db_session, dept, mailer
    ):
        today = org_today(await _org_row(db_session, dept))
        await _set_deadline(db_session, dept, today + timedelta(days=14))
        mailer.sends.clear()
        await _set_deadline(db_session, dept, today + timedelta(days=21))
        (send,) = mailer.sends
        assert send["subject"].startswith(
            "Budget request deadline for FY2027 changed to"
        )

    async def test_clearing_resending_or_a_past_date_sends_nothing(
        self, db_session, dept, mailer
    ):
        today = org_today(await _org_row(db_session, dept))
        await _set_deadline(db_session, dept, today + timedelta(days=14))
        mailer.sends.clear()
        await _set_deadline(db_session, dept, today + timedelta(days=14))
        await _set_deadline(db_session, dept, None)
        await _set_deadline(db_session, dept, today - timedelta(days=1))
        assert mailer.sends == []

    async def test_a_failing_mailer_does_not_fail_the_save(
        self, db_session, dept, mailer
    ):
        mailer.raise_on_send = True
        today = org_today(await _org_row(db_session, dept))
        body = await _set_deadline(db_session, dept, today + timedelta(days=14))
        assert body["requestDeadline"] == (today + timedelta(days=14)).isoformat()


# ============================================
# 4. Deadline reminder
# ============================================


async def _deadline_in(db, dept, days, *, year="draft", **extra):
    org = await _org_row(db, dept)
    fy = await db.get(FiscalYear, dept[year])
    fy.request_deadline = org_today(org) + timedelta(days=days)
    for key, value in extra.items():
        setattr(fy, key, value)
    await db.flush()
    return org


async def _handed_in(db, dept, line, status=BudgetRequestStatus.SUBMITTED):
    db.add(
        BudgetRequest(
            organization_id=dept["org_id"],
            fiscal_year_id=dept["draft"],
            budget_id=dept["lines"][line],
            requested_amount=Decimal("1.00"),
            justification="x",
            status=status,
        )
    )
    await db.flush()


@pytest.mark.integration
class TestDeadlineReminder:
    async def test_seven_days_out_reaches_owners_who_owe_one(
        self, db_session, dept, mailer
    ):
        org = await _deadline_in(db_session, dept, 7)
        # The chief handed in their only line; the trainers still owe two.
        await _handed_in(db_session, dept, "chief_next")
        # A draft that was never submitted does not count as handed in.
        await _handed_in(
            db_session, dept, "training_next", status=BudgetRequestStatus.DRAFT
        )
        sent = await notices.send_deadline_reminders(db_session, org)
        assert sent == 2
        assert mailer.to("Reminder: budget requests for FY2027 close") == _emails(
            dept, "trainer", "co_trainer"
        )
        assert "in 7 days" in mailer.sends[0]["text"]

    async def test_an_owner_with_one_line_left_is_still_reminded(
        self, db_session, dept, mailer
    ):
        org = await _deadline_in(db_session, dept, 1)
        await _handed_in(db_session, dept, "training_next")
        await notices.send_deadline_reminders(db_session, org)
        assert dept["trainer"].email in mailer.to("Reminder")
        assert "tomorrow" in mailer.sends[0]["text"]

    async def test_a_second_run_sends_nothing(self, db_session, dept, mailer):
        org = await _deadline_in(db_session, dept, 7)
        assert await notices.send_deadline_reminders(db_session, org) == 3
        assert await notices.send_deadline_reminders(db_session, org) == 0
        assert len(mailer.sends) == 1

    async def test_the_next_reminder_still_goes_out(self, db_session, dept, mailer):
        org = await _deadline_in(db_session, dept, 7)
        await notices.send_deadline_reminders(db_session, org)
        # Six days later the 1-day reminder is a different key.
        fy = await db_session.get(FiscalYear, dept["draft"])
        fy.request_deadline = org_today(org) + timedelta(days=1)
        await db_session.flush()
        assert await notices.send_deadline_reminders(db_session, org) == 3

    async def test_too_early_or_after_the_deadline_sends_nothing(
        self, db_session, dept, mailer
    ):
        org = await _deadline_in(db_session, dept, 10)
        assert await notices.send_deadline_reminders(db_session, org) == 0
        await _deadline_in(db_session, dept, -1)
        assert await notices.send_deadline_reminders(db_session, org) == 0
        assert mailer.sends == []

    async def test_locked_and_active_years_are_skipped(self, db_session, dept, mailer):
        org = await _deadline_in(db_session, dept, 1, is_locked=True)
        assert await notices.send_deadline_reminders(db_session, org) == 0
        await _deadline_in(db_session, dept, 1, is_locked=False)
        fy = await db_session.get(FiscalYear, dept["draft"])
        fy.status = FiscalYearStatus.ACTIVE
        await db_session.flush()
        assert await notices.send_deadline_reminders(db_session, org) == 0
        assert mailer.sends == []

    async def test_told_the_window_opened_this_week_means_no_7_day_reminder(
        self, db_session, dept, mailer
    ):
        org = await _deadline_in(db_session, dept, 7)
        fy = await db_session.get(FiscalYear, dept["draft"])
        await notices.notify_requests_open(
            db_session, dept["org_id"], fy.id, changed=False, today=org_today(org)
        )
        mailer.sends.clear()
        assert await notices.send_deadline_reminders(db_session, org) == 0

    async def test_another_departments_owners_are_never_reminded(
        self, db_session, dept, mailer
    ):
        org = await _deadline_in(db_session, dept, 7)
        await _deadline_in(db_session, dept, 7, year="their_draft")
        await notices.send_deadline_reminders(db_session, org)
        everyone = {a for s in mailer.sends for a in s["to"]}
        assert dept["their_trainer"].email not in everyone


def _rows(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


@pytest.mark.unit
class TestReminderTask:
    def test_it_is_registered_and_scheduled(self):
        name = "budget_request_reminders"
        runner = scheduled_tasks.run_budget_request_reminders
        assert scheduled_tasks.TASK_RUNNERS[name] is runner
        assert name in scheduled_tasks.SCHEDULE
        assert scheduled_tasks.TASK_INTERVALS_SECONDS[name] == 86400

    async def test_one_department_failing_does_not_stop_the_next(self, monkeypatch):
        orgs = [SimpleNamespace(id="org-a"), SimpleNamespace(id="org-b")]
        db = MagicMock()
        db.execute = AsyncMock(return_value=_rows(orgs))
        db.rollback = AsyncMock()
        seen = []

        async def _send(session, org):
            seen.append(org.id)
            if org.id == "org-a":
                raise RuntimeError("bad data")
            return 4

        monkeypatch.setattr(notices, "send_deadline_reminders", _send)
        monkeypatch.setattr(scheduled_tasks, "persist_task_error_log", AsyncMock())
        result = await scheduled_tasks.run_budget_request_reminders(db)
        assert seen == ["org-a", "org-b"]
        assert result["total"] == 4
        assert [e["org_id"] for e in result["errors"]] == ["org-a"]
        db.rollback.assert_awaited()


# ============================================
# The owner screen's options, and the navigation signal
# ============================================


@pytest.mark.integration
class TestProposalOptions:
    async def test_only_held_positions_and_this_departments_choices(
        self, db_session, dept
    ):
        resp = await _call(
            db_session,
            dept["trainer"],
            "GET",
            "/finance/budget-requests/proposal-options",
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["positions"] == [
            {"id": dept["training_pos"], "name": "Training Officer"}
        ]
        category_ids = {c["id"] for c in body["categories"]}
        assert category_ids == {dept["training_cat"], dept["gear_cat"]}
        station_ids = {s["id"] for s in body["stations"]}
        assert dept["station"] in station_ids
        assert dept["their_station"] not in station_ids

    async def test_a_member_holding_nothing_gets_nothing(self, db_session, dept):
        resp = await _call(
            db_session,
            dept["nobody"],
            "GET",
            "/finance/budget-requests/proposal-options",
        )
        assert resp.json() == {"positions": [], "categories": [], "stations": []}


@pytest.mark.integration
class TestPlansNextYear:
    async def _summary(self, db, user):
        resp = await _call(db, user, "GET", "/finance/my-budgets/summary")
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def test_an_owner_of_a_draft_line(self, db_session, dept):
        assert (await self._summary(db_session, dept["chief"]))["plansNextYear"]

    async def test_a_member_with_nothing(self, db_session, dept):
        body = await self._summary(db_session, dept["member"])
        assert body == {"ownsAny": False, "plansNextYear": False}

    async def test_a_member_with_only_a_proposal(self, db_session, dept):
        hazmat = BudgetCategory(organization_id=dept["org_id"], name="Hazmat")
        db_session.add(hazmat)
        await db_session.flush()
        resp = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/budget-requests",
            {
                "fiscalYearId": dept["draft"],
                "categoryId": hazmat.id,
                "ownerPositionId": dept["firefighter_pos"],
                "requestedAmount": "75.00",
                "justification": "Station tools",
            },
        )
        assert resp.status_code == 201, resp.text
        assert (await self._summary(db_session, dept["member"]))["plansNextYear"]

    async def test_only_a_draft_years_line_counts(self, db_session, dept):
        # The other department's trainer owns a line in their draft year.
        body = await self._summary(db_session, dept["their_trainer"])
        assert body["ownsAny"] is True
        assert body["plansNextYear"] is True
        # Once that year is active, it is not next year's business.
        fy = await db_session.get(FiscalYear, dept["their_draft"])
        fy.status = FiscalYearStatus.ACTIVE
        await db_session.flush()
        body = await self._summary(db_session, dept["their_trainer"])
        assert body == {"ownsAny": True, "plansNextYear": False}
