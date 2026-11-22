"""
Zeffy integration endpoints (Grants & Fundraising).

The department connects Zeffy on the Integrations page; these endpoints are
where it decides what each Zeffy campaign feeds and watches what arrived.
Mounted under ``/grants/zeffy`` behind the grants module gate.

Linking a campaign to a dues schedule routes membership payments to members'
dues — a finance action — so it also needs ``finance.manage``, the permission
that records a dues payment by hand. A membership payment is then held until a
holder of that permission confirms whose dues it pays (ADV2-11).
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.finance import DuesSchedule
from app.models.grant import FundraisingCampaign, FundraisingEvent
from app.models.integration import Integration
from app.models.user import User
from app.models.zeffy import (
    ZeffyCampaignLink,
    ZeffyLinkTarget,
    ZeffyPayment,
    ZeffyPaymentState,
)
from app.schemas.zeffy import (
    ZeffyCampaignResponse,
    ZeffyDuesCandidateResponse,
    ZeffyDuesConfirm,
    ZeffyDuesMatchResponse,
    ZeffyLinkResponse,
    ZeffyLinkUpsert,
    ZeffyPaymentListResponse,
    ZeffyPaymentResponse,
    ZeffyStatusResponse,
    ZeffySyncResponse,
)
from app.services.integration_services.zeffy_service import (
    ZeffyClient,
    ZeffyError,
    api_key_from_integration,
    cents,
    webhook_secret_from_integration,
)
from app.services.zeffy_sync_service import (
    NOT_AWAITING,
    ZeffyPaymentNotFound,
    ZeffySyncService,
)

router = APIRouter()

_TARGET_MODELS: Dict[ZeffyLinkTarget, Any] = {
    ZeffyLinkTarget.FUNDRAISING_CAMPAIGN: FundraisingCampaign,
    ZeffyLinkTarget.FUNDRAISING_EVENT: FundraisingEvent,
    ZeffyLinkTarget.DUES_SCHEDULE: DuesSchedule,
}
_TARGET_COLUMNS = {
    ZeffyLinkTarget.FUNDRAISING_CAMPAIGN: "fundraising_campaign_id",
    ZeffyLinkTarget.FUNDRAISING_EVENT: "fundraising_event_id",
    ZeffyLinkTarget.DUES_SCHEDULE: "dues_schedule_id",
}


def _as_utc(moment: datetime) -> datetime:
    """MySQL hands DATETIME back without tzinfo; every stored time is UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def _integration(db: AsyncSession, organization_id: str) -> Optional[Integration]:
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == "zeffy",
        )
    )
    return result.scalar_one_or_none()


async def _connected_integration(db: AsyncSession, organization_id: str) -> Integration:
    integration = await _integration(db, organization_id)
    if (
        integration is None
        or not integration.enabled
        or integration.status != "connected"
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Connect Zeffy on the Integrations page first.",
        )
    return integration


def _require_dues_permission(user: User, target_type: ZeffyLinkTarget) -> None:
    if target_type == ZeffyLinkTarget.DUES_SCHEDULE and not user_has_permission(
        user, "finance.manage"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Linking a campaign to member dues requires finance.manage.",
        )


async def _target_name(
    db: AsyncSession,
    organization_id: str,
    target_type: ZeffyLinkTarget,
    target_id: Optional[str],
) -> Optional[str]:
    """The target's name if it is a live record of this organization, else None."""
    if not target_id:
        return None
    model = _TARGET_MODELS[target_type]
    query = select(model.name).where(
        model.id == target_id, model.organization_id == organization_id
    )
    if target_type == ZeffyLinkTarget.FUNDRAISING_CAMPAIGN:
        # Same rule as FundraisingService.get_campaign: a deleted campaign
        # takes no new records.
        query = query.where(FundraisingCampaign.active.is_(True))
    name = await db.scalar(query)
    return str(name) if name is not None else None


async def _link_response(
    db: AsyncSession, link: ZeffyCampaignLink
) -> ZeffyLinkResponse:
    response = ZeffyLinkResponse.model_validate(link)
    response.target_id = link.target_id
    response.target_name = await _target_name(
        db, link.organization_id, link.target_type, link.target_id
    )
    return response


