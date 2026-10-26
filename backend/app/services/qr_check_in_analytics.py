"""Server-side writers for the QR check-in analytics dashboard (RPT2-3).

``GET /analytics/metrics`` counts ``qr_scan``, ``check_in_success`` and
``check_in_failure`` rows, and nothing wrote them, so the dashboard read zero
for every department. Owner decision: the server records them.

- **Scan:** the self-check-in page marks its first load, and at most one scan
  is kept per member per event. The data endpoint that page loads is polled,
  and the officer's QR display page polls it too, so counting requests would
  count the polling. Deduplicating means a member can only ever add the one
  scan that is theirs.
- **Success / failure:** written from the self-check-in endpoint's outcome.
  A failure carries one reason from :data:`FAILURE_REASONS`, never the
  service's sentence, so the dashboard's error breakdown stays a short, fixed
  list. A manual check-in by an officer is not a QR check-in and is not
  counted; a check-out, a repeat scan by a member already checked in, and the
  phase-gate warning (which the member can still proceed past) are not
  outcomes either.

These writes join the request's transaction and do not commit.
"""

import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    ANALYTICS_CHECK_IN_FAILURE,
    ANALYTICS_CHECK_IN_SUCCESS,
    ANALYTICS_QR_SCAN,
)
from app.models.analytics import AnalyticsEvent
from app.services.event_service import ATTENDANCE_LOCKED_PREFIX

FAILURE_REASONS = ("not_open_yet", "closed", "event_cancelled", "attendance_locked")

# The same split the client-side tracker used (services/analytics.ts), so rows
# written before and after this change group together.
_TABLET = re.compile(r"(tablet|ipad|playbook|silk)|(android(?!.*mobi))", re.I)
_MOBILE = re.compile(
    r"mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|skyfire|maemo|"
    r"windows phone|palm|iemobile|symbian|fennec",
    re.I,
)


def device_type_from_user_agent(user_agent: Optional[str]) -> str:
    if not user_agent:
        return "unknown"
    if _TABLET.search(user_agent):
        return "tablet"
    if _MOBILE.search(user_agent):
        return "mobile"
    return "desktop"


def failure_reason(error: str) -> Optional[str]:
    """The bounded reason for a refused self-check-in, or None to record nothing.

    None covers the refusals that are not a check-in failing: an event that is
    not this department's, a caller who is not a member, and anything this
    function does not recognise (so a new service message cannot leak into the
    dashboard as free text).
    """
    if error.startswith(ATTENDANCE_LOCKED_PREFIX):
        return "attendance_locked"
    if error.startswith("Check-in is not available yet"):
        return "not_open_yet"
    if error.startswith("Check-in has closed"):
        return "closed"
    if error == "Event has been cancelled":
        return "event_cancelled"
    return None


async def record_qr_scan(
    db: AsyncSession,
    organization_id: str,
    event_id: str,
    user_id: str,
    device_type: str,
) -> bool:
    """Record a member's scan of an event's QR code, once. True if written.

    Deduplicated by lookup rather than a unique key: ``analytics_events`` holds
    every event type in one table, and MySQL has no partial unique index. Two
    first loads racing could each write one; the dashboard would then count a
    scan twice for that member, which is the whole of the harm.
    """
    existing = await db.scalar(
        select(AnalyticsEvent.id)
        .where(
            AnalyticsEvent.organization_id == str(organization_id),
            AnalyticsEvent.event_id == str(event_id),
            AnalyticsEvent.user_id == str(user_id),
            AnalyticsEvent.event_type == ANALYTICS_QR_SCAN,
        )
        .limit(1)
    )
    if existing is not None:
        return False
    db.add(
        AnalyticsEvent(
            organization_id=str(organization_id),
            event_type=ANALYTICS_QR_SCAN,
            event_id=str(event_id),
            user_id=str(user_id),
            device_type=device_type,
            event_metadata={"source": "server"},
        )
    )
    return True


def record_check_in_outcome(
    db: AsyncSession,
    organization_id: str,
    event_id: str,
    user_id: str,
    device_type: str,
    error: Optional[str],
) -> None:
    """Record a self-check-in's success, or its failure with a bounded reason."""
    if error is None:
        event_type, metadata = ANALYTICS_CHECK_IN_SUCCESS, {"source": "server"}
    else:
        reason = failure_reason(error)
        if reason is None:
            return
        event_type = ANALYTICS_CHECK_IN_FAILURE
        metadata = {"source": "server", "error_reason": reason}
    db.add(
        AnalyticsEvent(
            organization_id=str(organization_id),
            event_type=event_type,
            event_id=str(event_id),
            user_id=str(user_id),
            device_type=device_type,
            event_metadata=metadata,
        )
    )
