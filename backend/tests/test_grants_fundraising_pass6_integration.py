"""Grants & fundraising (app-review B14 pass 6).

- The dashboard's outstanding pledges count overdue pledges and never let a
  pledge lowered below what was received subtract from the rest.
- Changing a pledge's amount re-settles its status; a notes edit does not.
- The dashboard's year-to-date and twelve-month totals are bounded at the
  department's midnights, as the fundraising report is.
- Report due dates are counted from the start date, so a grant starting on
  the 31st keeps its reports at month end.
- A task marked Overdue stays on the dashboard's due list.
- A budget line's remaining amount is set when it is created and edited.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.models.grant import GrantComplianceTask, Pledge, PledgeStatus
from app.models.user import Organization, User
from app.schemas.grant import (
    DonationCreate,
    GrantApplicationCreate,
    GrantApplicationUpdate,
    GrantBudgetItemCreate,
    GrantBudgetItemUpdate,
    GrantComplianceTaskCreate,
    GrantComplianceTaskUpdate,
    PledgeUpdate,
)
from app.services.fundraising_service import FundraisingService
from app.services.grant_service import GrantService

pytestmark = pytest.mark.integration


async def _setup(db, tz="UTC"):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Pass6 VFD",
        slug=f"pass6-gf-{uuid.uuid4().hex[:8]}",
        timezone=tz,
    )
    db.add(org)
    await db.flush()
    name = f"pass6-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="P",
        last_name="Q",
        email=f"{name}@example.com",
    )
    db.add(user)
    await db.flush()
    return org.id, user.id


async def _donor(svc, org):
    return await svc.create_donor(org, {"first_name": "Ada", "last_name": "Byrne"})


async def _pledge(svc, org, user, donor_id, amount):
    return await svc.create_pledge(
        org,
        {
            "pledged_amount": Decimal(amount),
            "pledge_date": date(2026, 10, 1),
            "donor_id": donor_id,
        },
        user,
    )


async def _give(svc, org, user, donor_id, amount, pledge_id=None, when=None):
    payload = {
        "amount": amount,
        "donation_date": when or "2026-11-06T12:00:00Z",
        "payment_method": "check",
        "donor_id": donor_id,
    }
    if pledge_id:
        payload["pledge_id"] = pledge_id
    data = DonationCreate.model_validate(payload).model_dump(exclude_unset=True)
    return await svc.create_donation(org, data, user)


async def _update_pledge(svc, org, pledge_id, **fields):
    data = PledgeUpdate.model_validate(fields).model_dump(exclude_unset=True)
    return await svc.update_pledge(pledge_id, org, data)


async def _stored_pledge(db, pledge_id) -> Pledge:
    return (
        await db.execute(
            select(Pledge)
            .where(Pledge.id == pledge_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


class TestOutstandingPledges:
    async def test_an_overdue_pledge_is_still_outstanding(self, db_session):
        org, user = await _setup(db_session)
        svc = FundraisingService(db_session)
        donor = await _donor(svc, org)
        pledge = await _pledge(svc, org, user, donor.id, "500")

        await _update_pledge(svc, org, pledge.id, status="overdue")
        dashboard = await svc.get_dashboard_data(org)

        assert dashboard["outstanding_pledges"] == 500.0

    async def test_an_over_paid_pledge_does_not_subtract_from_the_rest(
        self, db_session
    ):
        org, user = await _setup(db_session)
        svc = FundraisingService(db_session)
        donor = await _donor(svc, org)
        lowered = await _pledge(svc, org, user, donor.id, "1000")
        await _give(svc, org, user, donor.id, "600", pledge_id=lowered.id)
        await _pledge(svc, org, user, donor.id, "250")
        # Lowered below what was received, with a status sent by hand so the
        # re-settling below cannot move it out of the open set.
        await _update_pledge(
            svc, org, lowered.id, pledged_amount="500.00", status="partial"
        )

        dashboard = await svc.get_dashboard_data(org)

        assert dashboard["outstanding_pledges"] == 250.0


class TestPledgeAmountEdits:
    async def test_lowering_a_pledge_to_what_was_received_fulfils_it(self, db_session):
        org, user = await _setup(db_session)
        svc = FundraisingService(db_session)
        donor = await _donor(svc, org)
        pledge = await _pledge(svc, org, user, donor.id, "1000")
        await _give(svc, org, user, donor.id, "600", pledge_id=pledge.id)

        await _update_pledge(svc, org, pledge.id, pledged_amount="500.00")

        stored = await _stored_pledge(db_session, pledge.id)
        assert stored.status == PledgeStatus.FULFILLED

    async def test_raising_a_paid_pledge_reopens_it_for_the_next_gift(self, db_session):
        org, user = await _setup(db_session)
        svc = FundraisingService(db_session)
        donor = await _donor(svc, org)
        pledge = await _pledge(svc, org, user, donor.id, "300")
        await _give(svc, org, user, donor.id, "300", pledge_id=pledge.id)

        await _update_pledge(svc, org, pledge.id, pledged_amount="900.00")
        await _give(svc, org, user, donor.id, "100", pledge_id=pledge.id)

        stored = await _stored_pledge(db_session, pledge.id)
        assert stored.status == PledgeStatus.PARTIAL
        assert stored.fulfilled_amount == Decimal("400.00")
        dashboard = await svc.get_dashboard_data(org)
        assert dashboard["outstanding_pledges"] == 500.0

    async def test_a_save_with_the_same_amount_keeps_a_status_set_by_hand(
        self, db_session
    ):
        org, user = await _setup(db_session)
        svc = FundraisingService(db_session)
        donor = await _donor(svc, org)
        pledge = await _pledge(svc, org, user, donor.id, "500")
        await _update_pledge(svc, org, pledge.id, status="fulfilled")

        # What the dialog sends for a notes edit: the unchanged amount too.
        await _update_pledge(
            svc, org, pledge.id, pledged_amount="500.00", notes="Thank-you sent"
        )

        stored = await _stored_pledge(db_session, pledge.id)
        assert stored.status == PledgeStatus.FULFILLED


class TestDashboardTotalsUseTheDepartmentsMidnight:
    async def test_new_years_eve_evening_is_last_year(self, db_session):
        tz = ZoneInfo("America/New_York")
        org, user = await _setup(db_session, tz="America/New_York")
        svc = FundraisingService(db_session)
        donor = await _donor(svc, org)
        year_start = datetime(datetime.now(tz).year, 1, 1, tzinfo=tz)
        eve = (year_start - timedelta(hours=2)).astimezone(timezone.utc)
        new_year = (year_start + timedelta(minutes=30)).astimezone(timezone.utc)
        await _give(svc, org, user, donor.id, "250", when=eve.isoformat())
        await _give(svc, org, user, donor.id, "40", when=new_year.isoformat())

        dashboard = await svc.get_dashboard_data(org)

        assert dashboard["total_raised_ytd"] == 40.0


async def _application(gs, org, user, **fields):
    data = GrantApplicationCreate.model_validate(
        {"grant_program_name": "AFG pass 6", **fields}
    ).model_dump(exclude_unset=True)
    return await gs.create_application(org, data, user)


async def _set(gs, org, user, app_id, **fields):
    data = GrantApplicationUpdate.model_validate(fields).model_dump(exclude_unset=True)
    return await gs.update_application(app_id, org, data, user)


class TestReportDueDates:
    async def test_monthly_reports_from_the_31st_stay_at_month_end(self, db_session):
        org, user = await _setup(db_session)
        gs = GrantService(db_session)
        application = await _application(
            gs,
            org,
            user,
            application_status="submitted",
            grant_start_date="2026-01-31",
            grant_end_date="2026-07-31",
            reporting_frequency="monthly",
        )

        await _set(gs, org, user, application.id, application_status="awarded")

        tasks = (
            (
                await db_session.execute(
                    select(GrantComplianceTask)
                    .where(
                        GrantComplianceTask.application_id == application.id,
                        GrantComplianceTask.task_type == "performance_report",
                    )
                    .order_by(GrantComplianceTask.due_date)
                )
            )
            .scalars()
            .all()
        )
        assert [t.due_date for t in tasks] == [
            date(2026, 2, 28),
            date(2026, 3, 31),
            date(2026, 4, 30),
            date(2026, 5, 31),
            date(2026, 6, 30),
            date(2026, 7, 31),
        ]


class TestDashboardDueTasks:
    async def test_a_task_marked_overdue_stays_on_the_due_list(self, db_session):
        org, user = await _setup(db_session)
        gs = GrantService(db_session)
        application = await _application(gs, org, user, application_status="active")
        past = datetime.now(timezone.utc).date() - timedelta(days=5)

        def task(title):
            return GrantComplianceTaskCreate.model_validate(
                {"task_type": "other", "title": title, "due_date": str(past)}
            ).model_dump(exclude_unset=True)

        await gs.create_compliance_task(application.id, org, task("Pending"), user)
        marked = await gs.create_compliance_task(
            application.id, org, task("Marked overdue"), user
        )
        await gs.update_compliance_task(
            marked.id,
            GrantComplianceTaskUpdate.model_validate({"status": "overdue"}).model_dump(
                exclude_unset=True
            ),
            user,
            org,
        )
        db_session.expire_all()

        dashboard = await gs.get_dashboard_data(org)

        assert {t.title for t in dashboard["compliance_tasks_due"]} == {
            "Pending",
            "Marked overdue",
        }


class TestBudgetLineRemaining:
    async def test_remaining_is_set_on_create_and_follows_an_edit(self, db_session):
        org, user = await _setup(db_session)
        gs = GrantService(db_session)
        application = await _application(gs, org, user, application_status="active")
        created = await gs.create_budget_item(
            application.id,
            org,
            GrantBudgetItemCreate.model_validate(
                {"category": "equipment", "amount_budgeted": "1200.00"}
            ).model_dump(exclude_unset=True),
        )
        assert created.amount_remaining == Decimal("1200.00")

        updated = await gs.update_budget_item(
            created.id,
            GrantBudgetItemUpdate.model_validate(
                {"amount_budgeted": "900.00"}
            ).model_dump(exclude_unset=True),
            org,
        )

        assert updated.amount_remaining == Decimal("900.00")
