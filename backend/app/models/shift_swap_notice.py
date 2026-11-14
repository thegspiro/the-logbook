"""
Open Shift Swap Notices

One row per member told, by a bell entry, that a seat they are cleared for was
offered as an open swap (W33-4, owner decision 2026-11-01: bell entry only).

The row exists to make the fan-out safe to run twice (Pitfall #36). Its key is
the *seat* — the offering shift and the member giving it up — and the recipient,
not the swap request's id: a member who double-taps "Ask for cover", or whose
client retries a POST that timed out after it was processed, creates a second
open swap for the same seat, and keying on the request would tell everyone
twice. The unique constraint is what catches two fan-outs racing past the
lookup. Consequence, deliberate: a member who withdraws an open swap and posts
the same seat again does not re-notify the members already told about it; the
seat is on their Requests tab either way.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class OpenSwapNotice(Base):
    """One member told about one open-swap seat; makes the fan-out run once."""

    __tablename__ = "open_swap_notices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    offering_shift_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False
    )
    offered_by_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    recipient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The request that prompted the notice, for tracing. Not part of the key.
    swap_request_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("shift_swap_requests.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "offering_shift_id",
            "offered_by_id",
            "recipient_id",
            name="uq_open_swap_notices_seat_recipient",
        ),
        Index("ix_open_swap_notices_org", "organization_id"),
    )
