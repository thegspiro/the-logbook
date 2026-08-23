"""Privacy-preserving aggregates for the main dashboard widgets."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventExternalAttendee, EventRSVP, EventType
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.finance import (
    Budget,
    DuesPayment,
    DuesStatus,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYear,
    FiscalYearStatus,
    MemberDues,
)
from app.models.grant import (
    CampaignStatus,
    Donation,
    FundraisingCampaign,
    GrantApplication,
    GrantOpportunity,
    PaymentStatus,
)

PERIOD_LABELS = {
    "month": "This month",
    "quarter": "This quarter",
    "year": "This year",
    "rolling_30": "Rolling 30 days",
}
PUBLIC_EVENT_TYPES = [
    EventType.PUBLIC_EDUCATION.value,
    EventType.FUNDRAISER.value,
    EventType.CEREMONY.value,
    EventType.SOCIAL.value,
]


def period_bounds(period: str, today: date | None = None) -> tuple[datetime, datetime]:
    """Return an inclusive-start, exclusive-end UTC range for a safe period."""
    today = today or datetime.now(timezone.utc).date()
    if period == "rolling_30":
        start = today - timedelta(days=29)
    elif period == "year":
        start = date(today.year, 1, 1)
    elif period == "quarter":
        start = date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
    else:
        start = date(today.year, today.month, 1)
    return datetime.combine(start, time.min, timezone.utc), datetime.combine(
        today + timedelta(days=1), time.min, timezone.utc
    )


class DashboardWidgetService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def finance(self, organization_id: str, period: str) -> dict:
        start, end = period_bounds(period)
        now = datetime.now(timezone.utc)
        paid = await self.db.scalar(
            select(func.coalesce(func.sum(DuesPayment.amount), 0)).where(
                DuesPayment.organization_id == organization_id,
                DuesPayment.received_at >= start,
                DuesPayment.received_at < end,
            )
        )
        expenses = await self.db.scalar(
            select(func.coalesce(func.sum(ExpenseReport.total_amount), 0)).where(
                ExpenseReport.organization_id == organization_id,
                ExpenseReport.status == ExpenseReportStatus.PAID.value,
                ExpenseReport.paid_at >= start,
                ExpenseReport.paid_at < end,
            )
        )
        dues = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(MemberDues.amount_due), 0),
                    func.coalesce(func.sum(MemberDues.amount_paid), 0),
                ).where(
                    MemberDues.organization_id == organization_id,
                    MemberDues.due_date >= start,
                    MemberDues.due_date < end,
                )
            )
        ).one()
        overdue = await self.db.scalar(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                MemberDues.status.in_(
                                    [
                                        DuesStatus.PENDING.value,
                                        DuesStatus.PARTIAL.value,
                                        DuesStatus.OVERDUE.value,
                                    ]
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                )
            ).where(
                MemberDues.organization_id == organization_id,
                MemberDues.due_date < min(now, end),
            )
        )
        budget = (
            await self.db.execute(
                select(
                    func.coalesce(func.sum(Budget.amount_budgeted), 0),
                    func.coalesce(func.sum(Budget.amount_spent), 0),
                    func.coalesce(func.sum(Budget.amount_encumbered), 0),
                )
                .join(FiscalYear, FiscalYear.id == Budget.fiscal_year_id)
                .where(
                    Budget.organization_id == organization_id,
                    FiscalYear.organization_id == organization_id,
                    FiscalYear.status == FiscalYearStatus.ACTIVE.value,
                )
            )
        ).one()
        return {
            "dues_due": dues[0],
            "dues_paid": dues[1],
            "overdue_dues": overdue or 0,
            "cash_in": paid,
            "cash_out": expenses,
            "net_cash_flow": Decimal(paid) - Decimal(expenses),
            "budgeted": budget[0],
            "spent": budget[1],
            "encumbered": budget[2],
        }

    async def fundraising(self, organization_id: str, period: str) -> dict:
        start, end = period_bounds(period)
        today = datetime.now(timezone.utc).date()
        deadlines = await self.db.scalar(
            select(func.count(GrantOpportunity.id)).where(
                GrantOpportunity.organization_id == organization_id,
                GrantOpportunity.is_active.is_(True),
                GrantOpportunity.deadline_date >= max(today, start.date()),
                GrantOpportunity.deadline_date < end.date(),
            )
        )
        stages = dict(
            (
                await self.db.execute(
                    select(
                        GrantApplication.application_status,
                        func.count(GrantApplication.id),
                    )
                    .where(
                        GrantApplication.organization_id == organization_id,
                        GrantApplication.created_at >= start,
                        GrantApplication.created_at < end,
                    )
                    .group_by(GrantApplication.application_status)
                )
            ).all()
        )
        campaign_goal = await self.db.scalar(
            select(func.coalesce(func.sum(FundraisingCampaign.goal_amount), 0)).where(
                FundraisingCampaign.organization_id == organization_id,
                FundraisingCampaign.status == CampaignStatus.ACTIVE.value,
                FundraisingCampaign.active.is_(True),
                FundraisingCampaign.start_date < end.date(),
                (
                    FundraisingCampaign.end_date.is_(None)
                    | (FundraisingCampaign.end_date >= start.date())
                ),
            )
        )
        campaign_raised = await self.db.scalar(
            select(func.coalesce(func.sum(Donation.amount), 0))
            .join(FundraisingCampaign, FundraisingCampaign.id == Donation.campaign_id)
            .where(
                Donation.organization_id == organization_id,
                FundraisingCampaign.organization_id == organization_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
                Donation.donation_date >= start,
                Donation.donation_date < end,
            )
        )
        return {
            "grant_deadlines_30_days": deadlines or 0,
            "application_stages": {
                str(getattr(k, "value", k)): v for k, v in stages.items()
            },
            "campaign_raised": campaign_raised or 0,
            "campaign_goal": campaign_goal or 0,
        }

    async def community(self, organization_id: str, period: str) -> dict:
        start, end = period_bounds(period)
        public_ids = select(Event.id).where(
            Event.organization_id == organization_id,
            Event.event_type.in_(PUBLIC_EVENT_TYPES),
            Event.start_datetime >= start,
            Event.start_datetime < end,
            Event.is_cancelled.is_(False),
        )
        events = await self.db.scalar(
            select(func.count()).select_from(public_ids.subquery())
        )
        members = await self.db.scalar(
            select(func.count(EventRSVP.id)).where(
                EventRSVP.organization_id == organization_id,
                EventRSVP.checked_in.is_(True),
                EventRSVP.event_id.in_(public_ids),
            )
        )
        external = await self.db.scalar(
            select(func.count(EventExternalAttendee.id)).where(
                EventExternalAttendee.organization_id == organization_id,
                EventExternalAttendee.checked_in.is_(True),
                EventExternalAttendee.event_id.in_(public_ids),
            )
        )
        pending = await self.db.scalar(
            select(func.count(EventRequest.id)).where(
                EventRequest.organization_id == organization_id,
                EventRequest.status.in_(
                    [
                        EventRequestStatus.SUBMITTED.value,
                        EventRequestStatus.IN_PROGRESS.value,
                        EventRequestStatus.POSTPONED.value,
                    ]
                ),
            )
        )
        return {
            "public_events": events or 0,
            "member_attendees": members or 0,
            "external_attendees": external or 0,
            "pending_public_requests": pending or 0,
        }
