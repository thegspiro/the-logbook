"""
Driver Qualification Exception Service

EVOC enforcement is a hard block: a member without the certification an
apparatus requires cannot be assigned or sign up as its driver. This service
owns the sanctioned way around that block — a chief-approved, time-boxed
exception for parades, special events, and non-emergency movements where a
legacy member may legitimately be behind the wheel.

The controls are deliberate and each one is load-bearing:

* **Separation of duties.** The requester cannot approve their own request
  (reuses ``assert_different_person``, the same control the finance, skills-
  testing, and admin-hours approval paths use).
* **Chief-level permission.** Approval requires
  ``apparatus.approve_driver_exception``, which only the chief ranks hold by
  default — not every officer who can fill a roster.
* **Bounded validity.** ``valid_until`` is mandatory. There is no permanent
  waiver of a safety control; an exception for one parade cannot become a
  standing qualification by inertia.
* **Audit trail.** Approve, deny, and revoke are logged by the endpoint layer.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import get_rank_default_permissions, permission_matches
from app.models.apparatus import (
    Apparatus,
    DriverException,
    DriverExceptionStatus,
)
from app.models.user import User
from app.services.separation_of_duties import assert_different_person
from app.utils.org_scoping import assert_in_org

# The grant that lets someone approve. Named once so the enforcement message,
# the endpoint gate, and the approver lookup cannot drift apart.
APPROVAL_PERMISSION = "apparatus.approve_driver_exception"

# How far ahead an exception may be granted. A parade three years out is not a
# plan, it is an unbounded waiver wearing a date.
MAX_VALIDITY_DAYS = 366


class DriverExceptionService:
    """Request, review, and resolve EVOC driving exceptions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Enforcement lookup
    # ------------------------------------------------------------------

    async def find_active_exception(
        self,
        user_id: str,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        on_date: Optional[date] = None,
    ) -> Optional[DriverException]:
        """The approved exception covering this member, unit, and date, if any.

        An exception with a NULL ``apparatus_id`` covers every apparatus, so it
        matches whatever unit is asked about. Only ``approved`` counts —
        pending, denied, and revoked all leave the block in place.
        """
        target_date = on_date or date.today()

        conditions = [
            DriverException.organization_id == str(organization_id),
            DriverException.user_id == str(user_id),
            DriverException.status == DriverExceptionStatus.APPROVED,
            DriverException.valid_from <= target_date,
            DriverException.valid_until >= target_date,
        ]
        if apparatus_id:
            conditions.append(
                or_(
                    DriverException.apparatus_id.is_(None),
                    DriverException.apparatus_id == str(apparatus_id),
                )
            )

        result = await self.db.execute(
            select(DriverException)
            .where(*conditions)
            # Prefer the unit-specific grant over a blanket one so the
            # restrictions surfaced to the officer are the narrower set.
            .order_by(DriverException.apparatus_id.is_(None))
            .limit(1)
        )
        return result.scalar_one_or_none()

    # ------------------------------------------------------------------
    # Who can approve
    # ------------------------------------------------------------------

    async def list_approvers(self, organization_id: str) -> List[Dict[str, Any]]:
        """Members who can actually approve a driver exception, by name.

        A blocked officer needs to know who to call, and "ask a chief" is not
        an answer in a department where the chief is on vacation and the
        deputy holds the grant. Resolved from live permissions rather than
        assumed from rank, so a department that moved the grant to a training
        officer sees the training officer.

        Mirrors ``_collect_user_permissions``: positions plus operational-rank
        defaults, matched with the same wildcard-aware ``permission_matches``
        the dependency layer uses, so this list cannot disagree with who the
        API will actually let through.

        Names and ranks only — no email or phone. Contact details are governed
        by the org's contact-visibility settings, and this endpoint has no
        business bypassing them; the member directory is where you look those
        up.
        """
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
                User.is_active,
            )
            .order_by(User.last_name, User.first_name)
        )

        approvers: List[Dict[str, Any]] = []
        for user in result.scalars().all():
            granted: set = set()
            for position in user.positions or []:
                granted.update(position.permissions or [])
            if user.rank:
                granted.update(get_rank_default_permissions(user.rank))

            if permission_matches(APPROVAL_PERMISSION, granted):
                approvers.append(
                    {
                        "user_id": str(user.id),
                        "user_name": user.full_name,
                        "rank": user.rank,
                    }
                )
        return approvers

    # ------------------------------------------------------------------
    # Request
    # ------------------------------------------------------------------

    async def request_exception(
        self,
        organization_id: str,
        requested_by: str,
        data: Dict[str, Any],
    ) -> DriverException:
        """Raise a pending exception request. Never grants anything by itself."""
        user_id = data.get("user_id")
        await assert_in_org(self.db, User, user_id, organization_id, label="member")
        await assert_in_org(
            self.db,
            Apparatus,
            data.get("apparatus_id"),
            organization_id,
            allow_none=True,
            label="apparatus",
        )

        valid_from = data["valid_from"]
        valid_until = data["valid_until"]
        if valid_until < valid_from:
            raise ValueError("The end date cannot be before the start date")
        if (valid_until - valid_from).days > MAX_VALIDITY_DAYS:
            raise ValueError(
                f"An exception may cover at most {MAX_VALIDITY_DAYS} days. "
                "Request a shorter window, or renew it when it lapses."
            )
        # Bounding only the window length let a one-day exception start years
        # out — a chief's approval sitting dormant until long after the
        # circumstances they weighed have gone. The grant has to begin within
        # the same horizon it may span.
        if (valid_from - date.today()).days > MAX_VALIDITY_DAYS:
            raise ValueError(
                f"An exception must start within {MAX_VALIDITY_DAYS} days. "
                "Request it closer to the date so it is reviewed against the "
                "circumstances that apply."
            )

        justification = (data.get("justification") or "").strip()
        if not justification:
            raise ValueError("A justification is required")

        exception = DriverException(
            organization_id=str(organization_id),
            user_id=str(user_id),
            apparatus_id=data.get("apparatus_id"),
            reason=data.get("reason") or "parade",
            justification=justification,
            restrictions=(data.get("restrictions") or "").strip() or None,
            valid_from=valid_from,
            valid_until=valid_until,
            status=DriverExceptionStatus.PENDING,
            requested_by=str(requested_by),
        )
        self.db.add(exception)
        await self.db.commit()
        await self.db.refresh(exception)
        return exception

    # ------------------------------------------------------------------
    # Review
    # ------------------------------------------------------------------

    async def review_exception(
        self,
        exception_id: str,
        organization_id: str,
        reviewer_id: str,
        approve: bool,
        review_notes: Optional[str] = None,
    ) -> DriverException:
        """Approve or deny a pending request.

        Raises ``SeparationOfDutiesError`` (a ValueError, so the endpoint's
        existing handling turns it into a 400) when the reviewer is the person
        who raised the request, or the member the exception is for. Either
        would let one person put themselves or their own request through
        unreviewed.
        """
        exception = await self.get_exception(exception_id, organization_id)
        if not exception:
            raise ValueError("Exception request not found")

        if exception.status != DriverExceptionStatus.PENDING:
            raise ValueError(
                f"This request was already {exception.status.value}. "
                "Raise a new request rather than re-deciding a closed one."
            )

        assert_different_person(
            reviewer_id,
            exception.requested_by,
            action="approve a driver qualification exception",
            record="exception request",
        )
        # The beneficiary is not a reviewer either, however senior. A chief who
        # needs one for themselves asks another chief.
        assert_different_person(
            reviewer_id,
            exception.user_id,
            action="approve a driver qualification exception for themselves",
            record="exception request",
        )

        if approve and exception.valid_until < date.today():
            raise ValueError(
                "This request has already lapsed; its end date is in the past."
            )

        # Two chiefs deciding the same request at once would both read
        # "pending", both pass the guard above, and both commit — the later
        # write silently deciding the outcome while both endpoints report
        # success and log an audit event. Settle it in the database: the
        # UPDATE only matches a row that is *still* pending, so exactly one
        # review can win.
        decision = (
            DriverExceptionStatus.APPROVED if approve else DriverExceptionStatus.DENIED
        )
        result = await self.db.execute(
            update(DriverException)
            .where(
                DriverException.id == str(exception_id),
                DriverException.organization_id == str(organization_id),
                DriverException.status == DriverExceptionStatus.PENDING,
            )
            .values(
                status=decision,
                reviewed_by=str(reviewer_id),
                reviewed_at=datetime.now(timezone.utc),
                review_notes=(review_notes or "").strip() or None,
            )
        )
        if result.rowcount == 0:
            await self.db.rollback()
            raise ValueError(
                "Another reviewer decided this request first. Reload to see "
                "their decision."
            )

        await self.db.commit()
        # Re-read rather than mutating the instance we fetched: the decision
        # was settled by the UPDATE, so the row is the authority on what it
        # now says.
        return await self.get_exception(exception_id, organization_id) or exception

    async def revoke_exception(
        self,
        exception_id: str,
        organization_id: str,
        reviewer_id: str,
        review_notes: Optional[str] = None,
    ) -> DriverException:
        """Withdraw an approved exception before its end date.

        Unlike approval this has no separation-of-duties bar: withdrawing
        permission is always the safe direction, and requiring a second person
        to take an unsafe driver off a truck would be a hazard, not a control.
        """
        exception = await self.get_exception(exception_id, organization_id)
        if not exception:
            raise ValueError("Exception request not found")
        if exception.status != DriverExceptionStatus.APPROVED:
            raise ValueError("Only an approved exception can be revoked")

        result = await self.db.execute(
            update(DriverException)
            .where(
                DriverException.id == str(exception_id),
                DriverException.organization_id == str(organization_id),
                DriverException.status == DriverExceptionStatus.APPROVED,
            )
            .values(
                status=DriverExceptionStatus.REVOKED,
                reviewed_by=str(reviewer_id),
                reviewed_at=datetime.now(timezone.utc),
                review_notes=(review_notes or "").strip() or None,
            )
        )
        if result.rowcount == 0:
            await self.db.rollback()
            raise ValueError("Only an approved exception can be revoked")

        await self.db.commit()
        return await self.get_exception(exception_id, organization_id) or exception

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def get_exception(
        self, exception_id: str, organization_id: str
    ) -> Optional[DriverException]:
        result = await self.db.execute(
            select(DriverException)
            .options(
                selectinload(DriverException.user),
                selectinload(DriverException.apparatus),
                selectinload(DriverException.requester),
                selectinload(DriverException.reviewer),
            )
            .where(
                DriverException.id == str(exception_id),
                DriverException.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def list_exceptions(
        self,
        organization_id: str,
        status: Optional[str] = None,
        user_id: Optional[str] = None,
        include_expired: bool = False,
    ) -> List[DriverException]:
        """List exceptions, newest request first.

        ``include_expired`` is False by default so the review queue is not
        buried under last year's parades; an approved exception whose window
        has closed is history, not a live grant.
        """
        conditions = [DriverException.organization_id == str(organization_id)]
        if status:
            conditions.append(DriverException.status == status)
        if user_id:
            conditions.append(DriverException.user_id == str(user_id))
        if not include_expired:
            conditions.append(DriverException.valid_until >= date.today())

        result = await self.db.execute(
            select(DriverException)
            .options(
                selectinload(DriverException.user),
                selectinload(DriverException.apparatus),
                selectinload(DriverException.requester),
                selectinload(DriverException.reviewer),
            )
            .where(*conditions)
            .order_by(DriverException.requested_at.desc())
        )
        return list(result.scalars().all())

    async def count_pending(self, organization_id: str) -> int:
        """Badge count for the chief's review queue."""
        result = await self.db.execute(
            select(DriverException.id).where(
                DriverException.organization_id == str(organization_id),
                DriverException.status == DriverExceptionStatus.PENDING,
                DriverException.valid_until >= date.today(),
            )
        )
        return len(list(result.scalars().all()))
