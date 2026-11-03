"""
Zeffy integration schemas.

camelCase on the wire, like the rest of the grants module these screens live
in (``schemas/grant.py``).
"""

from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.zeffy import ZeffyLinkTarget, ZeffyPaymentState
from app.schemas.base import UTCDateTime, UTCResponseBase

_response_config = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)
_request_config = ConfigDict(
    alias_generator=to_camel, populate_by_name=True, extra="forbid"
)


class ZeffyStatusResponse(UTCResponseBase):
    model_config = _response_config

    connected: bool
    integration_id: Optional[str] = None
    webhook_configured: bool = False
    last_sync_at: Optional[UTCDateTime] = None
    state_counts: dict[str, int] = Field(default_factory=dict)


class ZeffyLinkUpsert(BaseModel):
    """Where one Zeffy campaign's payments go."""

    model_config = _request_config

    target_type: ZeffyLinkTarget
    target_id: str = Field(..., min_length=1, max_length=36)
    zeffy_campaign_title: Optional[str] = Field(None, max_length=255)
    # Payments made before this are recorded but not applied. Omitted means
    # "from now on", so linking a campaign never re-counts money the
    # treasurer already entered by hand unless they choose an earlier date.
    apply_from: Optional[UTCDateTime] = None


class ZeffyLinkResponse(UTCResponseBase):
    model_config = _response_config

    id: str
    zeffy_campaign_id: str
    zeffy_campaign_title: Optional[str] = None
    target_type: ZeffyLinkTarget
    target_id: Optional[str] = None
    target_name: Optional[str] = None
    apply_from: UTCDateTime
    synced_through: Optional[UTCDateTime] = None
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ZeffyCampaignResponse(UTCResponseBase):
    """A campaign as Zeffy lists it, with the link the department made for it."""

    model_config = _response_config

    id: str
    title: Optional[str] = None
    campaign_type: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    url: Optional[str] = None
    is_archived: bool = False
    raised: Decimal = Decimal("0")
    currency: Optional[str] = None
    link: Optional[ZeffyLinkResponse] = None


class ZeffyPaymentResponse(UTCResponseBase):
    """A ledger row. The payer's email is deliberately not returned."""

    model_config = _response_config

    id: str
    zeffy_payment_id: str
    zeffy_campaign_id: Optional[str] = None
    campaign_title: Optional[str] = None
    campaign_category: Optional[str] = None
    payment_type: Optional[str] = None
    zeffy_status: Optional[str] = None
    refund_status: Optional[str] = None
    amount: Decimal
    refunded_amount: Decimal
    currency: str
    ticket_count: int
    paid_at: Optional[UTCDateTime] = None
    payer_name: Optional[str] = None
    receipt_url: Optional[str] = None
    state: ZeffyPaymentState
    state_detail: Optional[str] = None
    applied_target_type: Optional[ZeffyLinkTarget] = None
    donation_id: Optional[str] = None
    fundraising_event_id: Optional[str] = None
    member_dues_id: Optional[str] = None
    applied_amount: Decimal
    updated_at: UTCDateTime


class ZeffyPaymentListResponse(BaseModel):
    model_config = _response_config

    items: List[ZeffyPaymentResponse]
    total: int


class ZeffySyncResponse(BaseModel):
    model_config = _response_config

    links: int
    payments_read: int
    retried_applied: int
    complete: bool
    rate_limited: bool
