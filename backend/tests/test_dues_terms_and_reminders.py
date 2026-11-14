"""Owner decisions of 2026-11-01 on dues, as built 2026-11-06.

KNOWN_LIMITATIONS "Finance: dues administration has no UI" (its "Still open"
part) and "Finance — Dues: … Members Who Cannot See What They Owe":

* **Show the name.** The payment history names who recorded each payment.
* **Build them.** A schedule's membership types, fiscal year, grace period and
  late fee apply — to a schedule saved since (``terms_effective_at``). One
  saved before keeps billing everyone and charging nothing (pitfall #19/#35).
  The late fee is charged once, by a daily task whose second run is a no-op.
* **My dues view + email reminders.** A member reads their own dues without a
  finance permission, and is emailed once before the due date and once when
  overdue, unless they turned the kind off.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    DuesFrequency,
    DuesSchedule,
    DuesStatus,
    FiscalYear,
    FiscalYearStatus,
    MemberDues,
)
from app.models.user import Organization
from app.services.dues_reminders import (
    DUE_SOON,
    OVERDUE,
    reminder_kind,
    send_dues_reminders,
)
from app.services.dues_terms import (
    apply_late_fees,
    bills_member,
    clean_membership_types,
    due_date_outside_year,
    late_fee_deadline,
    targeted_types,
)
from app.services.email_policy import EMAIL_POLICIES, EmailKind
from app.services.finance_service import FinanceService
from tests.test_finance_approver_enforcement import _client, _make_member, _make_org

NOW = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc)


def _schedule(**overrides) -> SimpleNamespace:
    values = {
        "terms_effective_at": NOW - timedelta(days=60),
        "applies_to_membership_types": None,
        "grace_period_days": 30,
        "late_fee_amount": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


# ============================================
# The rules, without a database
# ============================================


@pytest.mark.unit
class TestTargeting:
    def test_a_legacy_schedule_bills_everyone_whatever_it_stores(self):
        legacy = _schedule(
            terms_effective_at=None, applies_to_membership_types=["life"]
        )
        regular = SimpleNamespace(member_status="regular", membership_type="active")
        assert bills_member(legacy, regular) is True

    def test_no_types_bills_everyone(self):
        member = SimpleNamespace(member_status="retired", membership_type="retired")
        assert bills_member(_schedule(applies_to_membership_types=[]), member)

    def test_listed_types_bill_only_members_on_them(self):
        schedule = _schedule(applies_to_membership_types=["life"])
        life = SimpleNamespace(member_status="life", membership_type="life")
        regular = SimpleNamespace(member_status="regular", membership_type="active")
        assert bills_member(schedule, life) is True
        assert bills_member(schedule, regular) is False

    def test_the_shipped_active_tier_matches_a_regular_member(self):
        # The ladder calls the rung "active"; the column stores "regular".
        schedule = _schedule(applies_to_membership_types=["active"])
        regular = SimpleNamespace(member_status="regular", membership_type="active")
        assert bills_member(schedule, regular) is True

    def test_a_malformed_stored_value_is_no_limit(self):
        assert targeted_types(_schedule(applies_to_membership_types="life")) == []
        assert targeted_types(_schedule(applies_to_membership_types=[" ", 3])) == []

    def test_cleaning_stores_one_spelling_of_everyone(self):
        assert clean_membership_types([]) is None
        assert clean_membership_types(None) is None
        assert clean_membership_types([" life ", "life", "", "senior"]) == [
            "life",
            "senior",
        ]


@pytest.mark.unit
class TestDates:
    def test_the_late_fee_deadline_is_due_date_plus_grace(self):
        due = datetime(2026, 3, 1, 5, 0)  # naive, as MySQL returns it
        assert late_fee_deadline(due, 30) == datetime(
            2026, 3, 31, 5, 0, tzinfo=timezone.utc
        )
        assert late_fee_deadline(due, None) == due.replace(tzinfo=timezone.utc)

    def test_a_due_date_is_read_on_the_departments_calendar(self):
        year = SimpleNamespace(
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        ny = ZoneInfo("America/New_York")
        # Midnight 31 December in New York is 05:00 UTC: still inside.
        last_day = datetime(2026, 12, 31, 5, 0, tzinfo=timezone.utc)
        assert due_date_outside_year(last_day, year, ny) is None
        next_year = datetime(2027, 1, 1, 5, 0, tzinfo=timezone.utc)
        assert "outside FY2026" in due_date_outside_year(next_year, year, ny)


@pytest.mark.unit
class TestWhichReminder:
    def _dues(self, days_from_now, **kw):
        values = {
            "status": DuesStatus.PENDING,
            "amount_paid": Decimal("0"),
            "amount_due": Decimal("100"),
            "due_date": NOW + timedelta(days=days_from_now),
            "due_reminder_sent_at": None,
            "overdue_reminder_sent_at": None,
        }
        values.update(kw)
        return SimpleNamespace(**values)

    def test_due_within_a_week_is_coming_due(self):
        assert reminder_kind(self._dues(5), NOW) == DUE_SOON
        assert reminder_kind(self._dues(10), NOW) is None

    def test_recently_overdue_is_overdue_and_long_overdue_is_not_announced(self):
        assert reminder_kind(self._dues(-3), NOW) == OVERDUE
        assert reminder_kind(self._dues(-90), NOW) is None

    def test_a_sent_reminder_is_not_sent_again(self):
        assert reminder_kind(self._dues(5, due_reminder_sent_at=NOW), NOW) is None
        assert reminder_kind(self._dues(-3, overdue_reminder_sent_at=NOW), NOW) is None

    def test_settled_dues_are_not_chased(self):
        assert reminder_kind(self._dues(-3, status=DuesStatus.WAIVED), NOW) is None
        paid = self._dues(-3, status=DuesStatus.PARTIAL, amount_paid=Decimal("100"))
        assert reminder_kind(paid, NOW) is None

    def test_the_kind_is_optional_and_on_by_default(self):
        policy = EMAIL_POLICIES[EmailKind.DUES_REMINDERS]
        assert (policy.required, policy.default_on) == (False, True)


# ============================================
# Against the database
# ============================================


class _Mailer:
    def __init__(self):
        self.sends: list[dict] = []

    def factory(self, organization=None):
        mailer = self

        class _Service:
            async def send_email(self, to_emails, subject, html_body, **kwargs):
                mailer.sends.append(
                    {
                        "to": list(to_emails),
                        "subject": subject,
                        "text": kwargs.get("text_body") or "",
                        "template_type": kwargs.get("template_type"),
                    }
                )
                return len(to_emails), 0

        return _Service()


@pytest.fixture
def mailer(monkeypatch):
    recorder = _Mailer()
    monkeypatch.setattr(
        "app.services.email_service.EmailService", recorder.factory, raising=True
    )
    return recorder


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _make_org(db_session)
    treasurer = await _make_member(
        db_session, org_id, "finance.view", "finance.manage", first_name="Tess"
    )
    life = await _make_member(db_session, org_id, "finance.request", first_name="Lee")
    life.member_status = "life"
    regular = await _make_member(
        db_session, org_id, "finance.request", first_name="Reg"
    )
    regular.member_status = "regular"
    await db_session.flush()
    return SimpleNamespace(
        org_id=org_id,
        treasurer=treasurer,
        life=life,
        regular=regular,
        service=FinanceService(db_session),
    )


async def _dues_for(db: AsyncSession, schedule_id: str) -> dict[str, MemberDues]:
    rows = (
        await db.scalars(
            select(MemberDues).where(MemberDues.dues_schedule_id == schedule_id)
        )
    ).all()
    return {str(d.user_id): d for d in rows}


async def _legacy_schedule(db: AsyncSession, dept, **kw) -> DuesSchedule:
    """A schedule as it stands after the upgrade: terms never in effect."""
    values = {
        "organization_id": dept.org_id,
        "name": "Legacy dues",
        "amount": Decimal("100.00"),
        "frequency": DuesFrequency.ANNUAL,
        "due_date": datetime.now(timezone.utc) + timedelta(days=30),
        "created_by": dept.treasurer.id,
    }
    values.update(kw)
    schedule = DuesSchedule(**values)
    db.add(schedule)
    await db.flush()
    return schedule


@pytest.mark.integration
class TestGenerationHonoursTheTerms:
    async def test_a_new_schedule_takes_its_terms_into_effect(self, db_session, dept):
        schedule = await dept.service.create_dues_schedule(
            dept.org_id,
            dept.treasurer.id,
            name="2027 dues",
            amount=Decimal("100"),
            frequency="annual",
            due_date=datetime.now(timezone.utc) + timedelta(days=30),
        )
        assert schedule.terms_effective_at is not None

    async def test_listed_membership_types_bill_only_those_members(
        self, db_session, dept
    ):
        schedule = await dept.service.create_dues_schedule(
            dept.org_id,
            dept.treasurer.id,
            name="Life member assessment",
            amount=Decimal("50"),
            frequency="annual",
            due_date=datetime.now(timezone.utc) + timedelta(days=30),
            applies_to_membership_types=["life"],
        )
        assert await dept.service.generate_member_dues(schedule.id, dept.org_id) == 1
        assert set(await _dues_for(db_session, schedule.id)) == {str(dept.life.id)}

    async def test_a_schedule_saved_before_the_decision_still_bills_everyone(
        self, db_session, dept
    ):
        schedule = await _legacy_schedule(
            db_session, dept, applies_to_membership_types=["life"]
        )
        await dept.service.generate_member_dues(schedule.id, dept.org_id)
        billed = set(await _dues_for(db_session, schedule.id))
        assert {str(dept.life.id), str(dept.regular.id)} <= billed

    async def test_saving_a_legacy_schedule_puts_its_terms_into_effect(
        self, db_session, dept
    ):
        schedule = await _legacy_schedule(db_session, dept)
        updated = await dept.service.update_dues_schedule(
            schedule.id, dept.org_id, name="Renamed"
        )
        assert updated.terms_effective_at is not None
        first = updated.terms_effective_at
        again = await dept.service.update_dues_schedule(
            schedule.id, dept.org_id, notes="x"
        )
        # A later save does not move it: fees already due stay due.
        assert again.terms_effective_at == first

    async def test_generation_refuses_a_closing_fiscal_year(self, db_session, dept):
        year = FiscalYear(
            organization_id=dept.org_id,
            name="FY-closing",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
            status=FiscalYearStatus.ACTIVE,
            created_by=dept.treasurer.id,
        )
        db_session.add(year)
        await db_session.flush()
        schedule = await dept.service.create_dues_schedule(
            dept.org_id,
            dept.treasurer.id,
            name="2026 dues",
            amount=Decimal("100"),
            frequency="annual",
            due_date=datetime(2026, 12, 1, tzinfo=timezone.utc),
            fiscal_year_id=year.id,
        )
        year.status = FiscalYearStatus.CLOSED
        await db_session.flush()
        with pytest.raises(ValueError, match="closing"):
            await dept.service.generate_member_dues(schedule.id, dept.org_id)

    async def test_a_due_date_outside_the_fiscal_year_is_refused(
        self, db_session, dept
    ):
        year = FiscalYear(
            organization_id=dept.org_id,
            name="FY-2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
            status=FiscalYearStatus.ACTIVE,
            created_by=dept.treasurer.id,
        )
        db_session.add(year)
        await db_session.flush()
        with pytest.raises(ValueError, match="outside FY-2026"):
            await dept.service.create_dues_schedule(
                dept.org_id,
                dept.treasurer.id,
                name="Mis-dated dues",
                amount=Decimal("100"),
                frequency="annual",
                due_date=datetime(2027, 3, 1, tzinfo=timezone.utc),
                fiscal_year_id=year.id,
            )


async def _owed(
    db: AsyncSession,
    dept,
    schedule: DuesSchedule,
    member,
    *,
    due_date: datetime,
    paid: str = "0",
    status: DuesStatus = DuesStatus.PENDING,
) -> MemberDues:
    dues = MemberDues(
        organization_id=dept.org_id,
        dues_schedule_id=schedule.id,
        user_id=member.id,
        amount_due=Decimal("100.00"),
        amount_paid=Decimal(paid),
        status=status,
        due_date=due_date,
    )
    db.add(dues)
    await db.flush()
    return dues


@pytest.mark.integration
class TestLateFees:
    async def _fee_schedule(self, db, dept, **kw):
        values = {
            "late_fee_amount": Decimal("15.00"),
            "grace_period_days": 10,
            "terms_effective_at": NOW - timedelta(days=365),
        }
        values.update(kw)
        return await _legacy_schedule(db, dept, **values)

    async def test_the_fee_is_charged_once_however_often_the_task_runs(
        self, db_session, dept
    ):
        schedule = await self._fee_schedule(db_session, dept)
        dues = await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW - timedelta(days=20)
        )

        assert await apply_late_fees(db_session, NOW) == 1
        assert await apply_late_fees(db_session, NOW) == 0
        assert await apply_late_fees(db_session, NOW + timedelta(days=1)) == 0

        await db_session.refresh(dues)
        assert dues.late_fee_applied == Decimal("15.00")
        assert dues.amount_due == Decimal("115.00")

    async def test_partly_paid_dues_are_charged_too(self, db_session, dept):
        schedule = await self._fee_schedule(db_session, dept)
        dues = await _owed(
            db_session,
            dept,
            schedule,
            dept.regular,
            due_date=NOW - timedelta(days=20),
            paid="40",
            status=DuesStatus.PARTIAL,
        )
        assert await apply_late_fees(db_session, NOW) == 1
        await db_session.refresh(dues)
        assert dues.amount_due == Decimal("115.00")

    async def test_nothing_is_charged_inside_the_grace_period(self, db_session, dept):
        schedule = await self._fee_schedule(db_session, dept)
        await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW - timedelta(days=5)
        )
        assert await apply_late_fees(db_session, NOW) == 0

    async def test_a_legacy_schedule_charges_no_fee(self, db_session, dept):
        schedule = await self._fee_schedule(db_session, dept, terms_effective_at=None)
        await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW - timedelta(days=60)
        )
        assert await apply_late_fees(db_session, NOW) == 0

    async def test_lateness_before_the_terms_took_effect_is_not_charged(
        self, db_session, dept
    ):
        schedule = await self._fee_schedule(
            db_session, dept, terms_effective_at=NOW - timedelta(days=1)
        )
        await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW - timedelta(days=60)
        )
        assert await apply_late_fees(db_session, NOW) == 0

    async def test_paid_and_waived_dues_are_never_charged(self, db_session, dept):
        schedule = await self._fee_schedule(db_session, dept)
        past = NOW - timedelta(days=60)
        await _owed(
            db_session,
            dept,
            schedule,
            dept.regular,
            due_date=past,
            paid="100",
            status=DuesStatus.PAID,
        )
        await _owed(
            db_session,
            dept,
            schedule,
            dept.life,
            due_date=past,
            status=DuesStatus.WAIVED,
        )
        assert await apply_late_fees(db_session, NOW) == 0


@pytest.mark.integration
class TestReminders:
    async def _org(self, db, dept) -> Organization:
        return await db.get(Organization, dept.org_id)

    async def test_each_reminder_is_sent_once(self, db_session, dept, mailer):
        schedule = await _legacy_schedule(db_session, dept, name="Annual dues")
        soon = await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW + timedelta(days=3)
        )
        late = await _owed(
            db_session, dept, schedule, dept.life, due_date=NOW - timedelta(days=3)
        )
        org = await self._org(db_session, dept)

        assert await send_dues_reminders(db_session, org, NOW) == 2
        assert await send_dues_reminders(db_session, org, NOW) == 0

        kinds = sorted(s["template_type"] for s in mailer.sends)
        assert kinds == ["dues_reminder_due_soon", "dues_reminder_overdue"]
        assert soon.due_reminder_sent_at is not None
        assert late.overdue_reminder_sent_at is not None
        overdue = next(s for s in mailer.sends if "overdue" in s["template_type"])
        assert overdue["to"] == [dept.life.email]
        assert "$100.00" in overdue["text"]

    async def test_coming_due_then_overdue_sends_one_of_each(
        self, db_session, dept, mailer
    ):
        schedule = await _legacy_schedule(db_session, dept)
        await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW + timedelta(days=3)
        )
        org = await self._org(db_session, dept)
        await send_dues_reminders(db_session, org, NOW)
        await send_dues_reminders(db_session, org, NOW + timedelta(days=5))
        await send_dues_reminders(db_session, org, NOW + timedelta(days=6))
        assert [s["template_type"] for s in mailer.sends] == [
            "dues_reminder_due_soon",
            "dues_reminder_overdue",
        ]

    async def test_a_member_who_turned_them_off_is_not_emailed(
        self, db_session, dept, mailer
    ):
        dept.regular.notification_preferences = {
            "email_kinds": {EmailKind.DUES_REMINDERS.value: False}
        }
        await db_session.flush()
        schedule = await _legacy_schedule(db_session, dept)
        dues = await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW + timedelta(days=3)
        )
        org = await self._org(db_session, dept)
        assert await send_dues_reminders(db_session, org, NOW) == 0
        assert mailer.sends == []
        # Marked, so turning the kind back on does not deliver a backlog.
        assert dues.due_reminder_sent_at is not None

    async def test_long_overdue_dues_are_not_announced(self, db_session, dept, mailer):
        schedule = await _legacy_schedule(db_session, dept)
        await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW - timedelta(days=200)
        )
        org = await self._org(db_session, dept)
        assert await send_dues_reminders(db_session, org, NOW) == 0

    async def test_the_overdue_email_names_the_coming_late_fee(
        self, db_session, dept, mailer
    ):
        schedule = await _legacy_schedule(
            db_session,
            dept,
            late_fee_amount=Decimal("15.00"),
            grace_period_days=10,
            terms_effective_at=NOW - timedelta(days=30),
        )
        await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW - timedelta(days=2)
        )
        org = await self._org(db_session, dept)
        await send_dues_reminders(db_session, org, NOW)
        [send] = mailer.sends
        assert "late fee of $15.00" in send["text"]


@pytest.mark.integration
class TestWhatMembersAndTheTreasurerSee:
    async def test_the_payment_history_names_who_recorded_each_payment(
        self, db_session, dept
    ):
        schedule = await _legacy_schedule(db_session, dept)
        dues = await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW + timedelta(days=3)
        )
        await dept.service.record_dues_payment(
            dues.id,
            dept.org_id,
            recorded_by=dept.treasurer.id,
            amount_paid=Decimal("40"),
        )
        async with _client(db_session, dept.treasurer) as client:
            response = await client.get(f"/finance/dues/{dues.id}/payments")
        assert response.status_code == 200, response.text
        [payment] = response.json()
        assert payment["recordedByName"] == "Tess Member"

    async def test_a_member_reads_only_their_own_dues_without_a_finance_permission(
        self, db_session, dept
    ):
        schedule = await _legacy_schedule(
            db_session,
            dept,
            name="Annual dues",
            late_fee_amount=Decimal("15.00"),
            grace_period_days=10,
            terms_effective_at=NOW - timedelta(days=30),
        )
        mine = await _owed(
            db_session, dept, schedule, dept.regular, due_date=NOW + timedelta(days=3)
        )
        await _owed(
            db_session, dept, schedule, dept.life, due_date=NOW + timedelta(days=3)
        )
        await dept.service.record_dues_payment(
            mine.id,
            dept.org_id,
            recorded_by=dept.treasurer.id,
            amount_paid=Decimal("40"),
        )

        async with _client(db_session, dept.regular) as client:
            response = await client.get("/finance/my-dues")
        assert response.status_code == 200, response.text
        [row] = response.json()
        assert row["id"] == mine.id
        assert row["scheduleName"] == "Annual dues"
        assert Decimal(row["balance"]) == Decimal("60.00")
        assert Decimal(row["lateFeeAmount"]) == Decimal("15.00")
        assert row["lateFeeAfter"] is not None
        assert [Decimal(p["amount"]) for p in row["payments"]] == [Decimal("40.00")]

    async def test_the_form_is_offered_the_departments_membership_tiers(
        self, db_session, dept
    ):
        async with _client(db_session, dept.treasurer) as client:
            response = await client.get(
                "/finance/dues-schedules/membership-type-options"
            )
        assert response.status_code == 200, response.text
        ids = [option["id"] for option in response.json()]
        # The shipped ladder, as an event's "mandatory for" picker offers it.
        assert "life" in ids
        assert "active" in ids

    async def test_the_tier_list_is_the_treasurers(self, db_session, dept):
        async with _client(db_session, dept.regular) as client:
            response = await client.get(
                "/finance/dues-schedules/membership-type-options"
            )
        assert response.status_code == 403
