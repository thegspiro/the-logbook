"""
Attendance Waiver Requests

A member asks to be excused from one session that counts against them, and a
routed approver decides (owner decisions, 2026-11-10). One table serves both
workflows; ``workflow`` says which department policy governs a row. Only
``training_session`` is written today.

Writes go through ``AttendanceWaiverService``, which owns the rules the
database cannot express: the deadline, the cap, who may decide, and the
Chief's override of a denial.
"""

import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.encrypted_types import EncryptedText
from app.core.utils import generate_uuid


class AttendanceWaiverWorkflow(str, enum.Enum):
    """Which kind of attendance a request excuses."""

    TRAINING_SESSION = "training_session"
    # Reserved for the business-meeting workflow; nothing writes it yet.
    BUSINESS_MEETING = "business_meeting"


class AttendanceWaiverStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    WITHDRAWN = "withdrawn"
    VOIDED = "voided"


class AttendanceWaiverAction(str, enum.Enum):
    SUBMITTED = "submitted"
    WITHDRAWN = "withdrawn"
    APPROVED = "approved"
    DENIED = "denied"
    CHIEF_OVERRIDE = "chief_override"
    VOIDED = "voided"


# The statuses that hold a session's one request open. A denied request stays
# live so the member cannot ask again for the same session; withdrawing frees
# the slot, and so does voiding.
LIVE_STATUSES = (
    AttendanceWaiverStatus.PENDING,
    AttendanceWaiverStatus.APPROVED,
    AttendanceWaiverStatus.DENIED,
)


def live_key_for(workflow: str, event_id: str, user_id: str) -> str:
    """The value of ``live_key`` while a request holds its session open."""
    return f"{workflow}:{event_id}:{user_id}"


class AttendanceWaiverRequest(Base):
    """One member's request to be excused from one session.

    **One live request per member and session, enforced by the database.**
    MySQL has no partial unique index, so ``live_key`` carries the
    ``workflow:event:user`` triple while the request is pending, approved or
    denied, and NULL once it is withdrawn or voided; the unique key then
    admits one live row and any number of closed ones, because MySQL treats
    NULLs as distinct. A withdrawn request therefore stays in the history and
    the member may ask again as a new row.

    **``event_id`` is SET NULL, not CASCADE.** The request is the member's
    record of having been excused; deleting the event must not erase it, so
    the title, start and local date are snapshotted when the request is made
    and the row survives the event. ``session_date`` is that local date, the
    one the cap counts by.

    ``reason`` is encrypted at rest for the reason ``TrainingWaiver.reason``
    is: a member asking to be excused often says why in medical terms.
    """

    __tablename__ = "attendance_waiver_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    workflow: Mapped[AttendanceWaiverWorkflow] = mapped_column(
        Enum(AttendanceWaiverWorkflow, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    event_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="SET NULL"), nullable=True
    )
    event_title_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    event_start_snapshot: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[AttendanceWaiverStatus] = mapped_column(
        Enum(AttendanceWaiverStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=AttendanceWaiverStatus.PENDING,
        server_default=AttendanceWaiverStatus.PENDING.value,
    )
    live_key: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, unique=True
    )
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    chief_override: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index(
            "ix_attendance_waiver_requests_org_workflow_status",
            "organization_id",
            "workflow",
            "status",
        ),
        Index(
            "ix_attendance_waiver_requests_org_user_date",
            "organization_id",
            "user_id",
            "session_date",
        ),
        Index("ix_attendance_waiver_requests_event", "event_id"),
    )


class AttendanceWaiverRequestAction(Base):
    """The decision log: one row per thing that happened to a request.

    A Chief's override does not replace the denial it overturns; both rows
    stay, so who denied and who overrode are both on record. ``note`` is the
    decider's words and is encrypted for the same reason the request's reason
    is.
    """

    __tablename__ = "attendance_waiver_request_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("attendance_waiver_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[AttendanceWaiverAction] = mapped_column(
        Enum(AttendanceWaiverAction, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    actor_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index(
            "ix_attendance_waiver_request_actions_org_request",
            "organization_id",
            "request_id",
        ),
    )


class AttendanceWaiverEmailSend(Base):
    """One email sent, or being sent, about one decision-log row.

    **The idempotency key is ``(action_id, recipient_key)``**, unique: the
    log row says what happened (submitted, decided, withdrawn), and the
    recipient key who was told. A send claims its row before the email goes
    out, so a second run for the same action, and a second worker racing the
    first, finds the claim and sends nothing (CLAUDE.md pitfall #36).

    ``recipient_key`` is ``user:<member id>`` for a member and
    ``addr:<fingerprint>`` for an address a template CCs, so no address is
    stored in plain text here. ``sent_at`` is NULL while the send is in
    flight; a send that fails releases its claim so a retry can try again,
    and a process that dies between claiming and sending leaves the claim in
    place: that email is not sent (at most once). A duplicate approval prompt
    is a nuisance, but the in-app prompt already reaches every approver, so a
    lost email loses nothing the member depends on.
    """

    __tablename__ = "attendance_waiver_email_sends"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("attendance_waiver_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    action_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("attendance_waiver_request_actions.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_key: Mapped[str] = mapped_column(String(80), nullable=False)
    # A template's CC copy rather than the notice its recipient acts on.
    is_copy: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "action_id",
            "recipient_key",
            name="uq_attendance_waiver_email_sends_action_recipient",
        ),
        Index(
            "ix_attendance_waiver_email_sends_org_request",
            "organization_id",
            "request_id",
        ),
    )
