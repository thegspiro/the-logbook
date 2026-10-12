"""
Per-department review rules for administrative hours.

Stored in the organization settings as the ``admin_hours`` section and written
through ``PATCH /organization/settings`` (``settings.manage``), never by an
``admin_hours.manage`` holder alone — one of these switches relaxes the control
that stops an officer approving their own hours, so the person it would
benefit must not be the only one able to flip it.

Pitfall #19: this module is the reader. ``AdminHoursService`` consults it on
every approval and every attendance resync, and ``GET /admin-hours/settings``
reports what it resolved so the screen shows the server's reading, not a copy
of these defaults.

``allow_self_approval``
    Off unless set to a literal ``True``. When on, an approver may approve an
    entry they logged themselves — the sole-officer department, which has no
    second ``admin_hours.manage`` holder to send it to. Absent means the AH-4
    separation of duties that every installation has had since that fix.

``resync_requeue_growth_percent``
    When a reopened event's corrected check-out lengthens an attendance entry
    that was already approved, the entry goes back to Pending Review if it grew
    by **more than** this percentage of its approved duration *and* its
    category would not have auto-approved the new length. Default 25: a
    correction of a few minutes keeps the officer's decision, a session that
    grew from one hour to three does not ride on a review of the one. ``0``
    re-queues any growth at all. Absent or malformed reads as the default,
    because an exception here would fail the whole event's attendance resync
    over one mistyped setting (Pitfall #19, "read free-form JSON defensively").
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization

ADMIN_HOURS_SETTINGS_KEY = "admin_hours"
ALLOW_SELF_APPROVAL_FLAG = "allow_self_approval"
REQUEUE_GROWTH_KEY = "resync_requeue_growth_percent"

DEFAULT_REQUEUE_GROWTH_PERCENT = 25
MAX_REQUEUE_GROWTH_PERCENT = 1000


@dataclass(frozen=True)
class AdminHoursReviewSettings:
    allow_self_approval: bool
    resync_requeue_growth_percent: int


def admin_hours_review_settings_in(settings: Any) -> AdminHoursReviewSettings:
    """Resolve the review rules out of an organization's settings JSON."""
    section = (
        settings.get(ADMIN_HOURS_SETTINGS_KEY) if isinstance(settings, dict) else None
    )
    if not isinstance(section, dict):
        section = {}

    growth = section.get(REQUEUE_GROWTH_KEY)
    # bool is an int subclass; a stray ``true`` must not read as 1%.
    if (
        isinstance(growth, bool)
        or not isinstance(growth, int)
        or not 0 <= growth <= MAX_REQUEUE_GROWTH_PERCENT
    ):
        growth = DEFAULT_REQUEUE_GROWTH_PERCENT

    return AdminHoursReviewSettings(
        allow_self_approval=section.get(ALLOW_SELF_APPROVAL_FLAG) is True,
        resync_requeue_growth_percent=growth,
    )


async def load_admin_hours_review_settings(
    db: AsyncSession, organization_id: str
) -> AdminHoursReviewSettings:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return admin_hours_review_settings_in(result.scalar_one_or_none())


def resync_growth_needs_review(
    approved_minutes: int, new_minutes: int, growth_percent: int
) -> bool:
    """True when ``new_minutes`` exceeds the approved length by more than the
    threshold. Integer arithmetic, so 60 -> 75 at 25% stays approved."""
    if new_minutes <= approved_minutes:
        return False
    return (new_minutes - approved_minutes) * 100 > approved_minutes * growth_percent
