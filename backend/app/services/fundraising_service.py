"""
Fundraising Service

Business logic for fundraising campaigns, donors, donations, pledges,
and fundraising events. Provides dashboard aggregation and reporting.
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.grant import (
    CampaignStatus,
    Donation,
    Donor,
    FundraisingCampaign,
    FundraisingEvent,
    PaymentStatus,
    Pledge,
    PledgeStatus,
)


class FundraisingService:
    """Service for fundraising management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Campaigns
    # ------------------------------------------------------------------

    async def list_campaigns(
        self,
        organization_id: str,
        status: Optional[str] = None,
        campaign_type: Optional[str] = None,
    ) -> List[FundraisingCampaign]:
        query = select(FundraisingCampaign).where(
            FundraisingCampaign.organization_id == organization_id,
            FundraisingCampaign.active.is_(True),
        )
        if status:
            query = query.where(FundraisingCampaign.status == status)
        if campaign_type:
            query = query.where(FundraisingCampaign.campaign_type == campaign_type)
        query = query.order_by(FundraisingCampaign.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_campaign(
        self, campaign_id: str, organization_id: str
    ) -> Optional[FundraisingCampaign]:
        result = await self.db.execute(
            select(FundraisingCampaign).where(
                FundraisingCampaign.id == campaign_id,
                FundraisingCampaign.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_campaign(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> FundraisingCampaign:
        campaign = FundraisingCampaign(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(campaign)
        await self.db.flush()
        await log_audit_event(
            db=self.db,
            event_type="campaign_created",
            event_category="fundraising",
            severity="info",
            event_data={"campaign_id": campaign.id, "name": campaign.name},
            user_id=user_id,
        )
        return campaign

    async def update_campaign(
        self,
        campaign_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[FundraisingCampaign]:
        campaign = await self.get_campaign(campaign_id, organization_id)
        if not campaign:
            return None
        for key, value in data.items():
            setattr(campaign, key, value)
        await self.db.flush()
        return campaign

    async def delete_campaign(self, campaign_id: str, organization_id: str) -> bool:
        campaign = await self.get_campaign(campaign_id, organization_id)
        if not campaign:
            return False
        campaign.active = False
        await self.db.flush()
        return True

    # ------------------------------------------------------------------
    # Donors
    # ------------------------------------------------------------------

    async def list_donors(
        self,
        organization_id: str,
        donor_type: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[Donor]:
        query = select(Donor).where(
            Donor.organization_id == organization_id,
            Donor.active.is_(True),
        )
        if donor_type:
            query = query.where(Donor.donor_type == donor_type)
        if search:
            pattern = f"%{search}%"
            query = query.where(
                (Donor.first_name.ilike(pattern))
                | (Donor.last_name.ilike(pattern))
                | (Donor.email.ilike(pattern))
                | (Donor.company_name.ilike(pattern))
            )
        query = query.order_by(Donor.last_name.asc(), Donor.first_name.asc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_donor(self, donor_id: str, organization_id: str) -> Optional[Donor]:
        result = await self.db.execute(
            select(Donor).where(
                Donor.id == donor_id,
                Donor.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_donor(self, organization_id: str, data: Dict[str, Any]) -> Donor:
        donor = Donor(organization_id=organization_id, **data)
        self.db.add(donor)
        await self.db.flush()
        return donor

    async def update_donor(
        self, donor_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[Donor]:
        donor = await self.get_donor(donor_id, organization_id)
        if not donor:
            return None
        for key, value in data.items():
            setattr(donor, key, value)
        await self.db.flush()
        return donor

    # ------------------------------------------------------------------
    # Donations
    # ------------------------------------------------------------------

    async def list_donations(
        self,
        organization_id: str,
        campaign_id: Optional[str] = None,
        donor_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Donation]:
        query = select(Donation).where(Donation.organization_id == organization_id)
        if campaign_id:
            query = query.where(Donation.campaign_id == campaign_id)
        if donor_id:
            query = query.where(Donation.donor_id == donor_id)
        if start_date:
            query = query.where(Donation.donation_date >= start_date)
        if end_date:
            query = query.where(Donation.donation_date <= end_date)
        query = query.order_by(Donation.donation_date.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_donation(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> Donation:
        donation = Donation(
            organization_id=organization_id,
            recorded_by=user_id,
            **data,
        )
        self.db.add(donation)
        await self.db.flush()

        # Update campaign current_amount
        if donation.campaign_id and donation.payment_status == PaymentStatus.COMPLETED:
            await self._update_campaign_total(donation.campaign_id)

        # Update donor stats
        if donation.donor_id and donation.payment_status == PaymentStatus.COMPLETED:
            await self._update_donor_stats(donation.donor_id)

        return donation

    async def update_donation(
        self, donation_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[Donation]:
        result = await self.db.execute(
            select(Donation).where(
                Donation.id == donation_id,
                Donation.organization_id == organization_id,
            )
        )
        donation = result.scalar_one_or_none()
        if not donation:
            return None

        for key, value in data.items():
            setattr(donation, key, value)
        await self.db.flush()

        # Recalculate aggregates
        if donation.campaign_id:
            await self._update_campaign_total(donation.campaign_id)
        if donation.donor_id:
            await self._update_donor_stats(donation.donor_id)

        return donation

    async def _update_campaign_total(self, campaign_id: str) -> None:
        result = await self.db.execute(
            select(func.coalesce(func.sum(Donation.amount), 0)).where(
                Donation.campaign_id == campaign_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
            )
        )
        total = result.scalar()
        camp_result = await self.db.execute(
            select(FundraisingCampaign).where(FundraisingCampaign.id == campaign_id)
        )
        campaign = camp_result.scalar_one_or_none()
        if campaign:
            campaign.current_amount = total

    async def _update_donor_stats(self, donor_id: str) -> None:
        result = await self.db.execute(
            select(
                func.coalesce(func.sum(Donation.amount), 0),
                func.count(Donation.id),
                func.min(Donation.donation_date),
                func.max(Donation.donation_date),
            ).where(
                Donation.donor_id == donor_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
            )
        )
        row = result.one()
        donor_result = await self.db.execute(select(Donor).where(Donor.id == donor_id))
        donor = donor_result.scalar_one_or_none()
        if donor:
            donor.total_donated = row[0]
            donor.donation_count = row[1]
            donor.first_donation_date = row[2].date() if row[2] else None
            donor.last_donation_date = row[3].date() if row[3] else None

    # ------------------------------------------------------------------
    # Pledges
    # ------------------------------------------------------------------

    async def list_pledges(
        self,
        organization_id: str,
        status: Optional[str] = None,
        campaign_id: Optional[str] = None,
    ) -> List[Pledge]:
        query = select(Pledge).where(Pledge.organization_id == organization_id)
        if status:
            query = query.where(Pledge.status == status)
        if campaign_id:
            query = query.where(Pledge.campaign_id == campaign_id)
        query = query.order_by(Pledge.due_date.asc().nulls_last())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_pledge(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> Pledge:
        pledge = Pledge(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(pledge)
        await self.db.flush()
        return pledge

    async def update_pledge(
        self, pledge_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[Pledge]:
        result = await self.db.execute(
            select(Pledge).where(
                Pledge.id == pledge_id,
                Pledge.organization_id == organization_id,
            )
        )
        pledge = result.scalar_one_or_none()
        if not pledge:
            return None
        for key, value in data.items():
            setattr(pledge, key, value)
        await self.db.flush()
        return pledge

    # ------------------------------------------------------------------
    # Fundraising Events
    # ------------------------------------------------------------------

    async def list_fundraising_events(
        self,
        organization_id: str,
        campaign_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[FundraisingEvent]:
        query = select(FundraisingEvent).where(
            FundraisingEvent.organization_id == organization_id
        )
        if campaign_id:
            query = query.where(FundraisingEvent.campaign_id == campaign_id)
        if status:
            query = query.where(FundraisingEvent.status == status)
        query = query.order_by(FundraisingEvent.event_date.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_fundraising_event(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> FundraisingEvent:
        event = FundraisingEvent(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(event)
        await self.db.flush()
        return event

    async def update_fundraising_event(
        self,
        event_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[FundraisingEvent]:
        result = await self.db.execute(
            select(FundraisingEvent).where(
                FundraisingEvent.id == event_id,
                FundraisingEvent.organization_id == organization_id,
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            return None
        for key, value in data.items():
            setattr(event, key, value)
        await self.db.flush()
        return event

    # ------------------------------------------------------------------
    # Dashboard & Reporting
    # ------------------------------------------------------------------

    async def get_dashboard_data(self, organization_id: str) -> Dict[str, Any]:
        """Aggregate fundraising dashboard data."""
        today = date.today()
        year_start = date(today.year, 1, 1)
        twelve_months_ago = today - timedelta(days=365)

        # Total raised YTD
        ytd_result = await self.db.execute(
            select(func.coalesce(func.sum(Donation.amount), 0)).where(
                Donation.organization_id == organization_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
                Donation.donation_date >= year_start,
            )
        )
        total_raised_ytd = float(ytd_result.scalar() or 0)

        # Total raised last 12 months
        twelve_mo_result = await self.db.execute(
            select(func.coalesce(func.sum(Donation.amount), 0)).where(
                Donation.organization_id == organization_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
                Donation.donation_date >= twelve_months_ago,
            )
        )
        total_raised_12mo = float(twelve_mo_result.scalar() or 0)

        # Active campaigns
        campaigns_result = await self.db.execute(
            select(FundraisingCampaign).where(
                FundraisingCampaign.organization_id == organization_id,
                FundraisingCampaign.status == CampaignStatus.ACTIVE.value,
                FundraisingCampaign.active.is_(True),
            )
        )
        active_campaigns = list(campaigns_result.scalars().all())

        # Recent donations
        recent_result = await self.db.execute(
            select(Donation)
            .where(
                Donation.organization_id == organization_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
            )
            .order_by(Donation.donation_date.desc())
            .limit(10)
        )
        recent_donations = list(recent_result.scalars().all())

        # Donor count
        donor_count_result = await self.db.execute(
            select(func.count(Donor.id)).where(
                Donor.organization_id == organization_id,
                Donor.active.is_(True),
            )
        )
        total_donors = donor_count_result.scalar() or 0

        # Outstanding pledges
        pledges_result = await self.db.execute(
            select(
                func.coalesce(
                    func.sum(Pledge.pledged_amount - Pledge.fulfilled_amount), 0
                )
            ).where(
                Pledge.organization_id == organization_id,
                Pledge.status.in_(
                    [PledgeStatus.PENDING.value, PledgeStatus.PARTIAL.value]
                ),
            )
        )
        outstanding_pledges = float(pledges_result.scalar() or 0)

        return {
            "total_raised_ytd": total_raised_ytd,
            "total_raised_12mo": total_raised_12mo,
            "active_campaigns": active_campaigns,
            "active_campaigns_count": len(active_campaigns),
            "recent_donations": recent_donations,
            "total_donors": total_donors,
            "outstanding_pledges": outstanding_pledges,
        }

    async def get_fundraising_report(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Generate a fundraising performance report."""
        query = select(Donation).where(
            Donation.organization_id == organization_id,
            Donation.payment_status == PaymentStatus.COMPLETED.value,
        )
        if start_date:
            query = query.where(Donation.donation_date >= start_date)
        if end_date:
            query = query.where(Donation.donation_date <= end_date)
        result = await self.db.execute(query)
        donations = list(result.scalars().all())

        total_donations = sum(float(d.amount) for d in donations)
        unique_donors = len({d.donor_id for d in donations if d.donor_id})
        average_gift = total_donations / len(donations) if donations else 0

        # Donations by payment method
        by_method: Dict[str, float] = {}
        for d in donations:
            method = (
                d.payment_method.value
                if hasattr(d.payment_method, "value")
                else d.payment_method
            )
            by_method[method] = by_method.get(method, 0) + float(d.amount)

        # Monthly totals
        monthly_totals: Dict[str, float] = {}
        for d in donations:
            month_key = d.donation_date.strftime("%Y-%m")
            monthly_totals[month_key] = monthly_totals.get(month_key, 0) + float(
                d.amount
            )

        return {
            "total_donations": total_donations,
            "donation_count": len(donations),
            "unique_donors": unique_donors,
            "average_gift": round(average_gift, 2),
            "donations_by_method": by_method,
            "monthly_totals": [
                {"month": k, "total": v} for k, v in sorted(monthly_totals.items())
            ],
        }