async def _links_by_campaign(
    db: AsyncSession, organization_id: str
) -> Dict[str, ZeffyCampaignLink]:
    links = (
        await db.scalars(
            select(ZeffyCampaignLink).where(
                ZeffyCampaignLink.organization_id == organization_id
            )
        )
    ).all()
    return {link.zeffy_campaign_id: link for link in links}


@router.get("/status", response_model=ZeffyStatusResponse)
async def get_zeffy_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """Whether Zeffy is connected, and how many payments sit in each state."""
    organization_id = str(current_user.organization_id)
    integration = await _integration(db, organization_id)
    rows = await db.execute(
        select(ZeffyPayment.state, func.count(ZeffyPayment.id))
        .where(ZeffyPayment.organization_id == organization_id)
        .group_by(ZeffyPayment.state)
    )
    counts = {
        (state.value if isinstance(state, ZeffyPaymentState) else str(state)): int(n)
        for state, n in rows.all()
    }
    connected = bool(
        integration and integration.enabled and integration.status == "connected"
    )
    return ZeffyStatusResponse(
        connected=connected,
        integration_id=str(integration.id) if integration else None,
        webhook_configured=bool(
            integration and webhook_secret_from_integration(integration)
        ),
        last_sync_at=integration.last_sync_at if integration else None,
        state_counts=counts,
    )


