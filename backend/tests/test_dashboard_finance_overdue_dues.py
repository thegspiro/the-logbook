"""The dashboard finance tile counts overdue dues by the dues screen's rule.

``finance_service.dues_overdue_clause`` defines an overdue record: stored
OVERDUE, or stored PENDING with its due date passed and nothing paid. A
part-paid record stays PARTIAL by design. The tile derived "overdue" from the
due date alone, so a part-paid past-due record read "overdue" on the dashboard
and "Partial" on the dues screen it links to (CLAUDE.md Pitfall #29).

Integration: the rows are written to MySQL and counted by the real query.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import DuesFrequency, DuesSchedule, DuesStatus, MemberDues
from app.services.dashboard_widget_service import DashboardWidgetService

pytestmark = [pytest.mark.integration]


async def _schedule(db: AsyncSession, org_id: str, user_id: str) -> DuesSchedule:
    schedule = DuesSchedule(
        organization_id=org_id,
        name="Annual dues",
        amount=Decimal("100.00"),
        frequency=DuesFrequency.ANNUAL,
        due_date=datetime.now(timezone.utc) - timedelta(days=10),
        created_by=user_id,
    )
    db.add(schedule)
    await db.flush()
    return schedule


def _dues(schedule: DuesSchedule, user_id: str, **overrides) -> MemberDues:
    values = {
        "organization_id": schedule.organization_id,
        "dues_schedule_id": schedule.id,
        "user_id": user_id,
        "amount_due": Decimal("100.00"),
        "amount_paid": Decimal("0.00"),
        "status": DuesStatus.PENDING,
        "due_date": datetime.now(timezone.utc) - timedelta(days=10),
    }
    values.update(overrides)
    return MemberDues(**values)


async def _overdue(db: AsyncSession, org_id: str) -> int:
    tile = await DashboardWidgetService(db).finance(org_id, "month")
    return int(tile["overdue_dues"])


class TestDashboardOverdueDues:
    async def test_part_paid_past_due_record_is_not_overdue(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        schedule = await _schedule(db_session, org_id, user_id)
        db_session.add(
            _dues(
                schedule,
                user_id,
                status=DuesStatus.PARTIAL,
                amount_paid=Decimal("40.00"),
            )
        )
        await db_session.flush()

        assert await _overdue(db_session, org_id) == 0

    async def test_unpaid_past_due_pending_record_is_overdue(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        schedule = await _schedule(db_session, org_id, user_id)
        db_session.add_all(
            [
                # Not yet persisted as OVERDUE by mark_overdue_dues: still counts.
                _dues(schedule, user_id),
                _dues(schedule, user_id, status=DuesStatus.OVERDUE),
                # Not overdue: due in the future, or settled.
                _dues(
                    schedule,
                    user_id,
                    due_date=datetime.now(timezone.utc) + timedelta(days=5),
                ),
                _dues(
                    schedule,
                    user_id,
                    status=DuesStatus.PAID,
                    amount_paid=Decimal("100.00"),
                ),
                _dues(schedule, user_id, status=DuesStatus.WAIVED),
            ]
        )
        await db_session.flush()

        assert await _overdue(db_session, org_id) == 2
