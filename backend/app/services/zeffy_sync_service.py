"""
Zeffy payment ingestion

Turns what Zeffy reports into Logbook records. Two paths feed it, and both go
through ``ZeffySyncService.record_payment``:

* the signed webhook (``app/api/public/zeffy_webhook.py``) — seconds after a
  payment, and the only path that sees a refund made long after the sale;
* the hourly sync (``sync_integration``) — reads each linked campaign's
  payments by creation date, so nothing is lost while the webhook is not set up
  or Zeffy's retries ran out.

Idempotency (Pitfall #36). ``zeffy_payments`` is unique per organization on
Zeffy's payment id, and every change to a payment runs under a ``FOR UPDATE``
lock on its row. The row records what was applied and where
(``applied_amount`` / ``applied_tickets``), and a later change applies only the
difference between that and the payment's new net. So the webhook and the sync
can both report the same payment any number of times, in any order, and the
target moves once.

Where a payment goes is decided only by a ``ZeffyCampaignLink`` the department
made. A payment whose campaign has no link is recorded and left alone: guessing
which campaign or which member's dues it belongs to would put money in the
wrong place with nothing to show it happened.

Effects by link target:

* fundraising campaign — one Donation per payment, through
  ``FundraisingService`` so campaign and donor totals recompute exactly as for
  a gift entered by hand. A refund lowers the donation or marks it refunded.
* fundraising event — the payment's net adds to ``actual_revenue`` and its
  tickets to ``current_attendees``. Both stay hand-editable, which is why the
  sync adds its difference rather than overwriting them.
* dues schedule — the payer is matched to a member by email, and the payment
  is credited to that member's oldest open dues on the schedule through
  ``FinanceService.record_dues_payment``. A refund after that is flagged for the
  treasurer, never reversed automatically: the dues ledger has no reversal, and
  undoing a payment a member has been told was received is a human decision.
"""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Optional, overload

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import email_fingerprints
from app.models.finance import DuesStatus, MemberDues
from app.models.grant import (
    DedicationType,
    Donation,
    Donor,
    DonorType,
    FundraisingEvent,
    PaymentMethod,
    PaymentStatus,
    RecurringFrequency,
)
from app.models.integration import Integration
from app.models.user import User
from app.models.zeffy import (
    ZeffyCampaignLink,
    ZeffyLinkTarget,
    ZeffyPayment,
    ZeffyPaymentState,
)
from app.services.integration_services.zeffy_service import (
    ParsedPayment,
    ZeffyClient,
    ZeffyError,
    ZeffyRateLimited,
    api_key_from_integration,
    parse_payment,
    redact_payment,
)

# Each sync re-reads this far behind where it got to, so a payment Zeffy
# finished processing (or partly refunded) shortly after it was created is
# seen again in its settled state.
SYNC_OVERLAP = timedelta(days=7)
# Payments are read one creation-date window at a time, oldest first, and a
# link's progress advances only after a window is read in full. The list's
# sort order is undocumented, so this is what keeps a run that stops part way
# from skipping anything.
SYNC_WINDOW = timedelta(days=30)
# Zeffy allows 100 requests a minute per organization. A run stays well
# inside that so the webhook's own lookups are not starved.
MAX_REQUESTS_PER_RUN = 60
# Ledger rows re-examined per run after a link is added or dues are generated.
MAX_RETRIES_PER_RUN = 500

DUES_PAYMENT_METHOD = "zeffy"

_OPEN_DUES = (DuesStatus.PENDING, DuesStatus.PARTIAL, DuesStatus.OVERDUE)
_RETRYABLE = (
    ZeffyPaymentState.UNLINKED,
    ZeffyPaymentState.UNMATCHED,
    ZeffyPaymentState.BEFORE_START,
)
_RECURRING = {
    "weekly": RecurringFrequency.WEEKLY,
    "monthly": RecurringFrequency.MONTHLY,
    "quarterly": RecurringFrequency.QUARTERLY,
    "yearly": RecurringFrequency.ANNUALLY,
    "annually": RecurringFrequency.ANNUALLY,
    "annual": RecurringFrequency.ANNUALLY,
}
_DEDICATION = {
    "in_honour_of": DedicationType.IN_HONOR,
    "in_memory_of": DedicationType.IN_MEMORY,
}
_METHODS = {
    "card": PaymentMethod.CREDIT_CARD,
    "cash": PaymentMethod.CASH,
    "check": PaymentMethod.CHECK,
    "cheque": PaymentMethod.CHECK,
    "ach": PaymentMethod.BANK_TRANSFER,
    "pad": PaymentMethod.BANK_TRANSFER,
    "bank_transfer": PaymentMethod.BANK_TRANSFER,
}