@router.get("/campaigns", response_model=list[ZeffyCampaignResponse])
async def list_zeffy_campaigns(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """Zeffy's campaigns, read live, each with the link made for it if any."""
    organization_id = str(current_user.organization_id)
    integration = await _connected_integration(db, organization_id)
    try:
        campaigns = await ZeffyClient(
            api_key_from_integration(integration)
        ).list_campaigns()
    except ZeffyError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    links = await _links_by_campaign(db, organization_id)
    response = []
    for campaign in campaigns:
        campaign_id = str(campaign.get("id") or "")
        if not campaign_id or campaign.get("deleted_at"):
            continue
        link = links.get(campaign_id)
        response.append(
            ZeffyCampaignResponse(
                id=campaign_id,
                title=campaign.get("title"),
                campaign_type=campaign.get("type"),
                category=campaign.get("category"),
                status=campaign.get("status"),
                url=campaign.get("url"),
                is_archived=bool(campaign.get("is_archived")),
                raised=cents(campaign.get("volume")),
                currency=(campaign.get("currency") or None),
                link=await _link_response(db, link) if link else None,
            )
        )
    return response


@router.get("/links", response_model=list[ZeffyLinkResponse])
async def list_zeffy_links(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    organization_id = str(current_user.organization_id)
    links = await _links_by_campaign(db, organization_id)
    return [await _link_response(db, link) for link in links.values()]


@router.put("/links/{zeffy_campaign_id}", response_model=ZeffyLinkResponse)
async def upsert_zeffy_link(
    zeffy_campaign_id: str,
    data: ZeffyLinkUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """Link a Zeffy campaign to a Logbook record, or change its link.

    Payments already applied stay where they were applied; the new link
    governs payments not yet applied.
    """
    organization_id = str(current_user.organization_id)
    campaign_id = zeffy_campaign_id.strip()
    if not campaign_id or len(campaign_id) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Zeffy campaign id"
        )
    _require_dues_permission(current_user, data.target_type)
    await _connected_integration(db, organization_id)
    if (
        await _target_name(db, organization_id, data.target_type, data.target_id)
        is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected record was not found.",
        )

    result = await db.execute(
        select(ZeffyCampaignLink)
        .where(
            ZeffyCampaignLink.organization_id == organization_id,
            ZeffyCampaignLink.zeffy_campaign_id == campaign_id,
        )
        .with_for_update()
    )
    link = result.scalar_one_or_none()
    if link is not None:
        _require_dues_permission(current_user, link.target_type)
    apply_from = data.apply_from or (
        link.apply_from if link is not None else datetime.now(timezone.utc)
    )
    if link is None:
        link = ZeffyCampaignLink(
            organization_id=organization_id,
            zeffy_campaign_id=campaign_id,
            created_by=str(current_user.id),
        )
        db.add(link)
    elif _as_utc(apply_from) != _as_utc(link.apply_from):
        # The sync's place belongs to the old start. An earlier start also
        # wants payments the sync has already passed over, so the campaign is
        # read again from the new one.
        if _as_utc(apply_from) < _as_utc(link.apply_from):
            link.synced_through = None
        link.sync_window_end = None
        link.sync_cursor = None

    link.target_type = data.target_type
    for target_type, column in _TARGET_COLUMNS.items():
        setattr(
            link, column, data.target_id if target_type == data.target_type else None
        )
    link.apply_from = apply_from
    if data.zeffy_campaign_title:
        link.zeffy_campaign_title = data.zeffy_campaign_title
    await db.flush()

    try:
        applied = await ZeffySyncService(db).retry_unapplied(
            organization_id, zeffy_campaign_id=campaign_id
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    await db.commit()
    await db.refresh(link)
    await log_audit_event(
        db=db,
        event_type="zeffy_campaign_linked",
        event_category="fundraising",
        severity="info",
        event_data={
            "organization_id": organization_id,
            "zeffy_campaign_id": campaign_id,
            "target_type": data.target_type.value,
            "target_id": data.target_id,
            "apply_from": apply_from.isoformat(),
            "payments_applied": applied,
        },
        user_id=str(current_user.id),
        organization_id=organization_id,
    )
    return await _link_response(db, link)


@router.delete("/links/{zeffy_campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_zeffy_link(
    zeffy_campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """Stop applying a campaign's payments. What was applied stays applied."""
    organization_id = str(current_user.organization_id)
    result = await db.execute(
        select(ZeffyCampaignLink).where(
            ZeffyCampaignLink.organization_id == organization_id,
            ZeffyCampaignLink.zeffy_campaign_id == zeffy_campaign_id,
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Link not found"
        )
    _require_dues_permission(current_user, link.target_type)
    await db.delete(link)
    await db.commit()
    await log_audit_event(
        db=db,
        event_type="zeffy_campaign_unlinked",
        event_category="fundraising",
        severity="info",
        event_data={
            "organization_id": organization_id,
            "zeffy_campaign_id": zeffy_campaign_id,
        },
        user_id=str(current_user.id),
        organization_id=organization_id,
    )


@router.get("/payments", response_model=ZeffyPaymentListResponse)
async def list_zeffy_payments(
    state: Optional[ZeffyPaymentState] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """The payments Zeffy reported, newest first."""
    organization_id = str(current_user.organization_id)
    filters = [ZeffyPayment.organization_id == organization_id]
    if state is not None:
        filters.append(ZeffyPayment.state == state)
    total = await db.scalar(select(func.count(ZeffyPayment.id)).where(*filters))
    rows = (
        await db.scalars(
            select(ZeffyPayment)
            .where(*filters)
            .order_by(ZeffyPayment.paid_at.desc(), ZeffyPayment.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    awaiting = await _awaiting_dues_confirmation(db, organization_id, rows)
    items = []
    for row in rows:
        item = ZeffyPaymentResponse.model_validate(row)
        item.awaiting_dues_confirmation = row.id in awaiting
        items.append(item)
    return ZeffyPaymentListResponse(items=items, total=int(total or 0))


async def _awaiting_dues_confirmation(
    db: AsyncSession, organization_id: str, rows: Any
) -> set[str]:
    """Ids of the rows a treasurer can confirm: held, and linked to dues.

    Resolved as ``ZeffySyncService._link_for`` does: the payment's own
    campaign's link first, else its peer-to-peer main page's.
    """
    held = [
        row
        for row in rows
        if row.state == ZeffyPaymentState.UNMATCHED and row.applied_target_type is None
    ]
    campaign_ids = {
        campaign_id
        for row in held
        for campaign_id in (row.zeffy_campaign_id, row.zeffy_parent_campaign_id)
        if campaign_id
    }
    if not campaign_ids:
        return set()
    links = {
        link.zeffy_campaign_id: link
        for link in (
            await db.scalars(
                select(ZeffyCampaignLink).where(
                    ZeffyCampaignLink.organization_id == organization_id,
                    ZeffyCampaignLink.zeffy_campaign_id.in_(campaign_ids),
                )
            )
        ).all()
    }
    awaiting: set[str] = set()
    for row in held:
        link = links.get(row.zeffy_campaign_id or "") or links.get(
            row.zeffy_parent_campaign_id or ""
        )
        if (
            link is not None
            and link.target_type == ZeffyLinkTarget.DUES_SCHEDULE
            and link.dues_schedule_id is not None
        ):
            awaiting.add(row.id)
    return awaiting


@router.get(
    "/payments/{zeffy_payment_id}/dues-match", response_model=ZeffyDuesMatchResponse
)
async def get_zeffy_dues_match(
    zeffy_payment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """What a treasurer needs to confirm a held membership payment (ADV2-11).

    The payment's net amount, the member whose email the payer typed (a
    suggestion only), and every current member with open dues on the linked
    schedule, with what their oldest open dues still owe. Requires
    ``finance.manage``. 404 for a payment not in the department; 409 for one
    not waiting for a dues confirmation.
    """
    organization_id = str(current_user.organization_id)
    try:
        match = await ZeffySyncService(db).dues_match(organization_id, zeffy_payment_id)
    except ZeffyPaymentNotFound:
        raise HTTPException(status_code=404, detail="Zeffy payment not found")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=safe_error_detail(e)
        )
    return ZeffyDuesMatchResponse(
        zeffy_payment_id=match.payment.zeffy_payment_id,
        net_amount=match.net_amount,
        currency=match.payment.currency,
        payer_name=match.payment.payer_name,
        suggested_user_id=match.suggested_user_id,
        candidates=[
            ZeffyDuesCandidateResponse(
                user_id=c.user_id,
                name=c.name,
                member_dues_id=c.member_dues_id,
                balance=c.balance,
            )
            for c in match.candidates
        ],
    )


@router.post(
    "/payments/{zeffy_payment_id}/confirm-dues", response_model=ZeffyPaymentResponse
)
async def confirm_zeffy_dues_payment(
    zeffy_payment_id: str,
    data: ZeffyDuesConfirm,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """Credit a held membership payment to the member a treasurer chose.

    ADV2-11, owner decision 2026-11-21: a Zeffy membership payment is never
    credited on the payer's typed email alone. Requires ``finance.manage``,
    like recording a dues payment by hand. The member may be anyone current
    with open dues on the linked schedule; the email match is only a
    suggestion. An overpayment is refused (400) unless ``excessAsDonation``,
    and the treasurer may not credit their own dues (400). 404 for a payment
    not in the department; 409 for one not waiting for a dues confirmation.
    """
    organization_id = str(current_user.organization_id)
    service = ZeffySyncService(db)
    try:
        row = await service.confirm_dues(
            organization_id,
            zeffy_payment_id,
            member_id=data.user_id,
            confirmed_by=str(current_user.id),
            excess_as_donation=data.excess_as_donation,
        )
    except ZeffyPaymentNotFound:
        raise HTTPException(status_code=404, detail="Zeffy payment not found")
    except ValueError as e:
        # Nothing was written before the refusal: the service checks first,
        # and record_dues_payment refuses before it appends to the ledger.
        code = (
            status.HTTP_409_CONFLICT
            if str(e) == NOT_AWAITING
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=safe_error_detail(e))
    await db.commit()
    await db.refresh(row)
    await log_audit_event(
        db=db,
        event_type="zeffy_dues_payment_confirmed",
        event_category="finance",
        severity="warning",
        event_data={
            "organization_id": organization_id,
            "zeffy_payment_id": zeffy_payment_id,
            "target_user_id": data.user_id,
            "member_dues_id": row.member_dues_id,
            "amount": str(row.applied_amount),
            "excess_as_donation": data.excess_as_donation,
        },
        user_id=str(current_user.id),
        organization_id=organization_id,
    )
    return ZeffyPaymentResponse.model_validate(row)


@router.post("/sync", response_model=ZeffySyncResponse)
async def sync_zeffy_now(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """Run the hourly sync now for this department."""
    organization_id = str(current_user.organization_id)
    integration = await _connected_integration(db, organization_id)
    try:
        counts = await ZeffySyncService(db).sync_integration(integration)
    except ZeffyError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except ValueError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info(
        "Zeffy sync run by user {} for org {}: {} payments read",
        current_user.id,
        organization_id,
        counts.get("payments_read"),
    )
    return ZeffySyncResponse(
        links=int(counts["links"]),
        payments_read=int(counts["payments_read"]),
        retried_applied=int(counts["retried_applied"]),
        complete=bool(counts["complete"]),
        rate_limited=bool(counts["rate_limited"]),
    )
