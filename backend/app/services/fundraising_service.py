"""
Fundraising Service

Business logic for fundraising campaigns, donors, donations, pledges,
and fundraising events. Provides dashboard aggregation and reporting.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.event import Event
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
from app.utils.model_updates import apply_updates
from app.utils.sql_ordering import nulls_last_asc
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern


def _json_safe_amounts(data: Dict[str, Any]) -> Dict[str, Any]:
    """Make ``suggested_amounts`` storable in its JSON column.

    ``FundraisingCampaign.suggested_amounts`` is a plain ``JSON`` column, but the
    schema types the field as ``List[Decimal]`` — so ``model_dump()`` hands the
    service ``Decimal`` objects and the driver's JSON encoder rejects them
    ("Object of type Decimal is not JSON serializable"), 500-ing any create or
    update that includes suggested donation amounts.

    Stored as strings rather than floats: the read side parses them straight
    back into ``Decimal`` and currency values survive the round trip exactly,
    which binary floating point cannot promise.
    """
    amounts = data.get("suggested_amounts")
    if not amounts:
        return data
    return {**data, "suggested_amounts": [str(amount) for amount in amounts]}


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
        skip: int = 0,
        limit: int = 100,
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
        # GF-35: apply skip/limit in SQL rather than fetching the whole
        # org-wide table and slicing in Python (Checklist #6 — an unbounded
        # list endpoint). Ordering already happens above, so this is a
        # behavior-preserving optimization, not a semantic change.
        query = query.offset(skip).limit(limit)
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
            **_json_safe_amounts(data),
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
        # Server-side `created_at` / `updated_at` stay expired after the flush,
        # and the response_model requires both. Pydantic reads attributes
        # synchronously, so the lazy reload raises MissingGreenlet and the POST
        # 500s on a row it did create.
        await self.db.refresh(campaign)
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
        apply_updates(
            campaign,
            _json_safe_amounts(data),
            skip={"organization_id", "id"},
        )
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
        skip: int = 0,
        limit: int = 100,
    ) -> List[Donor]:
        query = select(Donor).where(
            Donor.organization_id == organization_id,
            Donor.active.is_(True),
        )
        if donor_type:
            query = query.where(Donor.donor_type == donor_type)
        if search:
            pattern = like_pattern(search)
            query = query.where(
                (Donor.first_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR))
                | (Donor.last_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR))
                | (Donor.email.ilike(pattern, escape=LIKE_ESCAPE_CHAR))
                | (Donor.company_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR))
            )
        query = query.order_by(Donor.last_name.asc(), Donor.first_name.asc())
        query = query.offset(skip).limit(limit)
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
        # A full refresh, not just the timestamps: these models carry other
        # server-side defaults too (Donor alone has country, total_donated,
        # donation_count, is_anonymous and active), and every unloaded one
        # raises MissingGreenlet when the response model reads it.
        await self.db.refresh(donor)
        return donor

    async def update_donor(
        self, donor_id: str, organization_id: str, data: Dict[str, Any]
    ) -> Optional[Donor]:
        donor = await self.get_donor(donor_id, organization_id)
        if not donor:
            return None
        apply_updates(donor, data, skip={"organization_id", "id"})
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
        skip: int = 0,
        limit: int = 100,
    ) -> List[Donation]:
        query = select(Donation).where(Donation.organization_id == organization_id)
        if campaign_id:
            query = query.where(Donation.campaign_id == campaign_id)
        if donor_id:
            query = query.where(Donation.donor_id == donor_id)
        if start_date:
            query = query.where(
                Donation.donation_date
                >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                )
            )
        if end_date:
            # donation_date is DateTime; a bare date compares as that date's
            # midnight, silently excluding donations recorded later the same
            # day. Match reports_service.py's end-of-day boundary pattern.
            query = query.where(
                Donation.donation_date
                <= datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)
            )
        query = query.order_by(Donation.donation_date.desc())
        query = query.offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _entity_in_org(
        self, model: Any, entity_id: Any, organization_id: str
    ) -> bool:
        """Whether a row of ``model`` with ``entity_id`` is in the org.

        Client-supplied campaign/donor ids feed the campaign-total / donor-stats
        recompute (which fetches and writes the parent) — validate them in-org
        first so a donation can't corrupt another org's campaign/donor totals.
        """
        if not entity_id:
            return False
        result = await self.db.execute(
            select(model.id).where(
                model.id == str(entity_id),
                model.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none() is not None

    async def create_donation(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> Donation:
        campaign_id = data.get("campaign_id")
        donor_id = data.get("donor_id")
        if campaign_id and not await self._entity_in_org(
            FundraisingCampaign, campaign_id, organization_id
        ):
            raise ValueError("Campaign not found")
        if donor_id and not await self._entity_in_org(Donor, donor_id, organization_id):
            raise ValueError("Donor not found")

        donation = Donation(
            organization_id=organization_id,
            recorded_by=user_id,
            **data,
        )
        # Normalize the payment status so the running-total guard below sees the
        # effective value — the column's server_default only materializes in the
        # DB, so an omitted status is None on the in-memory row and would
        # otherwise skip the campaign/donor total update.
        if not donation.payment_status:
            donation.payment_status = PaymentStatus.COMPLETED

        # Lock the campaign/donor parents *before* inserting the donation
        # below. Donation.campaign_id / donor_id are FK columns — InnoDB's
        # own FK check on the INSERT takes a shared lock on the referenced
        # parent row, held until this transaction ends. If that happened
        # first, two concurrent completed donations to the same campaign (or
        # donor) would each hold a shared lock from their own FK check, then
        # both try to upgrade to the exclusive FOR UPDATE lock
        # `_update_campaign_total`/`_update_donor_stats` take below — a
        # lock-upgrade deadlock InnoDB resolves by killing one transaction
        # (an unhandled 500, not retried). Locking first, in the same order
        # the recompute below will need, avoids that.
        if donation.payment_status == PaymentStatus.COMPLETED:
            if donation.campaign_id:
                await self._lock_campaign(donation.campaign_id, organization_id)
            if donation.donor_id:
                await self._lock_donor(donation.donor_id, organization_id)

        self.db.add(donation)
        await self.db.flush()

        # Update campaign current_amount
        if donation.campaign_id and donation.payment_status == PaymentStatus.COMPLETED:
            await self._update_campaign_total(donation.campaign_id, organization_id)

        # Update donor stats
        if donation.donor_id and donation.payment_status == PaymentStatus.COMPLETED:
            await self._update_donor_stats(donation.donor_id, organization_id)

        # Refreshed last, after the total updates above: those flush again, and a
        # refresh before them would be re-expired by the time this returns.
        # created_at / updated_at are server-side defaults, and the response
        # model requires both.
        await self.db.refresh(donation)
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

        # Capture the prior campaign/donor before applying the update so a
        # reassignment (donation moved to a different campaign or donor)
        # recomputes the *old* parent too — otherwise the previous campaign's
        # current_amount and donor's total_donated stay overstated.
        old_campaign_id = donation.campaign_id
        old_donor_id = donation.donor_id

        # Validate any reassigned FK is in-org before applying — the recompute
        # below fetches and writes the referenced campaign/donor.
        if data.get("campaign_id") and not await self._entity_in_org(
            FundraisingCampaign, data["campaign_id"], organization_id
        ):
            raise ValueError("Campaign not found")
        if data.get("donor_id") and not await self._entity_in_org(
            Donor, data["donor_id"], organization_id
        ):
            raise ValueError("Donor not found")

        # Lock every campaign/donor this update could touch — old and
        # (if reassigned) new — before the update flush below, for the same
        # reason create_donation locks them before its insert.
        new_campaign_id = data.get("campaign_id", old_campaign_id)
        new_donor_id = data.get("donor_id", old_donor_id)
        for cid in {old_campaign_id, new_campaign_id} - {None}:
            await self._lock_campaign(cid, organization_id)
        for did in {old_donor_id, new_donor_id} - {None}:
            await self._lock_donor(did, organization_id)

        apply_updates(donation, data, skip={"organization_id", "id"})
        await self.db.flush()

        # Recalculate aggregates for both the old and new campaign/donor.
        for cid in {old_campaign_id, donation.campaign_id} - {None}:
            await self._update_campaign_total(cid, organization_id)
        for did in {old_donor_id, donation.donor_id} - {None}:
            await self._update_donor_stats(did, organization_id)

        return donation

    async def _lock_campaign(self, campaign_id: str, organization_id: str) -> None:
        """Acquire a FOR UPDATE lock on a campaign ahead of a child insert/update.

        Called before `create_donation`/`update_donation` flush a `Donation`
        row whose `campaign_id` FK would otherwise be the first thing to
        lock this row this transaction (see the callers for the deadlock
        this avoids).
        """
        await self.db.execute(
            select(FundraisingCampaign.id)
            .where(
                FundraisingCampaign.id == campaign_id,
                FundraisingCampaign.organization_id == organization_id,
            )
            .with_for_update()
        )

    async def _lock_donor(self, donor_id: str, organization_id: str) -> None:
        """Acquire a FOR UPDATE lock on a donor ahead of a child insert/update.

        Same reasoning as `_lock_campaign` above, for `Donation.donor_id`.
        """
        await self.db.execute(
            select(Donor.id)
            .where(
                Donor.id == donor_id,
                Donor.organization_id == organization_id,
            )
            .with_for_update()
        )

    async def _update_campaign_total(
        self, campaign_id: str, organization_id: str
    ) -> None:
        """Recalculate a campaign's running total from its donations.

        Read-then-write aggregate recompute (Pitfall #27): two donations to
        the same campaign, recorded/updated concurrently, would each read a
        stale SUM and one could overwrite the other's contribution. Lock the
        campaign row first — the parent both writers actually contend on —
        and make the SUM itself a locking read too: under REPEATABLE READ a
        plain SELECT answers from the transaction's first-read snapshot even
        after a lock is acquired elsewhere, so the row lock alone would not
        make the SUM current.
        """
        camp_result = await self.db.execute(
            select(FundraisingCampaign)
            .where(
                FundraisingCampaign.id == campaign_id,
                FundraisingCampaign.organization_id == organization_id,
            )
            .with_for_update()
        )
        campaign = camp_result.scalar_one_or_none()
        if not campaign:
            return
        result = await self.db.execute(
            select(func.coalesce(func.sum(Donation.amount), 0))
            .where(
                Donation.campaign_id == campaign_id,
                Donation.organization_id == organization_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
            )
            .with_for_update()
        )
        campaign.current_amount = result.scalar()

    async def _update_donor_stats(self, donor_id: str, organization_id: str) -> None:
        """Recalculate a donor's lifetime stats from their donations.

        Same read-then-write race as `_update_campaign_total` above — lock
        the donor row first, then make the aggregate read itself a locking
        read so it does not answer from a pre-lock snapshot.
        """
        donor_result = await self.db.execute(
            select(Donor)
            .where(
                Donor.id == donor_id,
                Donor.organization_id == organization_id,
            )
            .with_for_update()
        )
        donor = donor_result.scalar_one_or_none()
        if not donor:
            return
        result = await self.db.execute(
            select(
                func.coalesce(func.sum(Donation.amount), 0),
                func.count(Donation.id),
                func.min(Donation.donation_date),
                func.max(Donation.donation_date),
            )
            .where(
                Donation.donor_id == donor_id,
                Donation.organization_id == organization_id,
                Donation.payment_status == PaymentStatus.COMPLETED.value,
            )
            .with_for_update()
        )
        row = result.one()
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
        skip: int = 0,
        limit: int = 100,
    ) -> List[Pledge]:
        query = select(Pledge).where(Pledge.organization_id == organization_id)
        if status:
            query = query.where(Pledge.status == status)
        if campaign_id:
            query = query.where(Pledge.campaign_id == campaign_id)
        query = query.order_by(*nulls_last_asc(Pledge.due_date))
        query = query.offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _validate_pledge_fks(
        self, data: Dict[str, Any], organization_id: str
    ) -> None:
        """GF-6: campaign_id / donor_id on a pledge must be in the caller's org."""
        if data.get("campaign_id") and not await self._entity_in_org(
            FundraisingCampaign, data["campaign_id"], organization_id
        ):
            raise ValueError("Campaign not found")
        if data.get("donor_id") and not await self._entity_in_org(
            Donor, data["donor_id"], organization_id
        ):
            raise ValueError("Donor not found")

    async def create_pledge(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> Pledge:
        await self._validate_pledge_fks(data, organization_id)
        pledge = Pledge(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(pledge)
        await self.db.flush()
        # A full refresh, not just the timestamps: these models carry other
        # server-side defaults too (Donor alone has country, total_donated,
        # donation_count, is_anonymous and active), and every unloaded one
        # raises MissingGreenlet when the response model reads it.
        await self.db.refresh(pledge)
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
        await self._validate_pledge_fks(data, organization_id)
        apply_updates(pledge, data, skip={"organization_id", "id"})
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
        skip: int = 0,
        limit: int = 100,
    ) -> List[FundraisingEvent]:
        query = select(FundraisingEvent).where(
            FundraisingEvent.organization_id == organization_id
        )
        if campaign_id:
            query = query.where(FundraisingEvent.campaign_id == campaign_id)
        if status:
            query = query.where(FundraisingEvent.status == status)
        query = query.order_by(FundraisingEvent.event_date.desc())
        query = query.offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _validate_fundraising_event_fks(
        self, data: Dict[str, Any], organization_id: str
    ) -> None:
        """GF-6: campaign_id / event_id on a fundraising event must be in-org.

        ``event_id`` links to a calendar ``Event`` row; validating it in-org
        prevents attaching a fundraiser to another org's event (a mis-attributed
        FK, and a potential read of that event via the link).
        """
        if data.get("campaign_id") and not await self._entity_in_org(
            FundraisingCampaign, data["campaign_id"], organization_id
        ):
            raise ValueError("Campaign not found")
        if data.get("event_id") and not await self._entity_in_org(
            Event, data["event_id"], organization_id
        ):
            raise ValueError("Event not found")

    async def create_fundraising_event(
        self, organization_id: str, data: Dict[str, Any], user_id: str
    ) -> FundraisingEvent:
        await self._validate_fundraising_event_fks(data, organization_id)
        event = FundraisingEvent(
            organization_id=organization_id,
            created_by=user_id,
            **data,
        )
        self.db.add(event)
        await self.db.flush()
        # A full refresh, not just the timestamps: these models carry other
        # server-side defaults too (Donor alone has country, total_donated,
        # donation_count, is_anonymous and active), and every unloaded one
        # raises MissingGreenlet when the response model reads it.
        await self.db.refresh(event)
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
        await self._validate_fundraising_event_fks(data, organization_id)
        apply_updates(event, data, skip={"organization_id", "id"})
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
            query = query.where(
                Donation.donation_date
                >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                )
            )
        if end_date:
            # donation_date is DateTime; a bare date compares as that date's
            # midnight, silently excluding donations recorded later the same
            # day. Match reports_service.py's end-of-day boundary pattern.
            query = query.where(
                Donation.donation_date
                <= datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)
            )
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
