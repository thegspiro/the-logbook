"""
Take a member who can no longer work off the shifts they have not worked yet.

Deactivating (soft-deleting), archiving, or moving a member into any status
outside ``ACTIVE_ACCOUNT_STATUSES`` used to leave every future seat they held
on the roster, and their standing claims kept seating them on each shift the
department generated afterwards. A duty officer then counted on somebody who
could not even sign in.

One function, called from all three paths, so they cannot drift:

* standing claims are ended first, so a shift created while the release runs
  cannot re-seat the member behind it;
* each assignment on a shift whose start is still ahead goes through
  ``SchedulingService.delete_assignment`` — the same path the roster's
  "remove" uses — so swaps offering the seat are withdrawn and the officers
  are told the seat is open, exactly as when an officer removes someone.

Shifts already started or finished are untouched: they are history, and an
in-progress shift is being worked. "Started" is the shift's own ``start_time``
(stored UTC) against the current UTC instant — not its date, which would
release a night shift that began an hour ago.

Reinstating the member does not put anything back; the officer re-rosters.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.training import Shift, ShiftAssignment, StandingShiftClaim
from app.services.scheduling_service import SchedulingService
from app.services.standing_shift_service import StandingShiftService


@dataclass
class ShiftReleaseSummary:
    """What :func:`release_future_shift_commitments` did."""

    assignments_released: int = 0
    standing_claims_ended: int = 0


async def release_future_shift_commitments(
    db: AsyncSession,
    *,
    organization_id: str,
    user_id: str,
    reason: str,
    performed_by_id: Optional[str] = None,
    performed_by_username: Optional[str] = None,
    now: Optional[datetime] = None,
) -> ShiftReleaseSummary:
    """
    End *user_id*'s standing claims and release their seats on shifts that
    have not started, then record an audit event saying how many.

    Call it after the status change has committed: the scheduling paths it
    delegates to commit as they go. *reason* names the trigger in the audit
    event (``"soft_deleted"``, ``"archived"``, ``"status_changed:retired"``).
    """
    organization_id = str(organization_id)
    user_id = str(user_id)
    cutoff = now or datetime.now(timezone.utc)
    summary = ShiftReleaseSummary()

    # Locking read: the claim rows are read and then ended, and the shift
    # creation reader seats members from the active ones (Pitfall #27).
    claims = (
        (
            await db.execute(
                select(StandingShiftClaim)
                .where(
                    StandingShiftClaim.organization_id == organization_id,
                    StandingShiftClaim.user_id == user_id,
                    StandingShiftClaim.is_active.is_(True),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    standing = StandingShiftService(db)
    for claim in claims:
        # release_future stays off: the sweep below releases every future
        # seat, claim-derived or not, through the roster's own remove path.
        await standing.end_claim(claim)
        summary.standing_claims_ended += 1

    scheduling = SchedulingService(db)
    assignment_ids = (
        (
            await db.execute(
                select(ShiftAssignment.id)
                .join(Shift, Shift.id == ShiftAssignment.shift_id)
                .where(
                    ShiftAssignment.user_id == user_id,
                    ShiftAssignment.organization_id == organization_id,
                    Shift.organization_id == organization_id,
                    Shift.start_time > cutoff,
                    ShiftAssignment.assignment_status.notin_(
                        SchedulingService.INACTIVE_ASSIGNMENT_STATUSES
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    for assignment_id in assignment_ids:
        ok, error = await scheduling.delete_assignment(
            UUID(str(assignment_id)), organization_id
        )
        if ok:
            summary.assignments_released += 1
        else:
            # Most often the seat was removed by somebody else meanwhile.
            logger.warning(
                f"Could not release assignment {assignment_id} for member "
                f"{user_id}: {error}"
            )

    if summary.assignments_released or summary.standing_claims_ended:
        await log_audit_event(
            db=db,
            event_type="member_future_shifts_released",
            event_category="scheduling",
            severity="info",
            event_data={
                "target_user_id": user_id,
                "reason": reason,
                "assignments_released": summary.assignments_released,
                "standing_claims_ended": summary.standing_claims_ended,
                "shifts_starting_after": cutoff.isoformat(),
            },
            user_id=performed_by_id,
            username=performed_by_username,
            organization_id=organization_id,
        )

    return summary
