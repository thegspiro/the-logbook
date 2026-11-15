"""Members asking for a leave of absence, and the leave notices sent once.

A department that turns requests on lets a member ask for leave rather than
wait for an officer to record it. The department chooses who decides (one or
more positions) and how (any one approver, a majority, or all of them); an
approval creates the leave exactly as an officer recording it would.

``LeaveNoticeSend`` is the claim each scheduled leave email takes before it
goes out: the reminder that a leave is ending and the monthly digest of
open-ended leaves. One row per department, kind and key, unique, so a re-run
or a racing worker sends nothing (CLAUDE.md pitfall #36).
"""

import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
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
from app.models.user import LeaveType


class LeaveRequestStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    WITHDRAWN = "withdrawn"


class LeaveDecisionRule(str, enum.Enum):
    """How the department's approvers decide a request.

    - ``any``      -- the first approver to approve or deny settles it.
    - ``majority`` -- approved once more than half of the current approvers
      approve; denied once that can no longer happen.
    - ``all``      -- approved once every current approver approves; denied
      by any one denial.
    """

    ANY = "any"
    MAJORITY = "majority"
    ALL = "all"


class LeaveVote(str, enum.Enum):
    APPROVE = "approve"
    DENY = "deny"


class LeaveRequest(Base):
    """One member's request for a leave of absence.

    ``decision_rule`` is the department's rule when the request was made,
    kept on the row so a later change to the setting does not move the bar
    for a request already being voted on. ``reason`` is encrypted at rest:
    members explain a leave in their own words, often medical or family
    detail. ``leave_id`` is the leave an approval created; SET NULL so the
    request stays on record if that leave is later deleted.
    """

    __tablename__ = "leave_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    leave_type: Mapped[LeaveType] = mapped_column(
        Enum(LeaveType, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=LeaveType.LEAVE_OF_ABSENCE,
        server_default=LeaveType.LEAVE_OF_ABSENCE.value,
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    # None = no end date yet.
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    status: Mapped[LeaveRequestStatus] = mapped_column(
        Enum(LeaveRequestStatus, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=LeaveRequestStatus.PENDING,
        server_default=LeaveRequestStatus.PENDING.value,
    )
    decision_rule: Mapped[LeaveDecisionRule] = mapped_column(
        Enum(LeaveDecisionRule, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=LeaveDecisionRule.ANY,
        server_default=LeaveDecisionRule.ANY.value,
    )
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The approver whose vote settled it.
    decided_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    leave_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("member_leaves_of_absence.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_leave_requests_org_status", "organization_id", "status"),
        Index("ix_leave_requests_org_user", "organization_id", "user_id"),
    )


class LeaveRequestVote(Base):
    """One approver's vote on one request. One per approver, by constraint."""

    __tablename__ = "leave_request_votes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("leave_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    voter_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    vote: Mapped[LeaveVote] = mapped_column(
        Enum(LeaveVote, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    # The approver's words; encrypted, as they may answer the reason.
    note: Mapped[Optional[str]] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("request_id", "voter_id", name="uq_leave_request_vote"),
        Index("ix_leave_request_votes_org_request", "organization_id", "request_id"),
    )


class LeaveNoticeSend(Base):
    """A scheduled leave email claimed before it is sent.

    ``kind`` names the email and ``key`` what it was about: a leave's id and
    end date for the ending reminder (so moving the end date earns a new
    reminder), the month for the open-ended digest. The claim is taken and
    committed before the email goes out and released if the send fails, so a
    process that dies after claiming sends nothing (at most once): a missed
    reminder costs the member a nudge, a repeated one their trust in the mail.
    """

    __tablename__ = "leave_notice_sends"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "kind", "key", name="uq_leave_notice_send"),
    )
