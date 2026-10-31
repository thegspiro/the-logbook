"""
Zeffy Database Models

Zeffy is a zero-fee fundraising platform: donation forms, event ticketing and
membership sales. A department keeps selling through Zeffy, which keeps issuing
the tax receipts, and the Logbook reads what Zeffy received so the department's
campaign totals, donor history, event revenue and member dues stay in one place.
Zeffy's API is read-only from our side, so nothing here ever writes back.

Two tables:

* ``zeffy_campaign_links`` — which Logbook record a Zeffy campaign feeds. A
  Zeffy campaign that is not linked is never applied to anything: guessing
  where money belongs is worse than leaving it for the treasurer.
* ``zeffy_payments`` — one row per Zeffy payment, whatever happened to it. It
  is both the idempotency key (unique per org on Zeffy's payment id) and the
  record of what was applied where, so a refund arriving later can take back
  exactly what was added and nothing else.
"""

import enum
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.encrypted_types import EncryptedText
from app.core.utils import generate_uuid


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class ZeffyLinkTarget(str, enum.Enum):
    """The kind of Logbook record a Zeffy campaign's payments are applied to."""

    # Each payment becomes a Donation on the fundraising campaign.
    FUNDRAISING_CAMPAIGN = "fundraising_campaign"
    # Each payment adds to the fundraising event's revenue and attendee count.
    FUNDRAISING_EVENT = "fundraising_event"
    # Each payment is credited to the paying member's open dues.
    DUES_SCHEDULE = "dues_schedule"


class ZeffyPaymentState(str, enum.Enum):
    """What the Logbook did with a Zeffy payment, and why."""

    # Zeffy has not finished processing it yet.
    PENDING = "pending"
    # Failed, deleted or refunded before anything was applied: nothing to do.
    IGNORED = "ignored"
    # Its campaign is not linked to a Logbook record.
    UNLINKED = "unlinked"
    # Made before the link's start date, so it predates the link and is left
    # out rather than double-counting money the treasurer entered by hand.
    BEFORE_START = "before_start"
    # A membership payment with no member or no open dues to credit.
    UNMATCHED = "unmatched"
    APPLIED = "applied"
    # Was applied, then refunded, deleted or lost to a dispute; the effect has
    # been taken back.
    REVERSED = "reversed"
    # Changed in Zeffy after it was applied in a way the Logbook will not undo
    # on its own (a refund of dues already credited, a deleted target record).
    NEEDS_REVIEW = "needs_review"


class ZeffyCampaignLink(Base):
    """Routes one Zeffy campaign's payments to one Logbook record."""

    __tablename__ = "zeffy_campaign_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    zeffy_campaign_id: Mapped[str] = mapped_column(String(120), nullable=False)
    zeffy_campaign_title: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    target_type: Mapped[ZeffyLinkTarget] = mapped_column(
        SQLEnum(ZeffyLinkTarget, values_callable=_enum_values), nullable=False
    )
    # Exactly one of these is set, matching target_type. SET NULL so deleting
    # the Logbook record leaves the link visibly pointing at nothing rather
    # than vanishing along with the history of what it applied.
    fundraising_campaign_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )
    fundraising_event_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_events.id", ondelete="SET NULL"),
        nullable=True,
    )
    dues_schedule_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("dues_schedules.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Payments made before this moment are recorded but never applied.
    apply_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # How far the sync has read this campaign's payments. Null means it has
    # not started, so it starts at apply_from.
    synced_through: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "zeffy_campaign_id",
            name="uq_zeffy_campaign_links_org_campaign",
        ),
    )

    @property
    def target_id(self) -> Optional[str]:
        if self.target_type == ZeffyLinkTarget.FUNDRAISING_CAMPAIGN:
            return self.fundraising_campaign_id
        if self.target_type == ZeffyLinkTarget.FUNDRAISING_EVENT:
            return self.fundraising_event_id
        return self.dues_schedule_id


class ZeffyPayment(Base):
    """A payment Zeffy reported, and what the Logbook applied for it."""

    __tablename__ = "zeffy_payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    zeffy_payment_id: Mapped[str] = mapped_column(String(120), nullable=False)
    zeffy_campaign_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # The peer-to-peer main page a team or participant page counts toward, so
    # linking the main campaign also catches its sub-pages.
    zeffy_parent_campaign_id: Mapped[Optional[str]] = mapped_column(
        String(120), nullable=True
    )
    campaign_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    campaign_category: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    payment_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    zeffy_status: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    refund_status: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    dispute_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    deleted_in_zeffy: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0, server_default="0"
    )
    refunded_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0, server_default="0"
    )
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="USD", server_default="USD"
    )
    ticket_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    payer_email: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    receipt_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    state: Mapped[ZeffyPaymentState] = mapped_column(
        SQLEnum(ZeffyPaymentState, values_callable=_enum_values),
        nullable=False,
        default=ZeffyPaymentState.UNLINKED,
        server_default="unlinked",
    )
    state_detail: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Where the payment was applied, and how much of it. Kept even after a
    # reversal so the history of what moved stays readable.
    applied_target_type: Mapped[Optional[ZeffyLinkTarget]] = mapped_column(
        SQLEnum(ZeffyLinkTarget, values_callable=_enum_values), nullable=True
    )
    donation_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("donations.id", ondelete="SET NULL"), nullable=True
    )
    fundraising_event_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("fundraising_events.id", ondelete="SET NULL"),
        nullable=True,
    )
    member_dues_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("member_dues.id", ondelete="SET NULL"), nullable=True
    )
    # What is currently counted on the target. A later change applies the
    # difference between this and the payment's new net, never the whole
    # amount again.
    applied_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=0, server_default="0"
    )
    applied_tickets: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # Zeffy's payment with the buyer's address, email and checkout answers
    # removed (see zeffy_service.redact_payment), kept so a wrong match can
    # be worked out after the fact.
    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    last_event_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "zeffy_payment_id",
            name="uq_zeffy_payments_org_payment",
        ),
        Index("ix_zeffy_payments_org_state", "organization_id", "state"),
        Index("ix_zeffy_payments_org_campaign", "organization_id", "zeffy_campaign_id"),
        Index("ix_zeffy_payments_org_paid", "organization_id", "paid_at"),
    )
