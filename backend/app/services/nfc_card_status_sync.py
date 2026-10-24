"""
Keeps a member's ID cards in step with their membership status.

When a member leaves, their active cards are suspended; when they come back,
the cards *this module* suspended are reactivated. Taps from a departed member
were already refused at the reader (``resolve_tag`` checks the member's
status), so this is not the control that stops a card working — it is what
makes the card's own status say so, on the ID-card screen and in the audit
trail, instead of reading "Active" while it quietly fails.

Kept in its own module, importing only models and the audit logger, because it
is called from the member-status endpoints and the archive service:
``nfc_tag_service`` pulls in the scheduling, event and admin-hours services,
and importing that from the archive service would risk an import cycle.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.models.nfc_tag import NfcTag, NfcTagStatus
from app.models.user import UserStatus

# Members whose card must stop working even though the record still exists.
# Mirrors ``User.is_active`` (ACTIVE or PROBATIONARY, not deleted) apart from two
# deliberate exceptions: a retired or on-leave member keeps a working card,
# because they still attend meetings and banquets, which is exactly what a
# station records. INACTIVE carries no such meaning — it is the plain "not an
# active member" state — so a card must not go on recording attendance for one.
#
# The tap-time refusal in nfc_tag_service and the suspension below both read
# this one set, so a card is suspended for exactly the members whose taps are
# refused anyway.
BLOCKED_MEMBER_STATUSES = frozenset(
    {
        UserStatus.INACTIVE,
        UserStatus.SUSPENDED,
        UserStatus.DROPPED_VOLUNTARY,
        UserStatus.DROPPED_INVOLUNTARY,
        UserStatus.ARCHIVED,
    }
)

AUTO_SUSPEND_REASON = (
    "Suspended automatically: the card holder is no longer an active member"
)


async def sync_cards_with_member_status(
    db: AsyncSession,
    *,
    organization_id: str,
    user_id: str,
    member_status: UserStatus,
    performed_by_id: Optional[str] = None,
    performed_by_username: Optional[str] = None,
) -> int:
    """Suspend or restore a member's cards to match ``member_status``.

    Runs in the caller's transaction and does not commit, so the card change
    lands with the status change or not at all. Returns how many cards moved.

    Only cards the system suspended come back: an officer's own suspension,
    and lost or revoked cards, are untouched in both directions.
    """
    if member_status in BLOCKED_MEMBER_STATUSES:
        wanted, new_status, auto_flag = (
            NfcTagStatus.ACTIVE,
            NfcTagStatus.SUSPENDED,
            True,
        )
        event_type = "nfc_tag_auto_suspended"
    else:
        wanted, new_status, auto_flag = (
            NfcTagStatus.SUSPENDED,
            NfcTagStatus.ACTIVE,
            False,
        )
        event_type = "nfc_tag_auto_reactivated"

    query = select(NfcTag).where(
        NfcTag.organization_id == str(organization_id),
        NfcTag.user_id == str(user_id),
        NfcTag.status == wanted,
    )
    if not auto_flag:
        query = query.where(NfcTag.auto_suspended.is_(True))
    cards = list((await db.execute(query)).scalars().all())
    if not cards:
        return 0

    now = datetime.now(timezone.utc)
    for card in cards:
        card.status = new_status
        card.auto_suspended = auto_flag
        if auto_flag:
            card.revoked_at = now
            card.revoked_reason = AUTO_SUSPEND_REASON
        else:
            card.revoked_at = None
            card.revoked_reason = None
    await db.flush()

    for card in cards:
        await log_audit_event(
            db=db,
            event_type=event_type,
            event_category="members",
            severity="info",
            event_data={
                "tag_id": card.id,
                "member_id": str(user_id),
                "member_status": member_status.value,
                "new_status": new_status.value,
            },
            user_id=performed_by_id,
            username=performed_by_username,
            organization_id=str(organization_id),
        )
    return len(cards)