@overload
def _utc(moment: datetime) -> datetime:
    """A stored time read as UTC; a naive one is UTC by convention."""


@overload
def _utc(moment: None) -> None:
    """No time in, no time out."""


def _utc(moment: Optional[datetime]) -> Optional[datetime]:
    if moment is None:
        return None
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _reference(zeffy_payment_id: str) -> str:
    return f"zeffy:{zeffy_payment_id}"


class ZeffySyncService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    async def record_payment(
        self,
        organization_id: str,
        zeffy_payment_id: str,
        payment: Optional[Dict[str, Any]],
    ) -> Optional[ZeffyPayment]:
        """Record Zeffy's current state of one payment and apply it.

        ``payment`` is None when Zeffy says the payment no longer exists. A
        payment we never saw that is already gone leaves nothing to record.
        """
        parsed = parse_payment(payment) if payment is not None else None
        if parsed is not None and parsed.zeffy_payment_id != zeffy_payment_id:
            raise ZeffyError(
                "Zeffy returned a different payment than the one asked for"
            )

        row = await self._locked_row(organization_id, zeffy_payment_id)
        if row is None:
            if parsed is None:
                return None
            row = await self._insert_row(organization_id, zeffy_payment_id)

        if parsed is None:
            row.deleted_in_zeffy = True
        else:
            row.deleted_in_zeffy = False
            self._copy_fields(row, parsed, payment or {})
        row.last_event_at = datetime.now(timezone.utc)

        await self._reconcile(row, parsed)
        await self.db.flush()
        return row

    async def _locked_row(
        self, organization_id: str, zeffy_payment_id: str
    ) -> Optional[ZeffyPayment]:
        result = await self.db.execute(
            select(ZeffyPayment)
            .where(
                ZeffyPayment.organization_id == organization_id,
                ZeffyPayment.zeffy_payment_id == zeffy_payment_id,
            )
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def _insert_row(
        self, organization_id: str, zeffy_payment_id: str
    ) -> ZeffyPayment:
        row = ZeffyPayment(
            organization_id=organization_id,
            zeffy_payment_id=zeffy_payment_id,
            state=ZeffyPaymentState.UNLINKED,
            amount=Decimal("0"),
            refunded_amount=Decimal("0"),
            applied_amount=Decimal("0"),
            applied_tickets=0,
            ticket_count=0,
        )
        try:
            async with self.db.begin_nested():
                self.db.add(row)
                await self.db.flush()
        except IntegrityError:
            # The webhook and the sync raced to insert the same payment; the
            # other one's row is the payment's row.
            existing = await self._locked_row(organization_id, zeffy_payment_id)
            if existing is None:
                raise
            return existing
        # Taking the lock on the row we just inserted keeps the rest of the
        # function identical whichever branch produced it.
        locked = await self._locked_row(organization_id, zeffy_payment_id)
        return locked or row

    @staticmethod
    def _copy_fields(
        row: ZeffyPayment, parsed: ParsedPayment, payment: Dict[str, Any]
    ) -> None:
        row.zeffy_campaign_id = parsed.campaign_id
        row.zeffy_parent_campaign_id = parsed.parent_campaign_id
        row.campaign_title = parsed.campaign_title
        row.campaign_category = parsed.campaign_category
        row.payment_type = parsed.payment_type
        row.zeffy_status = parsed.status
        row.refund_status = parsed.refund_status
        row.dispute_status = parsed.dispute_status
        row.amount = parsed.amount
        row.refunded_amount = parsed.refunded_amount
        row.currency = parsed.currency
        row.ticket_count = parsed.ticket_count
        row.paid_at = parsed.paid_at
        row.payer_name = parsed.payer_name
        row.payer_email = parsed.payer_email
        row.receipt_url = parsed.receipt_url
        row.raw_payload = redact_payment(payment)

    # ------------------------------------------------------------------
    # Applying
    # ------------------------------------------------------------------

    async def _reconcile(
        self, row: ZeffyPayment, parsed: Optional[ParsedPayment]
    ) -> None:
        """Bring what is applied for ``row`` in line with Zeffy's current state."""
        counts = parsed is not None and parsed.counts
        net = parsed.net_amount if parsed is not None and counts else Decimal("0")
        tickets = parsed.ticket_count if parsed is not None and counts else 0

        if row.applied_target_type is not None:
            await self._adjust_applied(row, parsed, net, tickets)
            return

        if parsed is None or not counts:
            row.state = (
                ZeffyPaymentState.PENDING
                if parsed is not None and parsed.status == "pending"
                else ZeffyPaymentState.IGNORED
            )
            row.state_detail = self._not_counted_reason(row, parsed)
            return

        link = await self._link_for(row)
        if link is None:
            row.state = ZeffyPaymentState.UNLINKED
            row.state_detail = "This Zeffy campaign is not linked to a Logbook record."
            return
        if link.target_id is None:
            row.state = ZeffyPaymentState.UNLINKED
            row.state_detail = (
                "The Logbook record this campaign was linked to was deleted."
            )
            return
        paid_at = _utc(row.paid_at)
        if paid_at is not None and paid_at < _utc(link.apply_from):
            row.state = ZeffyPaymentState.BEFORE_START
            row.state_detail = (
                "Made before the link's start date, so it was not applied."
            )
            return

        if link.target_type == ZeffyLinkTarget.FUNDRAISING_CAMPAIGN:
            await self._apply_donation(row, parsed, link, net)
        elif link.target_type == ZeffyLinkTarget.FUNDRAISING_EVENT:
            await self._apply_event(row, link, net, tickets)
        else:
            await self._apply_dues(row, parsed, link, net)

    @staticmethod
    def _not_counted_reason(row: ZeffyPayment, parsed: Optional[ParsedPayment]) -> str:
        if parsed is None or row.deleted_in_zeffy:
            return "Deleted in Zeffy."
        if parsed.status == "pending":
            return "Zeffy has not finished processing this payment."
        if parsed.status != "succeeded":
            return f"Zeffy reports this payment as {parsed.status or 'unknown'}."
        if parsed.dispute_status == "lost":
            return "The payer's dispute was lost."
        return "Refunded in full."

    async def _link_for(self, row: ZeffyPayment) -> Optional[ZeffyCampaignLink]:
        """The link for this payment's campaign, else its peer-to-peer main page."""
        for campaign_id in (row.zeffy_campaign_id, row.zeffy_parent_campaign_id):
            if not campaign_id:
                continue
            result = await self.db.execute(
                select(ZeffyCampaignLink).where(
                    ZeffyCampaignLink.organization_id == row.organization_id,
                    ZeffyCampaignLink.zeffy_campaign_id == campaign_id,
                )
            )
            link = result.scalar_one_or_none()
            if link is not None:
                return link
        return None

    async def _apply_donation(
        self,
        row: ZeffyPayment,
        parsed: ParsedPayment,
        link: ZeffyCampaignLink,
        net: Decimal,
    ) -> None:
        from app.services.fundraising_service import FundraisingService

        service = FundraisingService(self.db)
        donor_id = await self._donor_for(parsed, row.organization_id)
        interval = (parsed.recurring_interval or "").lower()
        notes = "Received through Zeffy."
        if parsed.receipt_url:
            notes += f" Tax receipt: {parsed.receipt_url}"
        try:
            donation = await service.create_donation(
                row.organization_id,
                {
                    "campaign_id": link.fundraising_campaign_id,
                    "donor_id": donor_id,
                    "amount": net,
                    "currency": parsed.currency,
                    "donation_date": parsed.paid_at or datetime.now(timezone.utc),
                    "payment_method": _METHODS.get(
                        (parsed.payment_method_type or "").lower(), PaymentMethod.OTHER
                    ),
                    "payment_status": PaymentStatus.COMPLETED,
                    "transaction_id": _reference(parsed.zeffy_payment_id),
                    "is_recurring": bool(interval),
                    "recurring_frequency": _RECURRING.get(interval),
                    "donor_name": None if donor_id else parsed.payer_name,
                    "donor_email": None if donor_id else parsed.payer_email,
                    "dedication_type": _DEDICATION.get(parsed.tribute_type or ""),
                    "dedication_name": parsed.tribute_name,
                    "notes": notes,
                    "custom_fields": {"zeffy_payment_id": parsed.zeffy_payment_id},
                },
                None,
            )
        except ValueError as exc:
            # Nothing was applied, so the payment waits like an unlinked one
            # and is retried once the link points at a live campaign.
            row.state = ZeffyPaymentState.UNLINKED
            row.state_detail = f"Could not record the donation: {exc}"[:255]
            return
        row.applied_target_type = ZeffyLinkTarget.FUNDRAISING_CAMPAIGN
        row.donation_id = donation.id
        row.applied_amount = net
        row.state = ZeffyPaymentState.APPLIED
        row.state_detail = None

    async def _donor_for(
        self, parsed: ParsedPayment, organization_id: str
    ) -> Optional[str]:
        """The donor this payer already is, or a new one if they can be named.

        A payer with no usable name stays on the donation as free text rather
        than becoming a donor record the fundraising screens would refuse.
        """
        from app.services.fundraising_service import FundraisingService

        fingerprints = email_fingerprints(parsed.payer_email)
        if fingerprints:
            existing = await self.db.scalar(
                select(Donor.id)
                .where(
                    Donor.organization_id == organization_id,
                    Donor.email_hash.in_(fingerprints),
                )
                .order_by(Donor.created_at)
                .limit(1)
            )
            if existing:
                return str(existing)

        data: Dict[str, Any] = {
            "first_name": parsed.payer_first_name,
            "last_name": parsed.payer_last_name,
            "email": parsed.payer_email,
            "donor_type": (
                DonorType.BUSINESS if parsed.payer_company else DonorType.INDIVIDUAL
            ),
            "company_name": parsed.payer_company,
        }
        try:
            donor = await FundraisingService(self.db).create_donor(
                organization_id, data
            )
        except ValueError:
            return None
        return str(donor.id)

    async def _locked_event(
        self, organization_id: str, event_id: Optional[str]
    ) -> Optional[FundraisingEvent]:
        if not event_id:
            return None
        result = await self.db.execute(
            select(FundraisingEvent)
            .where(
                FundraisingEvent.id == event_id,
                FundraisingEvent.organization_id == organization_id,
            )
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def _apply_event(
        self,
        row: ZeffyPayment,
        link: ZeffyCampaignLink,
        net: Decimal,
        tickets: int,
    ) -> None:
        event = await self._locked_event(row.organization_id, link.fundraising_event_id)
        if event is None:
            row.state = ZeffyPaymentState.UNLINKED
            row.state_detail = (
                "The Logbook record this campaign was linked to was deleted."
            )
            return
        row.applied_target_type = ZeffyLinkTarget.FUNDRAISING_EVENT
        row.fundraising_event_id = event.id
        self._move_event_totals(row, event, net, tickets)

    @staticmethod
    def _move_event_totals(
        row: ZeffyPayment, event: FundraisingEvent, net: Decimal, tickets: int
    ) -> None:
        # Floors at zero: a treasurer may have lowered the hand-kept figure
        # since, and a refund must not drive it negative.
        event.actual_revenue = max(
            (event.actual_revenue or Decimal("0")) + net - row.applied_amount,
            Decimal("0"),
        )
        event.current_attendees = max(
            (event.current_attendees or 0) + tickets - row.applied_tickets, 0
        )
        row.applied_amount = net
        row.applied_tickets = tickets
        if net > 0 or tickets > 0:
            row.state = ZeffyPaymentState.APPLIED
            row.state_detail = None
        else:
            row.state = ZeffyPaymentState.REVERSED
            row.state_detail = (
                "Taken back off the event after Zeffy refunded or removed it."
            )

    async def _apply_dues(
        self,
        row: ZeffyPayment,
        parsed: ParsedPayment,
        link: ZeffyCampaignLink,
        net: Decimal,
    ) -> None:
        from app.services.finance_service import FinanceService

        fingerprints = email_fingerprints(parsed.payer_email)
        member_id = None
        if fingerprints:
            member_id = await self.db.scalar(
                select(User.id).where(
                    User.organization_id == row.organization_id,
                    User.email_hash.in_(fingerprints),
                    User.deleted_at.is_(None),
                )
            )
        if member_id is None:
            row.state = ZeffyPaymentState.UNMATCHED
            row.state_detail = "No member has the email address the payer used."
            return

        dues_id = await self.db.scalar(
            select(MemberDues.id)
            .where(
                MemberDues.organization_id == row.organization_id,
                MemberDues.dues_schedule_id == link.dues_schedule_id,
                MemberDues.user_id == member_id,
                MemberDues.status.in_(_OPEN_DUES),
            )
            .order_by(MemberDues.due_date)
            .limit(1)
        )
        if dues_id is None:
            row.state = ZeffyPaymentState.UNMATCHED
            row.state_detail = "The member has no open dues on the linked schedule."
            return

        try:
            await FinanceService(self.db).record_dues_payment(
                str(dues_id),
                row.organization_id,
                recorded_by=None,
                amount_paid=net,
                payment_method=DUES_PAYMENT_METHOD,
                transaction_reference=_reference(parsed.zeffy_payment_id),
                notes="Paid through Zeffy.",
                # The department's rule for any overpayment (W66-3): what is
                # beyond the balance is a donation from the member.
                excess_as_donation=True,
            )
        except ValueError as exc:
            row.state = ZeffyPaymentState.UNMATCHED
            row.state_detail = str(exc)[:255]
            return
        row.applied_target_type = ZeffyLinkTarget.DUES_SCHEDULE
        row.member_dues_id = str(dues_id)
        row.applied_amount = net
        row.state = ZeffyPaymentState.APPLIED
        row.state_detail = None

    async def _adjust_applied(
        self,
        row: ZeffyPayment,
        parsed: Optional[ParsedPayment],
        net: Decimal,
        tickets: int,
    ) -> None:
        """Move an already-applied payment's effect to its new net.

        It stays on the record it was first applied to, even if the link has
        since been pointed elsewhere: moving money between records is a
        decision for the treasurer, not a side effect of editing a link.
        """
        if row.applied_target_type == ZeffyLinkTarget.FUNDRAISING_EVENT:
            event = await self._locked_event(
                row.organization_id, row.fundraising_event_id
            )
            if event is None:
                row.state = ZeffyPaymentState.NEEDS_REVIEW
                row.state_detail = (
                    "The fundraising event it was applied to was deleted."
                )
                return
            self._move_event_totals(row, event, net, tickets)
            return

        if row.applied_target_type == ZeffyLinkTarget.DUES_SCHEDULE:
            if net == row.applied_amount:
                row.state = ZeffyPaymentState.APPLIED
                row.state_detail = None
                return
            row.state = ZeffyPaymentState.NEEDS_REVIEW
            row.state_detail = (
                f"Changed in Zeffy after ${row.applied_amount:.2f} was credited to "
                f"dues; it now stands at ${net:.2f}. Adjust the dues by hand."
            )
            return

        await self._adjust_donation(row, net)

    async def _adjust_donation(self, row: ZeffyPayment, net: Decimal) -> None:
        from app.services.fundraising_service import FundraisingService

        if row.donation_id is None:
            row.state = ZeffyPaymentState.NEEDS_REVIEW
            row.state_detail = "The donation it created was deleted in the Logbook."
            return
        donation = await self.db.scalar(
            select(Donation).where(
                Donation.id == row.donation_id,
                Donation.organization_id == row.organization_id,
            )
        )
        if donation is None:
            row.state = ZeffyPaymentState.NEEDS_REVIEW
            row.state_detail = "The donation it created was deleted in the Logbook."
            return

        if net > 0:
            wanted: Dict[str, Any] = {
                "amount": net,
                "payment_status": PaymentStatus.COMPLETED,
            }
            state = ZeffyPaymentState.APPLIED
            detail = None
        else:
            # The amount stays as given so the refunded gift still reads as
            # what was given; REFUNDED takes it out of every total.
            wanted = {"payment_status": PaymentStatus.REFUNDED}
            state = ZeffyPaymentState.REVERSED
            detail = "Marked refunded after Zeffy refunded or removed it."

        unchanged = all(
            getattr(donation, key) == value for key, value in wanted.items()
        )
        if not unchanged:
            await FundraisingService(self.db).update_donation(
                str(donation.id), row.organization_id, wanted
            )
        row.applied_amount = net
        row.state = state
        row.state_detail = detail

    # ------------------------------------------------------------------
    # Re-examining
    # ------------------------------------------------------------------

    async def retry_unapplied(
        self,
        organization_id: str,
        zeffy_campaign_id: Optional[str] = None,
        limit: int = MAX_RETRIES_PER_RUN,
    ) -> int:
        """Re-apply payments that were waiting on a link, a start date or dues.

        Runs after a link is saved and on every sync, so a campaign linked
        today picks up the payments already recorded for it, and a membership
        payment that arrived before its dues were generated is credited once
        they are.
        """
        query = select(ZeffyPayment.zeffy_payment_id).where(
            ZeffyPayment.organization_id == organization_id,
            ZeffyPayment.state.in_(_RETRYABLE),
        )
        if zeffy_campaign_id:
            query = query.where(
                or_(
                    ZeffyPayment.zeffy_campaign_id == zeffy_campaign_id,
                    ZeffyPayment.zeffy_parent_campaign_id == zeffy_campaign_id,
                )
            )
        ids = list(
            (
                await self.db.scalars(query.order_by(ZeffyPayment.paid_at).limit(limit))
            ).all()
        )
        applied = 0
        for payment_id in ids:
            row = await self._locked_row(organization_id, payment_id)
            if row is None or row.state not in _RETRYABLE or not row.raw_payload:
                continue
            parsed = parse_payment(row.raw_payload)
            # The stored payload has had the email removed; the encrypted
            # column still holds it, and matching a member needs it.
            parsed = replace(parsed, payer_email=row.payer_email)
            await self._reconcile(row, parsed)
            if row.state == ZeffyPaymentState.APPLIED:
                applied += 1
        await self.db.flush()
        return applied

    # ------------------------------------------------------------------
    # Polling
    # ------------------------------------------------------------------

    async def sync_integration(
        self,
        integration: Integration,
        now: Optional[datetime] = None,
        client: Optional[ZeffyClient] = None,
    ) -> Dict[str, Any]:
        """Read every linked campaign's recent payments, then retry the waiting ones.

        Commits after each window so a run that stops part way keeps what it
        read. Raises ZeffyError when Zeffy refuses the key, so the caller can
        put that in front of the department; a rate limit ends the run quietly.
        """
        organization_id = str(integration.organization_id)
        client = client or ZeffyClient(api_key_from_integration(integration))
        end = _utc(now) or datetime.now(timezone.utc)

        links = list(
            (
                await self.db.scalars(
                    select(ZeffyCampaignLink)
                    .where(ZeffyCampaignLink.organization_id == organization_id)
                    .order_by(ZeffyCampaignLink.created_at)
                )
            ).all()
        )
        budget = MAX_REQUESTS_PER_RUN
        recorded = 0
        rate_limited = False
        complete = True
        for link in links:
            try:
                budget, seen, done = await self._sync_link(client, link, end, budget)
            except ZeffyRateLimited:
                rate_limited = True
                complete = False
                break
            recorded += seen
            if not done:
                complete = False
                break

        retried = await self.retry_unapplied(organization_id)
        await self.db.commit()
        if rate_limited:
            logger.info(
                "Zeffy sync for org {} stopped at the rate limit", organization_id
            )
        return {
            "organization_id": organization_id,
            "links": len(links),
            "payments_read": recorded,
            "retried_applied": retried,
            "complete": complete,
            "rate_limited": rate_limited,
        }

    async def _sync_link(
        self,
        client: ZeffyClient,
        link: ZeffyCampaignLink,
        end: datetime,
        budget: int,
    ) -> tuple[int, int, bool]:
        """Read one link's payments forward from where it got to.

        Returns the request budget left, the payments read, and whether the
        link is now read up to ``end``.
        """
        apply_from = _utc(link.apply_from)
        synced = _utc(link.synced_through)
        start = max(synced - SYNC_OVERLAP, apply_from) if synced else apply_from
        seen = 0
        while start < end:
            window_end = min(start + SYNC_WINDOW, end)
            cursor: Optional[str] = None
            while True:
                if budget <= 0:
                    return budget, seen, False
                budget -= 1
                page = await client.list_payments_page(
                    campaign_id=link.zeffy_campaign_id,
                    created_gte=int(start.timestamp()),
                    created_lt=int(window_end.timestamp()),
                    starting_after=cursor,
                )
                for payment in page.get("data") or []:
                    if not isinstance(payment, dict) or not payment.get("id"):
                        continue
                    await self.record_payment(
                        link.organization_id, str(payment["id"]), payment
                    )
                    seen += 1
                cursor = page.get("next_cursor")
                if not page.get("has_more") or not cursor:
                    break
            link.synced_through = window_end
            await self.db.commit()
            start = window_end
        return budget, seen, True
